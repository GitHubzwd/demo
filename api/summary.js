// Vercel Function：POST /api/summary —— 按维度汇总（表格上方那个图表）
// 纯内存计算，不调模型，所以不占模型的限流额度

import { handleSummary, readJsonBody, sendJson } from '../web/server/core.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: `不支持 ${req.method}` });
  }

  try {
    const body = await readJsonBody(req);
    sendJson(res, 200, await handleSummary({ body }));
  } catch (e) {
    sendJson(res, e.status || 500, { error: e.message || '服务器内部错误' });
  }
}
