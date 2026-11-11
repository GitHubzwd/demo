// query.mjs —— Day 2 的产出：把「JSON 条件」翻译成数组过滤，并且真的跑出数据。
//
// 三种用法：
//   node query.mjs                              用内置的示例条件
//   node query.mjs '{"filters":[...],...}'      把 spike 产出的 JSON 直接粘进来
//   node query.mjs --ask "上个月华东区退款超过 500 的订单"   用本地规则解析一句话（不需要 Key）
//
// 它和 web/server/engine.mjs 是同一套过滤实现，不重复写第二遍。

import fs from 'node:fs';
import path from 'node:path';

import { runQuery } from './web/server/engine.mjs';
import { parseWithRules } from './web/server/parser.mjs';
import { normalizeQuery, validateQuery } from './web/server/schema.mjs';

const DEFAULT_QUERY = {
  filters: [
    { field: 'region', op: 'eq', value: '华东' },
    { field: 'status', op: 'eq', value: '已退款' },
    { field: 'amount', op: 'gt', value: 500 },
  ],
  dateFrom: null,
  dateTo: null,
  sort: { field: 'amount', order: 'desc' },
  limit: 50,
};

function main() {
  const args = process.argv.slice(2);

  const file = path.resolve('orders.json');
  if (!fs.existsSync(file)) {
    console.error('找不到 orders.json，先跑：node gen-orders.mjs');
    process.exit(1);
  }
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));

  let query;
  if (args[0] === '--ask') {
    const question = args.slice(1).join(' ').trim();
    if (!question) {
      console.error('用法：node query.mjs --ask "上个月华东区退款超过 500 的订单"');
      process.exit(1);
    }
    query = parseWithRules(question);
    console.log(`问题：${question}`);
    console.log(`${query.reason}\n`);
  } else if (args[0]) {
    let raw;
    try {
      raw = JSON.parse(args[0]);
    } catch {
      console.error('参数不是合法 JSON。记得整体加引号，比如：');
      console.error('  node query.mjs "{\\"filters\\":[{\\"field\\":\\"region\\",\\"op\\":\\"eq\\",\\"value\\":\\"华东\\"}]}"');
      process.exit(1);
    }
    const errs = validateQuery(raw);
    if (errs.length) {
      console.error('条件没通过校验：');
      for (const e of errs) console.error(`  - ${e}`);
      process.exit(1);
    }
    query = normalizeQuery(raw);
    console.log('条件（来自命令行）：');
    console.log(JSON.stringify(query, null, 2), '\n');
  } else {
    query = normalizeQuery(DEFAULT_QUERY);
    console.log('没有传条件，用内置示例：');
    console.log(JSON.stringify(query, null, 2), '\n');
  }

  const t0 = performance.now();
  const result = runQuery(rows, query);
  const ms = (performance.now() - t0).toFixed(1);

  if (result.skipped.length) console.log(`跳过了不认识的条件：${result.skipped.join('、')}\n`);

  const top = result.rows.slice(0, 10);
  const head = ['订单号', '客户', '金额', '地区', '状态', '渠道', '下单时间'];
  const line = (cells) => cells.map((c, i) => padCell(c, i)).join('  ');

  console.log(line(head));
  console.log('-'.repeat(88));
  for (const o of top) {
    console.log(
      line([
        o.orderNo,
        o.customer,
        `¥${o.amount.toFixed(2)}`,
        o.region,
        o.status,
        o.channel,
        o.createdAt,
      ]),
    );
  }
  console.log('-'.repeat(88));
  console.log(
    `命中 ${result.total} 条，合计 ¥${result.stats.sum.toFixed(2)}，耗时 ${ms}ms`,
  );
  if (result.total > top.length) console.log(`（只打印前 ${top.length} 条）`);
}

// 中文字符按两个宽度算，表格才对得齐
const WIDTHS = [14, 12, 11, 6, 8, 8, 12];
const visualWidth = (s) => [...String(s)].reduce((n, ch) => n + (/[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 2 : 1), 0);
function padCell(value, index) {
  const s = String(value);
  const pad = Math.max(WIDTHS[index] - visualWidth(s), 0);
  return index === 2 ? ' '.repeat(pad) + s : s + ' '.repeat(pad);
}

main();
