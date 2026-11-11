// EdgeOne Makers · Cloud Functions（Node.js 运行时）
// POST /api/summary —— 图表汇总

import { summaryRequest } from '../../web/server/http.mjs';

export default function onRequest(context) {
  return summaryRequest(context.request);
}
