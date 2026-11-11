// EdgeOne Makers · Cloud Functions（Node.js 运行时）
// POST /api/stream —— SSE 流式查询

import { streamRequest } from '../../web/server/http.mjs';

export default function onRequest(context) {
  return streamRequest(context.request);
}
