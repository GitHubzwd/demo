// schema.mjs —— 全项目唯一的「字段白名单」
// 模型能用的字段、枚举、操作符只在这里定义一次，
// prompt 生成、结果校验、前端回显都读这一份，避免三处漂移。

export const FIELDS = ['orderNo', 'customer', 'amount', 'region', 'status', 'channel', 'createdAt'];

export const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'like'];

export const ENUMS = {
  region: ['华东', '华北', '华南', '西南', '其他'],
  status: ['待支付', '已支付', '已退款', '已取消'],
  channel: ['APP', 'H5', '小程序', '公众号'],
};

export const FIELD_META = [
  { key: 'orderNo', label: '订单号', type: 'string' },
  { key: 'customer', label: '客户名称', type: 'string' },
  { key: 'amount', label: '金额', type: 'number', unit: '元' },
  { key: 'region', label: '地区', type: 'enum', enum: ENUMS.region },
  { key: 'status', label: '状态', type: 'enum', enum: ENUMS.status },
  { key: 'channel', label: '渠道', type: 'enum', enum: ENUMS.channel },
  { key: 'createdAt', label: '下单时间', type: 'date' },
];

export const OP_LABELS = {
  eq: '=',
  ne: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  in: '属于',
  like: '包含',
};

// 输入框下面的快捷示例：点一下就能跑，陌生人 30 秒能玩明白
export const EXAMPLES = [
  '上个月华东区退款超过 500 的订单',
  '这个月已支付的订单，按金额从高到低',
  '小程序渠道最近 7 天的订单',
  '金额在 100 到 800 之间的待支付订单',
  '客户名称包含「科技」的订单',
];

const pad = (n) => String(n).padStart(2, '0');

/** 今天，YYYY-MM-DD（服务器本地时区） */
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const SCHEMA_DOC = `
可用字段（只能从这里选，不许编造）：
- orderNo   订单号    string
- customer  客户名称  string
- amount    金额      number（单位：元）
- region    地区      enum: ${ENUMS.region.join(' | ')}
- status    状态      enum: ${ENUMS.status.join(' | ')}
- channel   渠道      enum: ${ENUMS.channel.join(' | ')}
- createdAt 下单时间  string（YYYY-MM-DD）
`.trim();

/**
 * 生成 system prompt —— 和 spike.mjs 里那份保持一致。
 * 改 prompt 之后要回 spike.mjs 跑一遍回归，别靠感觉。
 *
 * context 存在时说明这是追问：把上一轮的问题和条件一起给它，
 * 让模型「改条件」而不是「重新猜」。
 */
export function buildSystemPrompt(today = todayStr(), context = null) {
  const base = `你是「订单查询条件生成器」。把用户的中文问题转换成 JSON 查询条件。

${SCHEMA_DOC}
今天是 ${today}。

只输出 JSON，结构固定为：
{
  "filters": [{"field": "字段", "op": "eq|ne|gt|gte|lt|lte|in|like", "value": 值}],
  "dateFrom": "YYYY-MM-DD" 或 null,
  "dateTo": "YYYY-MM-DD" 或 null,
  "sort": {"field": "字段", "order": "asc|desc"} 或 null,
  "limit": 50,
  "chart": {"groupBy": "region|channel|status|month"} 或 null,
  "reason": "一句话说明你的理解"
}

规则：
1. filters 只能使用上面列出的字段和 op，枚举值必须完全一致。
2. 「上个月」「最近一周」等相对时间，按今天是 ${today} 换算成具体日期。
3. 金额比较用 gt/gte/lt/lte；地区、状态、渠道用 eq 或 in。
4. 如果问题无法用这些字段表达，返回 {"filters": [], "dateFrom": null, "dateTo": null, "sort": null, "limit": 50, "chart": null, "reason": "无法解析：..."}，不要瞎编字段。
5. 订单号、客户名称这类字符串：只有用户给的值本身就是完整值时才用 eq（完整订单号形如 A2026111151），否则用 like 做包含匹配——用户很可能只给了单号片段。
6. chart 只表示「用哪个维度画图」，不影响 filters；用户没说要看图就填 null。
7. 不要输出 SQL，不要输出任何解释文字。`;

  if (!context) return base;

  return `${base}

这是多轮对话。上一轮：
用户问：「${context.question}」
当时的条件：${JSON.stringify(context.plan)}

用户现在这句是对上一轮的补充或修改。补充规则：
8. 保留上一轮里仍然成立的条件，只改这轮提到的部分；输出的是**完整的新条件**，不是补丁。
9. 用户说「去掉 / 不要 X」时，删掉对应的 filter 或时间范围。
10. 用户说「按 X 拆 / 按 X 看 / 看趋势 / 出个图」时，把 chart.groupBy 设成 region|channel|status|month，**不要**因此改动 filters。
11. 如果这轮明显是另起一个话题，忽略上文，按新问题正常解析。`;
}

export const GROUPABLE = ['region', 'channel', 'status', 'month'];

/**
 * 校验模型输出：结构 + 字段白名单 + 操作符 + 枚举 + 类型。
 * 返回错误数组，空数组代表合法。这是「不让模型乱来」的最后一道闸。
 */
export function validateQuery(obj) {
  const errs = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ['不是对象'];
  if (!Array.isArray(obj.filters)) errs.push('filters 不是数组');

  for (const f of obj.filters || []) {
    if (!f || typeof f !== 'object') {
      errs.push('filters 里混进了非对象');
      continue;
    }
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

  for (const k of ['dateFrom', 'dateTo']) {
    const v = obj[k];
    if (v != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) errs.push(`${k} 不是 YYYY-MM-DD`);
  }

  if (obj.sort) {
    if (!FIELDS.includes(obj.sort.field)) errs.push('sort 字段非法');
    if (!['asc', 'desc'].includes(obj.sort.order)) errs.push('sort.order 必须是 asc 或 desc');
  }

  // chart 只是展示方式，但也得管住：维度只能是这四个
  if (obj.chart != null) {
    if (typeof obj.chart !== 'object' || !GROUPABLE.includes(obj.chart.groupBy)) {
      errs.push(`chart.groupBy 只能是 ${GROUPABLE.join('/')}`);
    }
  }

  return errs;
}

/** 把模型输出补齐成固定形状，缺字段一律给默认值（前端不用到处判空） */
export function normalizeQuery(obj) {
  const chart = obj?.chart && GROUPABLE.includes(obj.chart.groupBy) ? { groupBy: obj.chart.groupBy } : null;
  return {
    filters: Array.isArray(obj?.filters) ? obj.filters : [],
    dateFrom: obj?.dateFrom || null,
    dateTo: obj?.dateTo || null,
    sort: obj?.sort || null,
    limit: Number.isFinite(obj?.limit) ? Math.min(Math.max(Number(obj.limit), 1), 500) : 50,
    chart,
    reason: typeof obj?.reason === 'string' ? obj.reason : '',
  };
}
