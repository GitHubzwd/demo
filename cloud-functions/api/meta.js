// EdgeOne Makers · Cloud Functions（Node.js 运行时）
// 文件即路由：cloud-functions/api/meta.js → /api/meta
// 只做协议适配，逻辑全在 web/server/

import { metaRequest } from '../../web/server/http.mjs';

export default function onRequest(context) {
  return metaRequest(context.request);
}
