// Vercel Function：POST /api/query
// 只做协议适配，业务逻辑全在 web/server/core.mjs

import { handleQuery, readJsonBody, sendJson, clientIp } from '../web/server/core.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: `不支持 ${req.method}` });
  }

  try {
    const body = await readJsonBody(req);
    const payload = await handleQuery({ body, ip: clientIp(req) });
    sendJson(res, 200, payload);
  } catch (e) {
    sendJson(res, e.status || 500, { error: e.message || '服务器内部错误' });
  }
}
