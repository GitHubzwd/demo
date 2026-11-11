// types.ts —— 前后端共用的一份契约
// 改这里的时候，顺手看一遍 web/server/schema.mjs，两边必须对得上

export type Op = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'like';

export interface Filter {
  field: FieldKey;
  op: Op;
  value: string | number | Array<string | number>;
}

export type FieldKey = 'orderNo' | 'customer' | 'amount' | 'region' | 'status' | 'channel' | 'createdAt';

export interface Sort {
  field: FieldKey;
  order: 'asc' | 'desc';
}

/** 模型（或规则）产出的查询条件 */
export interface QueryPlan {
  filters: Filter[];
  dateFrom: string | null;
  dateTo: string | null;
  sort: Sort | null;
  limit: number;
  /** 追问里「按 X 看」的诉求：只影响展示，不影响筛选 */
  chart: { groupBy: GroupBy } | null;
  reason: string;
}

export interface Order {
  orderNo: string;
  customer: string;
  amount: number;
  region: string;
  status: string;
  channel: string;
  createdAt: string;
}

/** 条件的来源：ai=模型解析，rule=本地规则兜底，replay=翻页沿用上一次的条件 */
export type PlanSource = 'ai' | 'rule' | 'replay';

export interface QueryResult {
  question: string;
  plan: QueryPlan;
  source: PlanSource;
  warning: string | null;
  aiConfigured: boolean;
  rows: Order[];
  /** 真实命中数 */
  total: number;
  /** 受 plan.limit 约束后实际返回的条数（<= total） */
  returned: number;
  page: number;
  pageSize: number;
  pages: number;
  stats: { sum: number; avg: number };
  skipped: string[];
  /** 这一轮是否接着上一轮改的 */
  usedContext: boolean;
  /** 没解析出任何条件：展示引导态，而不是甩一张全量表 */
  unparsed: boolean;
  parseMs: number;
  /** 模型第一个字符到达的时间；规则兜底时为 null */
  firstTokenMs: number | null;
  queryMs: number;
}

/** 流式接口里 plan 事件的形状 */
export interface PlanEvent {
  plan: QueryPlan;
  source: PlanSource;
  warning: string | null;
  parseMs: number;
  firstTokenMs: number | null;
  usedContext: boolean;
  unparsed: boolean;
}

/** 多轮对话的上文：上一轮的问题 + 条件 */
export interface TurnContext {
  question: string;
  plan: QueryPlan;
}

export interface Meta {
  aiConfigured: boolean;
  model: string;
  today: string;
  totalOrders: number;
  rateLimitPerMinute: number;
  fields: Array<{ key: FieldKey; label: string; type: string }>;
  enums: Record<string, string[]>;
  examples: string[];
}

/** 图表的分组维度 */
export type GroupBy = 'region' | 'channel' | 'status' | 'month';

export interface SummaryBucket {
  key: string;
  count: number;
  amount: number;
}

export interface SummaryResult {
  groupBy: GroupBy;
  buckets: SummaryBucket[];
  total: { count: number; amount: number };
}
