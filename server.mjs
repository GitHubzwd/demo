// server.mjs —— 本地跑「生产包」：托管 web/dist，/api 交给和 Vercel 完全相同的 handler。
//
//   npm run build && npm start     → http://localhost:4173
//
// 它的意义是：上线前就能在本地验证「静态产物 + 真接口」这一套，
// 而不是等推上去才发现 /api 只在 dev server 里存在。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sendJson } from './web/server/core.mjs';
import { streamHandler } from './web/server/sse.mjs';
import metaHandler from './api/meta.js';
import queryHandler from './api/query.js';
import summaryHandler from './api/summary.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'web', 'dist');
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname) {
  if (!fs.existsSync(DIST)) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('还没有构建产物，先跑：npm run build');
    return;
  }

  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let file = path.resolve(DIST, rel);

  // 防目录穿越：解析后必须还在 dist 里面
  if (!file.startsWith(DIST + path.sep) && file !== path.join(DIST, 'index.html')) {
    res.statusCode = 403;
    res.end('forbidden');
    return;
  }

  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html'); // SPA 兜底
  }

  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable');
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || '/').split('?')[0]);

  if (pathname === '/api/meta') return metaHandler(req, res);
  if (pathname === '/api/query') return queryHandler(req, res);
  if (pathname === '/api/stream') return streamHandler(req, res);
  if (pathname === '/api/summary') return summaryHandler(req, res);
  if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: `接口不存在：${pathname}` });

  return serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`生产模式：http://localhost:${PORT}`);
  console.log(`静态目录：${DIST}`);
});
