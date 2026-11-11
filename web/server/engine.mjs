// engine.mjs —— 把 JSON 查询条件翻译成内存里的数组过滤
// 关键点：全程只做「白名单字段 + 固定操作符」的解释执行，
// 绝不拼字符串、绝不生成 SQL，所以模型再离谱也只是查错数据，不会造成别的事故。

const NUMERIC_FIELDS = new Set(['amount']);

function toNum(v) {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function cmp(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'zh-Hans-CN');
}

const OP_FN = {
  eq: (a, b) => (typeof b === 'number' ? toNum(a) === b : a === b),
  ne: (a, b) => (typeof b === 'number' ? toNum(a) !== b : a !== b),
  gt: (a, b) => cmp(a, b) > 0,
  gte: (a, b) => cmp(a, b) >= 0,
  lt: (a, b) => cmp(a, b) < 0,
  lte: (a, b) => cmp(a, b) <= 0,
  in: (a, b) => (Array.isArray(b) ? b.some((x) => x === a || String(x) === String(a)) : false),
  like: (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase()),
};

/** 把一条 filter 编译成断言函数；字段/操作符不认识就当它不生效（并记录下来） */
function compileFilter(f) {
  const fn = OP_FN[f?.op];
  if (!fn || !f.field) return null;

  let value = f.value;
  if (NUMERIC_FIELDS.has(f.field) && !Array.isArray(value)) value = toNum(value);
  if (NUMERIC_FIELDS.has(f.field) && Array.isArray(value)) value = value.map(toNum);

  return (row) => {
    const raw = row[f.field];
    const left = NUMERIC_FIELDS.has(f.field) ? toNum(raw) : raw;
    if (NUMERIC_FIELDS.has(f.field) && Number.isNaN(left)) return false;
    return fn(left, value);
  };
}

/**
 * 执行查询。
 * @returns {{ rows: Array, total: number, stats: { sum: number, avg: number }, skipped: string[] }}
 */
export function runQuery(allRows, query) {
  const skipped = [];
  const preds = [];

  for (const f of query.filters || []) {
    const p = compileFilter(f);
    if (p) preds.push(p);
    else skipped.push(`${f?.field ?? '?'} ${f?.op ?? '?'}`);
  }

  const { dateFrom, dateTo } = query;

  let matched = allRows.filter((row) => {
    // 时间区间：createdAt 是 YYYY-MM-DD，字符串比较即日期比较
    if (dateFrom && row.createdAt < dateFrom) return false;
    if (dateTo && row.createdAt > dateTo) return false;
    return preds.every((p) => p(row));
  });

  const sort = query.sort;
  if (sort && sort.field && (sort.order === 'asc' || sort.order === 'desc')) {
    const dir = sort.order === 'asc' ? 1 : -1;
    matched = [...matched].sort((a, b) => dir * cmp(a[sort.field], b[sort.field]));
  }

  const total = matched.length;
  const sum = matched.reduce((acc, r) => acc + (toNum(r.amount) || 0), 0);

  return {
    rows: matched,
    total,
    stats: { sum: Math.round(sum * 100) / 100, avg: total ? Math.round((sum / total) * 100) / 100 : 0 },
    skipped,
  };
}

/** 分页切片，顺手把 page 夹到合法范围，避免前端传个 0 或 -3 就炸 */
export function paginate(rows, page = 1, pageSize = 10) {
  const size = Math.min(Math.max(Number(pageSize) || 10, 1), 100);
  const pages = Math.max(Math.ceil(rows.length / size), 1);
  const current = Math.min(Math.max(Number(page) || 1, 1), pages);
  const start = (current - 1) * size;
  return { rows: rows.slice(start, start + size), page: current, pageSize: size, pages };
}
