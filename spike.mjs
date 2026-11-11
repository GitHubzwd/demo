// spike.mjs —— 第一天要跑的东西
// 目的：验证「中文问题 → JSON 查询条件」这条路走不走得通
//
// 用法（PowerShell）：
//   $env:DEEPSEEK_API_KEY="sk-你的key"
//   node spike.mjs
//
// 成本：跑完大约几分钱

const KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = process.env.MODEL || 'deepseek-chat';
const BASE = process.env.BASE_URL || 'https://api.deepseek.com';

if (!KEY) {
  console.error('缺少 DEEPSEEK_API_KEY。PowerShell 里先执行：$env:DEEPSEEK_API_KEY="sk-..."');
  process.exit(1);
}

// ---------- 数据字典：模型只能在这几个字段里选 ----------
const FIELDS = ['orderNo', 'customer', 'amount', 'region', 'status', 'channel', 'createdAt'];
const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'like'];
const ENUMS = {
  region: ['华东', '华北', '华南', '西南', '其他'],
  status: ['待支付', '已支付', '已退款', '已取消'],
  channel: ['APP', 'H5', '小程序', '公众号'],
};

const SCHEMA_DOC = `
可用字段（只能从这里选，不许编造）：
- orderNo   订单号    string
- customer  客户名称  string
- amount    金额      number（单位：元）
- region    地区      enum: ${ENUMS.region.join(' | ')}
- status    状态      enum: ${ENUMS.status.join(' | ')}
- channel   渠道      enum: ${ENUMS.channel.join(' | ')}
- createdAt 下单时间  string（YYYY-MM-DD）
`;

const today = new Date();
const pad = (n) => String(n).padStart(2, '0');
const TODAY = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

const SYSTEM = `你是「订单查询条件生成器」。把用户的中文问题转换成 JSON 查询条件。

${SCHEMA_DOC}
今天是 ${TODAY}。

只输出 JSON，结构固定为：
{
  "filters": [{"field": "字段", "op": "eq|ne|gt|gte|lt|lte|in|like", "value": 值}],
  "dateFrom": "YYYY-MM-DD" 或 null,
  "dateTo": "YYYY-MM-DD" 或 null,
  "sort": {"field": "字段", "order": "asc|desc"} 或 null,
  "limit": 50,
  "reason": "一句话说明你的理解"
}

规则：
1. filters 只能使用上面列出的字段和 op，枚举值必须完全一致。
2. 「上个月」「最近一周」等相对时间，按今天是 ${TODAY} 换算成具体日期。
3. 金额比较用 gt/gte/lt/lte；地区、状态、渠道用 eq 或 in。
4. 如果问题无法用这些字段表达，返回 {"filters": [], "dateFrom": null, "dateTo": null, "sort": null, "limit": 50, "reason": "无法解析：..."}，不要瞎编字段。
5. 订单号、客户名称这类字符串：只有用户给的值本身就是完整值时才用 eq（完整订单号形如 A2026111151），否则用 like 做包含匹配——用户很可能只给了单号片段。
6. 不要输出 SQL，不要输出任何解释文字。`;

// ---------- 校验：结构 + 字段白名单 + 枚举 + 类型 ----------
function validate(obj) {
  const errs = [];
  if (!obj || typeof obj !== 'object') return ['不是对象'];
  if (!Array.isArray(obj.filters)) errs.push('filters 不是数组');

  for (const f of obj.filters || []) {
    if (!FIELDS.includes(f.field)) errs.push(`非法字段 ${f.field}`);
    if (!OPS.includes(f.op)) errs.push(`非法操作符 ${f.op}`);
    if (f.field === 'amount' && typeof f.value !== 'number' && !Array.isArray(f.value)) {
      errs.push(`amount 的 value 不是数字：${JSON.stringify(f.value)}`);
    }
    if (ENUMS[f.field]) {
      const vals = Array.isArray(f.value) ? f.value : [f.value];
      for (const v of vals) if (!ENUMS[f.field].includes(v)) errs.push(`非法枚举 ${f.field}=${v}`);
    }
    if (f.op === 'in' && !Array.isArray(f.value)) errs.push('in 的 value 必须是数组');
  }
  if (obj.sort && !FIELDS.includes(obj.sort.field)) errs.push('sort 字段非法');
  return errs;
}

// ---------- 测试用例：跑完看通过率 ----------
const CASES = [
  ['上个月华东区退款超过 500 的订单', (o) => o.filters.some(f => f.field === 'region' && f.value === '华东')
    && o.filters.some(f => f.field === 'status' && f.value === '已退款')
    && o.filters.some(f => f.field === 'amount' && ['gt', 'gte'].includes(f.op))],
  ['这个月已支付的订单，按金额从高到低', (o) => o.filters.some(f => f.field === 'status' && f.value === '已支付')
    && o.sort && o.sort.field === 'amount' && o.sort.order === 'desc'],
  ['小程序渠道最近 7 天的订单', (o) => o.filters.some(f => f.field === 'channel' && f.value === '小程序')
    && !!o.dateFrom],
  ['客户名称包含「科技」的订单', (o) => o.filters.some(f => f.field === 'customer' && (f.op === 'like' || String(f.value).includes('科技')))],
  ['金额在 100 到 800 之间的待支付订单', (o) => o.filters.filter(f => f.field === 'amount').length >= 2
    && o.filters.some(f => f.field === 'status' && f.value === '待支付')],
  ['华北和华南地区已取消的订单', (o) => o.filters.some(f => f.field === 'region'
    && (f.op === 'in' ? f.value.includes('华北') && f.value.includes('华南') : false))],
  ['今天下的单', (o) => o.dateFrom === TODAY && o.dateTo === TODAY],
  ['订单号 A202611的一笔订单', (o) => o.filters.some(f => f.field === 'orderNo' && String(f.value).includes('A202611'))],
  ['帮我看看最近的情况', (o) => o.filters.length === 0 || !!o.reason],
  ['按渠道统计订单数', (o) => o.filters.length === 0 && !!o.reason],
];

// ---------- 调模型 ----------
async function toQuery(question) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: question },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  let text = data.choices?.[0]?.message?.content ?? '';
  text = text.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  return { obj: JSON.parse(text), ms: Date.now() - t0, usage: data.usage };
}

// ---------- 主流程 ----------
let pass = 0;
let totalMs = 0;
let cost = 0;

for (const [q, check] of CASES) {
  try {
    const { obj, ms, usage } = await toQuery(q);
    totalMs += ms;
    cost += ((usage?.prompt_tokens || 0) * 0.000001 + (usage?.completion_tokens || 0) * 0.000002);
    const errs = validate(obj);
    const ok = errs.length === 0 && check(obj);
    if (ok) pass++;
    console.log(`${ok ? '✅' : '❌'} ${q}  (${ms}ms)`);
    if (!ok) console.log('   →', JSON.stringify(obj), errs.length ? `错误：${errs.join('; ')}` : '');
  } catch (e) {
    console.log(`💥 ${q}  ${e.message}`);
  }
}

console.log('\n----------------------------------------');
console.log(`通过率：${pass}/${CASES.length}`);
console.log(`平均延迟：${Math.round(totalMs / CASES.length)}ms`);
console.log(`本次花费约：¥${cost.toFixed(4)}`);
console.log('----------------------------------------');
console.log(pass >= 8
  ? '结论：这条路可行，可以进入 UI 开发。'
  : '结论：先别写 UI。改 prompt / 加 few-shot 例子 / 换模型，再跑一次。');
