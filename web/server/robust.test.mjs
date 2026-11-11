// robust.test.mjs —— 异常路径的回归：白名单拦截、「没看懂」判定、错误文案
//
//   node web/server/robust.test.mjs

import assert from 'node:assert/strict';

import { isUnparsed } from './core.mjs';
import { describeError } from './parser.mjs';
import { normalizeQuery, validateQuery } from './schema.mjs';

let failed = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`❌ ${name}\n   ${e.message}`);
  }
};

const base = { filters: [], dateFrom: null, dateTo: null, sort: null, limit: 50, chart: null, reason: '' };

// ---------------- 白名单拦截
test('模型编造字段 → 被拦下', () => {
  const errs = validateQuery({ ...base, filters: [{ field: 'profitRate', op: 'gt', value: 20 }] });
  assert.ok(errs.some((e) => e.includes('非法字段 profitRate')));
});

test('模型编造操作符 → 被拦下', () => {
  const errs = validateQuery({ ...base, filters: [{ field: 'amount', op: 'between', value: 1 }] });
  assert.ok(errs.some((e) => e.includes('非法操作符')));
});

test('枚举值写错 → 被拦下', () => {
  const errs = validateQuery({ ...base, filters: [{ field: 'status', op: 'eq', value: '已发货' }] });
  assert.ok(errs.some((e) => e.includes('非法枚举')));
});

test('图表维度越界 → 被拦下', () => {
  const errs = validateQuery({ ...base, chart: { groupBy: 'customer' } });
  assert.ok(errs.some((e) => e.includes('chart.groupBy')));
});

test('干净的输出 → 放行', () => {
  assert.equal(validateQuery({ ...base, filters: [{ field: 'amount', op: 'gt', value: 500 }] }).length, 0);
});

// ---------------- 「没看懂」判定
test('模型说无法解析 + 没有条件 → 算没看懂', () => {
  assert.equal(isUnparsed({ ...base, reason: '无法解析：问题太笼统' }, 'ai'), true);
});

test('模型正常返回空条件（比如「全部订单」）→ 不算没看懂', () => {
  assert.equal(isUnparsed({ ...base, reason: '查询全部订单' }, 'ai'), false);
});

test('有任何条件就不算没看懂', () => {
  assert.equal(isUnparsed({ ...base, filters: [{ field: 'amount', op: 'gt', value: 1 }], reason: '' }, 'ai'), false);
});

test('规则兜底什么都没解析出来 → 算没看懂', () => {
  assert.equal(isUnparsed({ ...base, reason: '规则解析没有识别出可用的筛选条件' }, 'rule'), true);
});

// ---------------- 错误文案
test('超时 → 人话', () => {
  assert.match(describeError(Object.assign(new Error('x'), { name: 'TimeoutError' })), /没响应/);
});

test('用户取消 → 人话', () => {
  assert.match(describeError(Object.assign(new Error('x'), { name: 'AbortError' })), /中断/);
});

test('接口报错 → 不把 HTTP 细节甩给用户', () => {
  assert.equal(describeError(new Error('模型接口 HTTP 500：{"error":...}')), '模型接口报错');
});

test('校验失败 → 说清楚是条件的问题', () => {
  assert.match(describeError(new Error('模型输出没通过校验：非法字段 profitRate')), /条件没通过校验/);
});

// ---------------- 兜底补齐
test('normalizeQuery 补齐 chart 字段', () => {
  assert.deepEqual(normalizeQuery({ filters: [] }).chart, null);
  assert.deepEqual(normalizeQuery({ filters: [], chart: { groupBy: 'month' } }).chart, { groupBy: 'month' });
  assert.equal(normalizeQuery({ filters: [], chart: { groupBy: 'nope' } }).chart, null);
});

console.log(failed ? `\n${failed} 项失败` : '\n异常路径全部符合预期');
process.exitCode = failed ? 1 : 0;
