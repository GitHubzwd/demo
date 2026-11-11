// http.mjs —— Fetch 风格适配层（EdgeOne / Cloudflare / Deno / 任何支持 Request·Response 的运行时）
//
// Vercel 那套用的是 node 的 (req, res)，EdgeOne 用的是 (request) => Response。
// 两套壳，同一份 core —— 换平台不用动业务逻辑。

import { getMeta, handleQuery, handleQueryStream, handleSummary } from './core.mjs';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

/** 真实 IP：EdgeOne 和 Vercel 都会带 x-forwarded-for */
export function ipOf(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
}

async function readJson(request) {
  if (request.method !== 'POST') return {};
  try {
    return (await request.json()) ?? {};
  } catch {
    return {};
  }
}

export async function metaRequest() {
  try {
    return json(getMeta());
  } catch (e) {
    return json({ error: e.message || '服务器内部错误' }, 500);
  }
}

export async function queryRequest(request) {
  if (request.method !== 'POST') return json({ error: `不支持 ${request.method}` }, 405);
  try {
    return json(await handleQuery({ body: await readJson(request), ip: ipOf(request) }));
  } catch (e) {
    return json({ error: e.message || '服务器内部错误' }, e.status || 500);
  }
}

export async function summaryRequest(request) {
  if (request.method !== 'POST') return json({ error: `不支持 ${request.method}` }, 405);
  try {
    return json(await handleSummary({ body: await readJson(request) }));
  } catch (e) {
    return json({ error: e.message || '服务器内部错误' }, e.status || 500);
  }
}

/**
 * SSE：把 core 的事件翻译成 ReadableStream。
 * 取消（用户关页面）时 cancel() 会被调用 —— 顺手 abort 上游，别再烧 token。
 */
export async function streamRequest(request) {
  if (request.method !== 'POST') return json({ error: `不支持 ${request.method}` }, 405);

  const body = await readJson(request);
  const encoder = new TextEncoder();
  const abort = new AbortController();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        if (abort.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          abort.abort();
        }
      };

      try {
        await handleQueryStream({
          body,
          ip: ipOf(request),
          signal: abort.signal,
          onEvent: (ev) => {
            if (ev.type === 'delta') send('delta', { text: ev.text });
            else if (ev.type === 'plan') send('plan', ev);
            else if (ev.type === 'rows') send('rows', ev.payload);
          },
        });
        send('done', {});
      } catch (e) {
        if (e.status !== 499) send('error', { error: e.message || '服务器内部错误', status: e.status || 500 });
      } finally {
        try {
          controller.close();
        } catch {
          /* 已经关了 */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
