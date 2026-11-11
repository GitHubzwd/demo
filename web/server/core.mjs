// core.mjs —— 所有业务逻辑都在这里，和「请求从哪来」无关。
//
// 三个入口都只是薄壳，共用这一份：
//   web/server/plugin.mjs   → npm run dev（Vite 中间件）
//   api/meta.js, api/query.js → Vercel Function
//   server.mjs              → npm start（本地跑生产包）
//
// 这样「本地能跑、线上不能跑」这类问题就只剩环境差异，不会再有逻辑分叉。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runQuery, paginate } from './engine.mjs';
import { parseWithAI, parseWithAIStream, parseWithRules, aiConfigured, describeError } from './parser.mjs';
import { ENUMS, FIELD_META, EXAMPLES, todayStr, normalizeQuery, validateQuery } from './schema.mjs';

// 数据是静态模块（由 scripts/gen-data.mjs 生成，位于仓库根）：
// 打包器会把数组内联进函数，云端不需要文件系统，也不会有 ENOENT。
import { ORDERS } from '../../orders.data.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 环境变量文件：不写死 cwd —— 从 web/ 跑 dev 和从仓库根跑 server.mjs，cwd 是不一样的。
const ENV_CANDIDATES = [
  process.env.DOTENV_PATH,
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(HERE, '..', '.env.local'), // web/.env.local
  path.resolve(HERE, '..', '.env'),
  path.resolve(HERE, '..', '..', '.env.local'), // 仓库根
  path.resolve(HERE, '..', '..', '.env'),
  path.resolve(process.cwd(), '..', '.env'),
].filter(Boolean);

// ---------------------------------------------------------------- .env

let envLoaded = false;

export function loadEnvOnce() {
  if (envLoaded) return;
  envLoaded = true;
  // Vercel 上变量来自项目设置，这里读不到文件也没关系
  for (const file of ENV_CANDIDATES) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const value = m[2].replace(/^['"]|['"]$/g, '').trim();
      if (!process.env[m[1]] && value) process.env[m[1]] = value;
    }
  }
}

// ---------------------------------------------------------------- 数据

/** 数据是构建期内联进来的，这里不再有 fs / ENOENT 的可能 */
export function loadOrders() {
  return ORDERS;
}

// ---------------------------------------------------------------- 限流
// Vercel 是无状态的，进程内计数只能算「尽力而为」：
// 单实例里能挡住脚本刷接口，跨实例挡不住。要真限流得接 Upstash Redis 之类的共享存储。
// 免费额度被刷爆是这类 demo 最现实的风险，所以先放这一层，够用且有注释写明边界。

const WINDOW_MS = 60_000;
const LIMIT = Number(process.env.QUERY_RATE_LIMIT || 20);
const hits = new Map();

export function allowRequest(ip = 'unknown', now = Date.now()) {
  const rec = hits.get(ip);
  if (!rec || now >= rec.resetAt) {
    if (hits.size > 5000) hits.clear(); // 长时间运行别把内存耗光
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  rec.count += 1;
  return rec.count <= LIMIT;
}

// ---------------------------------------------------------------- 业务

export function getMeta() {
  loadEnvOnce();
  let totalOrders = 0;
  try {
    totalOrders = loadOrders().length;
  } catch {
    /* 数据还没生成时，页面别因此打不开 */
  }
  return {
    aiConfigured: aiConfigured(),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    today: todayStr(),
    totalOrders,
    rateLimitPerMinute: LIMIT,
    fields: FIELD_META,
    enums: ENUMS,
    examples: EXAMPLES,
  };
}

/**
 * 「没看懂」的判定。
 *
 * 模型说无法解析（prompt 里约定的前缀），或者规则兜底一条条件都没解析出来 ——
 * 这类请求会命中全量数据，直接摊一张 5000 条的表等于骗人，前端要换成引导态。
 */
export function isUnparsed(plan, source) {
  const empty = !plan.filters.length && !plan.dateFrom && !plan.dateTo && !plan.sort && !plan.chart;
  if (!empty) return false;
  return /无法解析/.test(plan.reason) || source === 'rule';
}

/**
 * 解析 + 查询，组装成前端要的 payload。
 * 流式和非流式共用这一段，保证两条路径口径一致（否则「流式少返回几条」这种 bug 极难查）。
 */
function buildPayload({ question, plan, source, warning, parseMs, firstTokenMs = null, page, pageSize, rows, t0, context = null }) {
  const result = runQuery(rows, plan);
  // limit 是模型给的「最多返回多少条」，必须真的切断，
  // 否则条件回显写着「最多 50 条」、表格却能翻到第 500 页，自相矛盾。
  const limited = result.rows.slice(0, plan.limit);
  const pageData = paginate(limited, page, pageSize);

  return {
    question,
    plan,
    source,
    warning,
    /** 这轮是不是接着上一轮改的 —— 页面上要标出来，否则用户不知道模型有没有记着上文 */
    usedContext: Boolean(context),
    /** 没解析出任何条件：前端换成「没看懂」的引导态，而不是甩一张全量表 */
    unparsed: isUnparsed(plan, source),
    aiConfigured: aiConfigured(),
    rows: pageData.rows,
    total: result.total, // 真实命中数
    returned: limited.length, // 受 limit 约束后的条数
    page: pageData.page,
    pageSize: pageData.pageSize,
    pages: pageData.pages,
    stats: result.stats,
    skipped: result.skipped,
    parseMs: Math.round(parseMs),
    firstTokenMs,
    queryMs: Date.now() - t0 - Math.round(parseMs),
  };
}

/** 校验入参，流式/非流式共用 */
function readQueryInput(body) {
  const question = String(body?.question ?? '').trim();
  // 翻页时前端把上次的 plan 原样带回来：不再问模型，省时间也省钱
  const replay = body?.plan && typeof body.plan === 'object' ? body.plan : null;

  if (question.length > 200) throw Object.assign(new Error('问题太长，控制在 200 字以内'), { status: 400 });
  if (!question && !replay) throw Object.assign(new Error('问题不能为空'), { status: 400 });

  if (replay) {
    const errs = validateQuery(replay);
    if (errs.length) throw Object.assign(new Error(`条件不合法：${errs.join('；')}`), { status: 400 });
  }

  return {
    question,
    replay,
    page: Number(body?.page) || 1,
    pageSize: Number(body?.pageSize) || 10,
  };
}

/**
 * 多轮对话的上文：上一轮的问题 + 条件。
 * 只要有一点点不合规就当没有上文 —— 追问可以失败，但绝不能因此把查询带偏。
 */
function readContext(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const question = String(raw.question ?? '').trim().slice(0, 200);
  if (!question || !raw.plan || typeof raw.plan !== 'object') return null;
  if (validateQuery(raw.plan).length) return null;
  return { question, plan: normalizeQuery(raw.plan) };
}

/**
 * 非流式：一次返回完整结果。翻页（replay）走这条路 —— 没有东西可流。
 */
export async function handleQuery({ body, ip } = {}) {
  loadEnvOnce();

  if (!allowRequest(ip)) {
    throw Object.assign(new Error(`查得太快，每分钟最多 ${LIMIT} 次。等一会儿再试。`), { status: 429 });
  }

  const { question, replay, page, pageSize } = readQueryInput(body);
  const context = readContext(body?.context);
  const rows = loadOrders();
  const t0 = Date.now();

  let plan;
  let source = 'ai';
  let parseMs = 0;
  let warning = null;

  if (replay) {
    plan = normalizeQuery(replay);
    source = 'replay';
  } else if (aiConfigured()) {
    try {
      const r = await parseWithAI(question, { context });
      plan = r.query;
      parseMs = r.ms;
    } catch (e) {
      source = 'rule';
      warning = `模型这次没成功（${describeError(e)}），已用规则兜底。`;
      plan = parseWithRules(question);
    }
  } else {
    source = 'rule';
    warning = context
      ? '没有配置 DEEPSEEK_API_KEY：规则兜底不支持合并上文，这条按单轮问题解析。'
      : '没有配置 DEEPSEEK_API_KEY，当前是本地规则解析（不是模型理解）。配好 Key 后自动切到 AI。';
    plan = parseWithRules(question);
  }

  return buildPayload({ question, plan, source, warning, parseMs, page, pageSize, rows, t0, context });
}

/**
 * 流式：解析过程边收边推给 onEvent，最后一条给完整 payload。
 *
 * 事件顺序固定：delta* → plan → rows → done
 * 中途用户取消时，signal 会同时中止上游模型请求（不再继续烧 token）。
 */
export async function handleQueryStream({ body, ip, onEvent, signal } = {}) {
  loadEnvOnce();

  if (!allowRequest(ip)) {
    throw Object.assign(new Error(`查得太快，每分钟最多 ${LIMIT} 次。等一会儿再试。`), { status: 429 });
  }

  const { question, replay, page, pageSize } = readQueryInput(body);
  const context = readContext(body?.context);
  const rows = loadOrders();
  const t0 = Date.now();

  let plan;
  let source = 'ai';
  let parseMs = 0;
  let firstTokenMs = null;
  let warning = null;

  if (replay) {
    plan = normalizeQuery(replay);
    source = 'replay';
  } else if (aiConfigured()) {
    try {
      const r = await parseWithAIStream(question, {
        signal,
        context,
        onDelta: (text) => onEvent({ type: 'delta', text }),
      });
      plan = r.query;
      parseMs = r.ms;
      firstTokenMs = r.firstTokenMs;
    } catch (e) {
      if (e.name === 'AbortError') {
        throw Object.assign(new Error('已取消'), { status: 499 });
      }
      source = 'rule';
      warning = `模型这次没成功（${describeError(e)}），已用规则兜底。`;
      plan = parseWithRules(question);
    }
  } else {
    source = 'rule';
    warning = context
      ? '没有配置 DEEPSEEK_API_KEY：规则兜底不支持合并上文，这条按单轮问题解析。'
      : '没有配置 DEEPSEEK_API_KEY，当前是本地规则解析（不是模型理解）。配好 Key 后自动切到 AI。';
    plan = parseWithRules(question);
  }

  onEvent({
    type: 'plan',
    plan,
    source,
    warning,
    parseMs: Math.round(parseMs),
    firstTokenMs,
    usedContext: Boolean(context),
    unparsed: isUnparsed(plan, source),
  });

  const payload = buildPayload({ question, plan, source, warning, parseMs, firstTokenMs, page, pageSize, rows, t0, context });
  onEvent({ type: 'rows', payload });
  return payload;
}

const GROUPABLE = ['region', 'channel', 'status', 'month'];

/**
 * 汇总：对「表格里那一批数据」按某个维度分组。
 *
 * 注意这里也用 plan.limit 截了一下 —— 图表和表格必须算同一批行，
 * 否则会出现「表格显示 50 条、图表统计 130 条」这种一眼假的情况。
 */
export async function handleSummary({ body } = {}) {
  loadEnvOnce();

  const raw = body?.plan;
  if (!raw || typeof raw !== 'object') throw Object.assign(new Error('缺少 plan'), { status: 400 });
  const errs = validateQuery(raw);
  if (errs.length) throw Object.assign(new Error(`条件不合法：${errs.join('；')}`), { status: 400 });

  const groupBy = String(body?.groupBy || 'region');
  if (!GROUPABLE.includes(groupBy)) {
    throw Object.assign(new Error(`不支持的维度：${groupBy}`), { status: 400 });
  }

  const plan = normalizeQuery(raw);
  const result = runQuery(loadOrders(), plan);
  const rows = result.rows.slice(0, plan.limit);

  const buckets = new Map();
  for (const row of rows) {
    const key = groupBy === 'month' ? String(row.createdAt).slice(0, 7) : row[groupBy];
    const bucket = buckets.get(key) ?? { key, count: 0, amount: 0 };
    bucket.count += 1;
    bucket.amount += Number(row.amount) || 0;
    buckets.set(key, bucket);
  }

  const list = [...buckets.values()].map((b) => ({ ...b, amount: Math.round(b.amount * 100) / 100 }));
  list.sort((a, b) => (groupBy === 'month' ? a.key.localeCompare(b.key) : b.count - a.count));

  return {
    groupBy,
    buckets: list,
    total: { count: rows.length, amount: Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100 },
  };
}

// ---------------------------------------------------------------- HTTP 小工具
// Vercel 和 node:http 的 req/res 都能用这组函数，不依赖任何框架，

export const sendJson = (res, status, body) => {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
};

export function readJsonBody(req, limit = 16 * 1024) {
  // Vercel 已经帮我们解析好了就不要再读流
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);

  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('请求体太大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** 客户端 IP：Vercel 把真实 IP 放在 x-forwarded-for 的第一个 */
export function clientIp(req) {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
