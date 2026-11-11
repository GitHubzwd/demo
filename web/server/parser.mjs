// parser.mjs —— 中文问题 → JSON 查询条件
//
// 两条路：
//   parseWithAI()    走 DeepSeek，主路径；prompt 与 spike.mjs 完全一致
//   parseWithRules() 本地关键词兜底，没有 Key / 接口挂了也能把 demo 跑起来
//
// 兜底不是「假装 AI」，接口返回里会明确告诉前端 source=rule，
// 页面上也会显示「规则兜底」角标，不糊弄人。

import { ENUMS, normalizeQuery, validateQuery, buildSystemPrompt, todayStr } from './schema.mjs';

const KEY = () => process.env.DEEPSEEK_API_KEY || '';
const MODEL = () => process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const BASE = () => process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';

/** 模型超时。Vercel Hobby 单次函数 10s，留 2s 给查询和网络；测试时可以调小来演练超时 */
const TIMEOUT_MS = () => Number(process.env.DEEPSEEK_TIMEOUT_MS || 8000);

export function aiConfigured() {
  return Boolean(KEY());
}

/**
 * 把各种失败翻译成一句人话，直接给用户看。
 * 原始错误（英文 DOMException / HTTP 状态码）不该出现在界面上。
 */
export function describeError(e) {
  const name = e?.name || '';
  if (name === 'TimeoutError') {
    const ms = TIMEOUT_MS();
    return `模型超过 ${ms >= 1000 ? `${Math.round(ms / 1000)} 秒` : `${ms} 毫秒`}没响应`;
  }
  if (name === 'AbortError') return '请求被中断';
  const msg = String(e?.message || e);
  if (msg.startsWith('模型输出没通过校验')) return msg.replace('模型输出没通过校验：', '条件没通过校验：');
  if (msg.startsWith('模型接口 HTTP')) return '模型接口报错';
  return msg;
}

/** 把模型吐出来的原始文本变成 plan：去代码围栏 → 解析 → 校验 */
function toQuery(rawText) {
  const text = rawText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error(`模型返回的不是 JSON：${text.slice(0, 120)}`);
  }
  const errs = validateQuery(obj);
  if (errs.length) throw new Error(`模型输出没通过校验：${errs.join('；')}`);
  return normalizeQuery(obj);
}

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY()}` };
}

function requestBody(question, stream, context) {
  return JSON.stringify({
    model: MODEL(),
    messages: [
      { role: 'system', content: buildSystemPrompt(todayStr(), context) },
      { role: 'user', content: question },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    ...(stream ? { stream: true } : {}),
  });
}

/** 调模型。任何失败都抛出，由上层决定是否退到规则解析。 */
export async function parseWithAI(question, { timeoutMs = TIMEOUT_MS(), context = null } = {}) {
  // 8s 是给 Vercel 留的余量：Hobby 计划单次函数最多 10s，
  // 模型要是卡住，宁可超时退到规则解析，也别让用户对着转圈的按钮等 30 秒。
  const key = KEY();
  if (!key) throw new Error('未配置 DEEPSEEK_API_KEY');

  const t0 = Date.now();
  const res = await fetch(`${BASE()}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(),
    body: requestBody(question, false, context),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new Error(`模型接口 HTTP ${res.status}：${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  const query = toQuery(data.choices?.[0]?.message?.content ?? '');

  return { query, ms: Date.now() - t0, usage: data.usage ?? null };
}

/**
 * 流式版：边收边把增量交给 onDelta，收完再返回解析结果。
 *
 * 为什么值得做：用户看到的不是转圈，而是「模型正在把这句话翻译成条件」——
 * 首字 0.5s 和整体 1s 的差别，在感知上比数字大得多。
 *
 * @param {(text: string) => void} onDelta 每收到一段增量文本调用一次
 * @param {AbortSignal} [signal] 用户点「取消」时中止，同时掐断上游请求（省 token）
 */
export async function parseWithAIStream(question, { onDelta = () => {}, timeoutMs = TIMEOUT_MS(), signal, context = null } = {}) {
  const key = KEY();
  if (!key) throw new Error('未配置 DEEPSEEK_API_KEY');

  const t0 = Date.now();
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const res = await fetch(`${BASE()}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(),
    body: requestBody(question, true, context),
    signal: combined,
  });

  if (!res.ok) throw new Error(`模型接口 HTTP ${res.status}：${(await res.text()).slice(0, 200)}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let firstTokenMs = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // SSE 必须按空行分帧：一个事件可能跨两个 chunk，按 chunk 切会丢字符
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);

        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;

          let delta;
          try {
            delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
          } catch {
            continue; // 个别 provider 会夹杂非 JSON 的心跳行
          }
          if (!delta) continue;
          if (firstTokenMs === null) firstTokenMs = Date.now() - t0;
          text += delta;
          onDelta(delta);
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  if (!text.trim()) throw new Error('模型没有返回任何内容');
  return { query: toQuery(text), ms: Date.now() - t0, firstTokenMs, raw: text };
}

// ---------------------------------------------------------------- 规则兜底

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const AMOUNT_KW = [
  [/不少于|不低于|至少|最少/, 'gte'],
  [/不超过|不多于|至多|最多/, 'lte'],
  [/超过|大于|高于|多于/, 'gt'],
  [/不到|低于|小于|少于/, 'lt'],
];

const STATUS_KW = [
  [/已退款|退款|退单|退货/, '已退款'],
  [/已取消|取消/, '已取消'],
  [/待支付|待付款|未支付|未付款|没付款/, '待支付'],
  [/已支付|已付款|付过款|付款/, '已支付'],
];

const CHANNEL_KW = [
  [/小程序/, '小程序'],
  [/公众号/, '公众号'],
  [/APP|app/, 'APP'],
  [/H5|h5/, 'H5'],
];

/**
 * 本地关键词解析。只求「常用问法能用」，不求覆盖全部自然语言。
 * 每识别出一个条件就把它从句子里挖掉，避免同一个数字被当成金额又当成天数。
 */
export function parseWithRules(question, now = new Date()) {
  let s = String(question || '');
  const filters = [];
  const notes = [];
  let dateFrom = null;
  let dateTo = null;
  let sort = null;
  let limit = 50;

  const eat = (re) => {
    const m = s.match(re);
    if (m) s = s.replace(re, ' ');
    return m;
  };

  // 1) 订单号先挖掉，否则 A202611 里的数字会被当成金额或日期
  const orderNo = eat(/([A-Za-z]\d{6,})/);
  if (orderNo) {
    filters.push({ field: 'orderNo', op: 'like', value: orderNo[1].toUpperCase() });
    notes.push(`订单号包含 ${orderNo[1].toUpperCase()}`);
  }

  // 2) 写死的日期区间，如 2026-10-01 到 2026-10-31
  const explicit = eat(/(\d{4}-\d{1,2}-\d{1,2})\s*(?:到|至|~|-)\s*(\d{4}-\d{1,2}-\d{1,2})/);
  if (explicit) {
    const norm = (v) => v.split('-').map((x) => pad(Number(x))).join('-');
    dateFrom = norm(explicit[1]);
    dateTo = norm(explicit[2]);
    notes.push(`下单时间 ${dateFrom} ~ ${dateTo}`);
  } else {
    // 单个写死日期：2026-10-01 当天的订单。挖掉它，免得 2026-10 被当成金额区间
    const lone = eat(/(\d{4}-\d{1,2}-\d{1,2})/);
    if (lone) {
      const d = lone[1].split('-').map((x) => pad(Number(x))).join('-');
      dateFrom = dateTo = d;
      notes.push(`下单时间 ${d}`);
    }
  }

  // 3) 相对时间
  if (!dateFrom && !dateTo) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (eat(/今天|今日/)) {
      dateFrom = dateTo = fmt(today);
      notes.push(`今天（${dateTo}）`);
    } else if (eat(/昨天|昨日/)) {
      dateFrom = dateTo = fmt(addDays(today, -1));
      notes.push(`昨天（${dateTo}）`);
    } else if (eat(/前天/)) {
      dateFrom = dateTo = fmt(addDays(today, -2));
      notes.push(`前天（${dateTo}）`);
    } else if (eat(/上个月|上月/)) {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      dateFrom = fmt(first);
      dateTo = fmt(new Date(today.getFullYear(), today.getMonth(), 0));
      notes.push(`上个月 ${dateFrom} ~ ${dateTo}`);
    } else if (eat(/这个月|本月|当月/)) {
      dateFrom = fmt(new Date(today.getFullYear(), today.getMonth(), 1));
      dateTo = fmt(today);
      notes.push(`这个月 ${dateFrom} ~ ${dateTo}`);
    } else {
      const recent = eat(/最近\s*(\d+)\s*天|近\s*(\d+)\s*天|最近\s*(\d+)\s*日/);
      if (recent) {
        const n = Number(recent[1] || recent[2] || recent[3]);
        dateFrom = fmt(addDays(today, -(n - 1)));
        dateTo = fmt(today);
        notes.push(`最近 ${n} 天 ${dateFrom} ~ ${dateTo}`);
      } else if (eat(/最近(?:一)?周|近(?:一)?周|最近七天|近七天/)) {
        dateFrom = fmt(addDays(today, -6));
        dateTo = fmt(today);
        notes.push(`最近 7 天 ${dateFrom} ~ ${dateTo}`);
      } else if (eat(/最近(?:一)?个?月|近(?:一)?个?月/)) {
        dateFrom = fmt(addDays(today, -29));
        dateTo = fmt(today);
        notes.push(`最近 30 天 ${dateFrom} ~ ${dateTo}`);
      } else if (eat(/今年/)) {
        dateFrom = `${today.getFullYear()}-01-01`;
        dateTo = fmt(today);
        notes.push(`今年 ${dateFrom} ~ ${dateTo}`);
      }
    }
  }

  // 4) 金额区间：100 到 800 之间
  const range = eat(/(?:在|介于)?\s*(\d+(?:\.\d+)?)\s*(?:元|块)?\s*(?:到|至|~|—)\s*(\d+(?:\.\d+)?)\s*(?:元|块)?\s*(?:之间|中间)?/);
  if (range) {
    const lo = Number(range[1]);
    const hi = Number(range[2]);
    filters.push({ field: 'amount', op: 'gte', value: lo });
    filters.push({ field: 'amount', op: 'lte', value: hi });
    notes.push(`金额 ${lo} ~ ${hi} 元`);
  }

  // 5) 金额比较：超过 500 / 不低于 300 / 最多 200
  const kw = eat(/(不少于|不低于|至少|最少|不超过|不多于|至多|最多|超过|大于|高于|多于|不到|低于|小于|少于)\s*(?:¥|￥)?\s*(\d+(?:\.\d+)?)\s*(?:元|块)?/);
  if (kw) {
    const op = AMOUNT_KW.find(([re]) => re.test(kw[1]))?.[1] ?? 'gt';
    const value = Number(kw[2]);
    filters.push({ field: 'amount', op, value });
    notes.push(`金额 ${kw[1]} ${value} 元`);
  } else {
    const above = eat(/(\d+(?:\.\d+)?)\s*(?:元|块)?\s*(以上|及以上)/);
    const below = !above && eat(/(\d+(?:\.\d+)?)\s*(?:元|块)?\s*(以下|及以下)/);
    if (above) {
      filters.push({ field: 'amount', op: 'gte', value: Number(above[1]) });
      notes.push(`金额 ≥ ${above[1]} 元`);
    } else if (below) {
      filters.push({ field: 'amount', op: 'lte', value: Number(below[1]) });
      notes.push(`金额 ≤ ${below[1]} 元`);
    }
  }

  // 6) 条数上限：前 20 条
  const top = eat(/(?:前|头|top)\s*(\d+)\s*(?:条|笔|个|单|行)/i);
  if (top) limit = Math.min(Math.max(Number(top[1]), 1), 500);

  // 7) 枚举：先状态（把「待支付」吃掉，避免它又被识别成「已支付」），再渠道、地区
  const statuses = [];
  for (const [re, val] of STATUS_KW) {
    if (eat(re)) statuses.push(val);
  }
  if (statuses.length) {
    filters.push(
      statuses.length === 1
        ? { field: 'status', op: 'eq', value: statuses[0] }
        : { field: 'status', op: 'in', value: [...new Set(statuses)] },
    );
    notes.push(`状态 ${[...new Set(statuses)].join(' / ')}`);
  }

  const channels = [];
  for (const [re, val] of CHANNEL_KW) {
    if (eat(re)) channels.push(val);
  }
  if (channels.length) {
    filters.push(
      channels.length === 1
        ? { field: 'channel', op: 'eq', value: channels[0] }
        : { field: 'channel', op: 'in', value: [...new Set(channels)] },
    );
    notes.push(`渠道 ${[...new Set(channels)].join(' / ')}`);
  }

  const regions = ENUMS.region.filter((r) => (s.includes(r) ? (s = s.replace(r, ' '), true) : false));
  if (regions.length) {
    filters.push(
      regions.length === 1
        ? { field: 'region', op: 'eq', value: regions[0] }
        : { field: 'region', op: 'in', value: regions },
    );
    notes.push(`地区 ${regions.join(' / ')}`);
  }

  // 8) 客户名称：优先引号里的，其次「客户包含 XX」，最后靠公司名后缀猜
  const quoted = eat(/包含\s*[「“"'']([^」”"'']{2,12})[」”"'']/);
  const named =
    quoted ||
    eat(/(?:客户|公司)(?:名称|名字)?(?:包含|含有|含|带|叫|是)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,12})/) ||
    s.match(/([\u4e00-\u9fa5]{2,4}(?:科技|信息|贸易|电子|物流|实业|数据|设备|医疗|文化|智能|教育))/);
  if (named) {
    const value = String(named[1] || named[0])
      .trim()
      .replace(/(?:的订单|订单|的|呢|吗|啊)+$/g, '');
    filters.push({ field: 'customer', op: 'like', value });
    notes.push(`客户名称包含「${value}」`);
  }

  // 9) 排序
  const sortMatch = s.match(
    /(?:按|按照|以)?\s*(金额|下单时间|时间|日期)\s*(从高到低|从大到小|降序|倒序|由高到低|从低到高|从小到大|升序|由低到高)/,
  );
  if (sortMatch) {
    const field = /金额/.test(sortMatch[1]) ? 'amount' : 'createdAt';
    const order = /高|大|降|倒/.test(sortMatch[2]) ? 'desc' : 'asc';
    sort = { field, order };
    notes.push(`按${field === 'amount' ? '金额' : '下单时间'}${order === 'desc' ? '从高到低' : '从低到高'}`);
  } else if (/(?:最新|最近的单|按时间倒序)/.test(s)) {
    sort = { field: 'createdAt', order: 'desc' };
    notes.push('按下单时间从新到旧');
  }

  // 10) 图表维度：按地区拆 / 看渠道分布 / 按月看趋势。
  //     注意这里读的是原句而不是挖过的 s —— 用户在追问里说的「按」通常就是图，不是排序。
  let chart = null;
  const chartMatch = String(question).match(/按\s*(地区|渠道|状态|月份|月)\s*(?:拆|分|看|统计|对比|汇总|展示)?/);
  if (chartMatch) {
    const map = { 地区: 'region', 渠道: 'channel', 状态: 'status', 月份: 'month', 月: 'month' };
    chart = { groupBy: map[chartMatch[1]] };
    notes.push(`按${chartMatch[1]}看图`);
  }

  const reason = notes.length
    ? `规则解析：${notes.join('，')}`
    : '规则解析没有识别出可用的筛选条件——试试「上个月华东区退款超过 500 的订单」这种问法。';

  return normalizeQuery({ filters, dateFrom, dateTo, sort, limit, chart, reason });
}
