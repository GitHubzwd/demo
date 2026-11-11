// Vercel Function：GET /api/meta
// 只做协议适配，业务逻辑全在 web/server/core.mjs

import { getMeta, sendJson } from '../web/server/core.mjs';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: `不支持 ${req.method}` });
  }
  try {
    sendJson(res, 200, getMeta());
  } catch (e) {
    sendJson(res, e.status || 500, { error: e.message || '服务器内部错误' });
  }
}
