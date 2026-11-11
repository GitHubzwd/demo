// Vercel Function：POST /api/stream —— SSE 流式查询
// 只做协议适配，逻辑在 web/server/{core,sse}.mjs

import { streamHandler } from '../web/server/sse.mjs';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  return streamHandler(req, res);
}
