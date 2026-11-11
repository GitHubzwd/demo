// plugin.mjs —— 只负责把 core 挂到 Vite 的 dev / preview 上，逻辑一行都没有。
//
// 上线走的是 api/*.js（Vercel Function），本质上调的是同一个 core，
// 所以「本地能跑、线上不能跑」不会是逻辑问题，只可能是环境问题。

import { getMeta, handleQuery, handleSummary, readJsonBody, sendJson, clientIp } from './core.mjs';
import { streamHandler } from './sse.mjs';

/** 裸的 connect 风格中间件（Vite 挂载、测试都用它） */
export function queryApiMiddleware() {
  return async (req, res, next) => {
    const url = (req.url || '/').split('?')[0];

    try {
      if (url === '/meta' && req.method === 'GET') {
        return sendJson(res, 200, getMeta());
      }

      if (url === '/stream' && req.method === 'POST') {
        return streamHandler(req, res);
      }

      if (url === '/summary' && req.method === 'POST') {
        return sendJson(res, 200, await handleSummary({ body: await readJsonBody(req) }));
      }

      if (url === '/query' && req.method === 'POST') {
        const body = await readJsonBody(req);
        return sendJson(res, 200, await handleQuery({ body, ip: clientIp(req) }));
      }

      if (['/query', '/meta', '/stream', '/summary'].includes(url)) {
        return sendJson(res, 405, { error: `不支持 ${req.method}` });
      }

      return next();
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.message || '服务器内部错误' });
    }
  };
}

/** 给 vite.config.ts 用：dev 和 preview 都挂上 */
export function queryApiPlugin() {
  return {
    name: 'ai-query-api',
    configureServer(server) {
      server.middlewares.use('/api', queryApiMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api', queryApiMiddleware());
    },
  };
}
