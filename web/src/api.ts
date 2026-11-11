// api.ts —— 前端唯一和后端说话的地方
//
// 三个接口：
//   GET  /api/meta    页面打开时拿「有没有配 Key / 有哪些示例问题」
//   POST /api/stream  新问题：SSE 流式，先逐字吐条件，再给结果
//   POST /api/query   翻页：把上次的 plan 原样带回去，不重复问模型

import type { GroupBy, Meta, PlanEvent, QueryPlan, QueryResult, SummaryResult, TurnContext } from './types';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, init);
  } catch {
    throw new Error('连不上 /api —— 确认一下是不是用 npm run dev / npm start 起的服务');
  }

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`接口返回的不是 JSON（HTTP ${res.status}）：${text.slice(0, 80)}`);
  }

  if (!res.ok) {
    const message = (body as { error?: string })?.error || `请求失败（HTTP ${res.status}）`;
    throw new Error(message);
  }
  return body as T;
}

export const fetchMeta = () => request<Meta>('/meta');

export interface QueryParams {
  /** 新问题：走模型解析 */
  question?: string;
  /** 翻页：复用上次解析出的条件，不再花一次模型调用 */
  plan?: QueryPlan | null;
  page?: number;
  pageSize?: number;
}

export const runQuery = (params: QueryParams) =>
  request<QueryResult>('/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

/** 汇总：按维度分组，数据范围和表格完全一致（都受 plan.limit 约束） */
export const fetchSummary = (plan: QueryPlan, groupBy: GroupBy) =>
  request<SummaryResult>('/summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan, groupBy }),
  });

export interface StreamHandlers {
  /** 模型每吐出一段文本 */
  onDelta?: (text: string) => void;
  /** 条件解析完成，chip 可以渲染了 */
  onPlan?: (event: PlanEvent) => void;
  /** 查询完成，payload 和 /api/query 完全一致 */
  onRows?: (result: QueryResult) => void;
  /** 多轮追问：上一轮的问题和条件 */
  context?: TurnContext | null;
  signal?: AbortSignal;
}

/**
 * 流式查询。SSE 的分帧规则是「空行分隔」，不能按 chunk 切 ——
 * 一个事件很可能跨两个 chunk，切早了就会丢半行 JSON。
 */
export async function streamQuery(question: string, handlers: StreamHandlers = {}): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, context: handlers.context ?? null }),
      signal: handlers.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new Error('连不上 /api/stream —— 确认一下后端起来了没');
  }

  // 限流、参数错误这些走的是普通 JSON 响应，不是 SSE
  if (!res.ok) {
    const text = await res.text();
    let message = `请求失败（HTTP ${res.status}）`;
    try {
      message = JSON.parse(text)?.error || message;
    } catch {
      /* 保持默认文案 */
    }
    throw new Error(message);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('当前浏览器不支持流式读取');

  const decoder = new TextDecoder();
  let buf = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);

        let event = 'message';
        let data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;

        const payload = JSON.parse(data);
        if (event === 'delta') handlers.onDelta?.(payload.text ?? '');
        else if (event === 'plan') handlers.onPlan?.(payload as PlanEvent);
        else if (event === 'rows') handlers.onRows?.(payload as QueryResult);
        else if (event === 'error') throw new Error(payload.error || '服务端出错');
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
