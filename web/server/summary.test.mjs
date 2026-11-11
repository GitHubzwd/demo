// summary.test.mjs —— 图表汇总的回归：口径必须和表格一致
//
//   node web/server/summary.test.mjs

import assert from 'node:assert/strict';

import { handleSummary } from './core.mjs';

const PLAN = {
  filters: [
    { field: 'status', op: 'eq', value: '已支付' },
    { field: 'amount', op: 'gt', value: 100 },
  ],
  dateFrom: '2026-10-01',
  dateTo: '2026-10-31',
  sort: { field: 'amount', order: 'desc' },
  limit: 30,
  reason: '测试用',
};

let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`❌ ${name}\n   ${e.message}`);
  }
};

for (const groupBy of ['region', 'channel', 'status', 'month']) {
  await test(`按 ${groupBy} 汇总：条数与金额都对得上`, async () => {
    const s = await handleSummary({ body: { plan: PLAN, groupBy } });
    const count = s.buckets.reduce((a, b) => a + b.count, 0);
    const amount = Math.round(s.buckets.reduce((a, b) => a + b.amount, 0) * 100) / 100;

    assert.equal(count, s.total.count, '各桶条数之和应等于总数');
    assert.ok(count <= PLAN.limit, `不应超过 limit（${count} <= ${PLAN.limit}）`);
    assert.equal(amount, s.total.amount, '各桶金额之和应等于总金额');
    assert.ok(s.buckets.length > 0, '应该至少有一个桶');
  });
}

await test('按月的 key 是 YYYY-MM 且升序', async () => {
  const s = await handleSummary({ body: { plan: { ...PLAN, limit: 200 }, groupBy: 'month' } });
  const keys = s.buckets.map((b) => b.key);
  for (const key of keys) assert.match(key, /^\d{4}-\d{2}$/);
  assert.deepEqual(keys, [...keys].sort());
});

await test('非法维度被拒', async () => {
  await assert.rejects(() => handleSummary({ body: { plan: PLAN, groupBy: 'customer' } }), /不支持的维度/);
});

await test('非法 filter 被拒', async () => {
  const bad = { ...PLAN, filters: [{ field: 'nope', op: 'eq', value: 1 }] };
  await assert.rejects(() => handleSummary({ body: { plan: bad, groupBy: 'region' } }), /条件不合法/);
});

console.log(failed ? `\n${failed} 项失败` : '\n汇总口径全部一致');
process.exitCode = failed ? 1 : 0;
