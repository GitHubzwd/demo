// EdgeOne Makers · Cloud Functions（Node.js 运行时）
// POST /api/query —— 非流式查询（翻页用）

import { queryRequest } from '../../web/server/http.mjs';

export default function onRequest(context) {
  return queryRequest(context.request);
}
