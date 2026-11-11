// sse.mjs —— 流式接口的协议适配层（dev / 本地生产 / Vercel 共用一份）
//
// 事件格式：
//   event: delta  data: {"text":"..."}      模型正在写的内容（逐字）
//   event: plan   data: {...}               条件解析完成（chip 可以渲染了）
//   event: rows   data: {...}               查询完成（和 /api/query 的 payload 一模一样）
//   event: done   data: {}                  结束
//   event: error  data: {"error":"..."}      出错（含 429 限流）

import { handleQueryStream, readJsonBody, sendJson, clientIp } from './core.mjs';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // 让中间的代理/网关别攒包，否则「流式」会变成「等 1 秒一次性到」
  'X-Accel-Buffering': 'no',
};

export async function streamHandler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: `不支持 ${req.method}` });
  }

  // 用户点「取消」或关页面时，res 会 close —— 顺势中止上游请求，别再烧 token
  const ac = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) ac.abort();
  });

  let closed = false;
  const write = (chunk) => {
    if (closed || res.writableEnded) return;
    try {
      res.write(chunk);
    } catch {
      closed = true;
    }
  };
  const send = (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  res.writeHead(200, SSE_HEADERS);
  res.flushHeaders?.();

  try {
    const body = await readJsonBody(req);
    await handleQueryStream({
      body,
      ip: clientIp(req),
      signal: ac.signal,
      onEvent: (ev) => {
        if (ev.type === 'delta') send('delta', { text: ev.text });
        else if (ev.type === 'plan') send('plan', ev);
        else if (ev.type === 'rows') send('rows', ev.payload);
      },
    });
    send('done', {});
  } catch (e) {
    // 客户端已经走了就别再写，否则会抛 write after end
    if (e.status !== 499) send('error', { error: e.message || '服务器内部错误', status: e.status || 500 });
  } finally {
    if (!res.writableEnded) res.end();
  }
}
