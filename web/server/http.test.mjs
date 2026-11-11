// 用 Node 自带的 Request/Response 直接打 Fetch 适配层：
// 不起服务器、不起浏览器，也能验证 EdgeOne 那套入口是通的。
//
//   node web/server/http.test.mjs

import assert from 'node:assert/strict';

const { metaRequest, queryRequest, streamRequest, summaryRequest } = await import('./http.mjs');

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

const jsonHeaders = { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' };
const post = (path, body) => new Request(`https://example.com${path}`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) });

await test('GET /api/meta 返回 5000 条数据（数据已内联，不依赖文件系统）', async () => {
  const res = await metaRequest();
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.totalOrders, 5000);
  assert.ok(data.examples.length > 0);
});

await test('POST /api/query 正常出结果', async () => {
  const res = await queryRequest(post('/api/query', { question: '上个月华东区退款超过 500 的订单' }));
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.source, 'ai');
  assert.equal(data.total, 23);
  assert.equal(data.rows.length, 10);
});

await test('POST /api/query 空问题 → 400', async () => {
  const res = await queryRequest(post('/api/query', { question: '' }));
  assert.equal(res.status, 400);
});

await test('GET /api/query → 405', async () => {
  const res = await queryRequest(new Request('https://example.com/api/query'));
  assert.equal(res.status, 405);
});

await test('POST /api/summary 与表格同口径', async () => {
  const q = await (await queryRequest(post('/api/query', { question: '这个月已支付的订单' }))).json();
  const s = await (await summaryRequest(post('/api/summary', { plan: q.plan, groupBy: 'region' }))).json();
  const count = s.buckets.reduce((a, b) => a + b.count, 0);
  assert.equal(count, q.returned);
});

await test('POST /api/stream 返回 SSE 且事件顺序正确', async () => {
  const res = await streamRequest(post('/api/stream', { question: '小程序渠道最近 7 天的订单' }));
  assert.equal(res.headers.get('content-type')?.includes('text/event-stream'), true);

  const text = await res.text();
  const events = [...text.matchAll(/^event: (\w+)/gm)].map((m) => m[1]);
  assert.ok(events.includes('delta'), '应该有 delta');
  assert.ok(events.includes('plan'), '应该有 plan');
  assert.ok(events.includes('rows'), '应该有 rows');
  assert.equal(events.at(-1), 'done');
  console.log(`   事件序列：${[...new Set(events)].join(' → ')}（delta × ${events.filter((e) => e === 'delta').length}）`);
});

await test('POST /api/stream 限流后返回 429 事件', async () => {
  // 用空问题轰炸：不发模型请求，但每次都会消耗限流额度
  const many = await Promise.all(
    Array.from({ length: 25 }, () => streamRequest(post('/api/stream', { question: '' })).then((r) => r.text())),
  );
  const limited = many.filter((t) => t.includes('查得太快')).length;
  assert.ok(limited > 0, '超过每分钟 20 次应当被限流');
  console.log(`   25 次并发里有 ${limited} 次被限流`);
});

console.log(failed ? `\n${failed} 项失败` : '\nFetch 适配层全部通过');
process.exitCode = failed ? 1 : 0;
