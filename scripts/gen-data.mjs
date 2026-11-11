// gen-data.mjs —— 把 orders.json 编译成一个 JS 模块
//
// 为什么要有这一步：
//   云端函数（Vercel / EdgeOne / Workers）不保证能把项目里的 orders.json 带进运行时，
//   fs.readFileSync 在本地好好的，线上就是 ENOENT。
//   改成静态 import 之后，打包器会把数据内联进函数，跟文件系统彻底无关。
//
//   node scripts/gen-data.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'orders.json');
// 生成到仓库根：web/server/ 在某些环境（含本机）没有进程写权限，根目录更保险
const OUT = path.join(ROOT, 'orders.data.mjs');

if (!fs.existsSync(SRC)) {
  console.error(`找不到 ${SRC}，先跑：node gen-orders.mjs`);
  process.exit(1);
}

const rows = JSON.parse(fs.readFileSync(SRC, 'utf8'));

// JSON 本身几乎就是合法的 JS 字面量（只要没有 U+2028/U+2029）
const literal = JSON.stringify(rows).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const code = `// 由 scripts/gen-data.mjs 自动生成，不要手改（改 orders.json 后重跑即可）
export const ORDERS = ${literal};
export default ORDERS;
`;

fs.writeFileSync(OUT, code, 'utf8');
console.log(`已生成 ${path.relative(ROOT, OUT)}：${rows.length} 条，${(code.length / 1024).toFixed(0)}KB`);
