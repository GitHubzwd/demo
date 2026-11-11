// parser.test.mjs —— 规则解析的回归测试（不需要 Key，随时能跑）
//
//   node web/server/parser.test.mjs
//
// 加了新的问法就先往这里加一条，跑绿了再改 parser。
// 这套用例和 spike.mjs 的 10 条是对齐的：模型和兜底解析同一批问题，
// 面试时可以直接说「两条路我都有回归集」。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseWithRules } from './parser.mjs';
import { runQuery } from './engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORDERS = path.resolve(HERE, '..', '..', 'orders.json');
const rows = fs.existsSync(ORDERS) ? JSON.parse(fs.readFileSync(ORDERS, 'utf8')) : [];

// 固定「今天」，否则用例会随着日期漂移
const TODAY = new Date(2026, 10, 11); // 2026-11-11
const parse = (q) => parseWithRules(q, TODAY);

const CASES = [
  {
    q: '上个月华东区退款超过 500 的订单',
    check(p) {
      assert.deepEqual(
        p.filters.map((f) => `${f.field}${f.op}`).sort(),
        ['amountgt', 'regioneq', 'statuseq'],
      );
      assert.equal(p.dateFrom, '2026-10-01');
      assert.equal(p.dateTo, '2026-10-31');
      assert.equal(p.filters.find((f) => f.field === 'amount').value, 500);
    },
  },
  {
    q: '这个月已支付的订单，按金额从高到低',
    check(p) {
      assert.ok(p.filters.some((f) => f.field === 'status' && f.value === '已支付'));
      assert.deepEqual(p.sort, { field: 'amount', order: 'desc' });
      assert.equal(p.dateFrom, '2026-11-01');
    },
  },
  {
    q: '小程序渠道最近 7 天的订单',
    check(p) {
      assert.ok(p.filters.some((f) => f.field === 'channel' && f.value === '小程序'));
      assert.equal(p.dateFrom, '2026-11-05');
      assert.equal(p.dateTo, '2026-11-11');
    },
  },
  {
    q: '客户名称包含「科技」的订单',
    check(p) {
      assert.ok(p.filters.some((f) => f.field === 'customer' && f.op === 'like' && f.value === '科技'));
    },
  },
  {
    q: '金额在 100 到 800 之间的待支付订单',
    check(p) {
      const amounts = p.filters.filter((f) => f.field === 'amount');
      assert.equal(amounts.length, 2);
      assert.deepEqual(amounts.map((f) => f.op).sort(), ['gte', 'lte']);
      assert.ok(p.filters.some((f) => f.field === 'status' && f.value === '待支付'));
    },
  },
  {
    q: '华北和华南地区已取消的订单',
    check(p) {
      const f = p.filters.find((x) => x.field === 'region');
      assert.equal(f.op, 'in');
      assert.deepEqual([...f.value].sort(), ['华北', '华南'].sort());
    },
  },
  {
    q: '今天下的单',
    check(p) {
      assert.equal(p.dateFrom, '2026-11-11');
      assert.equal(p.dateTo, '2026-11-11');
    },
  },
  {
    q: '订单号 A202611 的一笔订单',
    check(p) {
      assert.ok(p.filters.some((f) => f.field === 'orderNo' && f.value.includes('A202611')));
    },
  },
  {
    q: '前 5 笔金额大于 3000 的订单',
    check(p) {
      assert.equal(p.limit, 5);
      assert.ok(p.filters.some((f) => f.field === 'amount' && f.op === 'gt' && f.value === 3000));
    },
  },
  {
    q: '2026-10-08 的订单',
    check(p) {
      assert.equal(p.dateFrom, '2026-10-08');
      assert.equal(p.dateTo, '2026-10-08');
      // 日期不能被误读成金额区间
      assert.equal(p.filters.filter((f) => f.field === 'amount').length, 0);
    },
  },
  {
    q: '按渠道统计订单数',
    check(p) {
      // 聚合类问题不硬编条件，给一句说明就好
      assert.equal(p.filters.length, 0);
      assert.ok(p.reason.length > 0);
    },
  },
  {
    q: '小程序渠道按月看趋势',
    check(p) {
      // 「按 X 看」是展示诉求，只落到 chart，不影响 filters
      assert.equal(p.chart?.groupBy, 'month');
      assert.ok(p.filters.some((f) => f.field === 'channel' && f.value === '小程序'));
    },
  },
];

let failed = 0;
for (const { q, check } of CASES) {
  try {
    check(parse(q));
    console.log(`✅ ${q}`);
  } catch (e) {
    failed++;
    console.log(`❌ ${q}`);
    console.log(`   ${e.message}`);
  }
}

// 引擎的 smoke test：条件真的能筛出数据
if (rows.length) {
  const plan = parse('上个月华东区退款超过 500 的订单');
  const r = runQuery(rows, plan);
  assert.ok(r.total < rows.length, '筛选后条数应该变少');
  assert.ok(r.rows.every((o) => o.region === '华东' && o.status === '已退款' && o.amount > 500));
  console.log(`✅ 引擎：${r.total} 条命中，合计 ¥${r.stats.sum}`);
}

console.log(failed ? `\n${failed} 个用例失败` : `\n全部 ${CASES.length} 个用例通过`);
process.exitCode = failed ? 1 : 0;
