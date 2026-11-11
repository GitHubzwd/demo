<script setup lang="ts">
// App.vue —— 三块，按顺序竖着排：输入 → 条件回显 → 表格。
// Day 5 之后，第 2 块在解析过程中会「活」起来：条件是一个字一个字长出来的。

import { computed, onMounted, ref } from 'vue';
import QueryBar from './components/QueryBar.vue';
import ConditionEcho from './components/ConditionEcho.vue';
import ResultView from './components/ResultView.vue';
import { fetchMeta, runQuery, streamQuery } from './api';
import type { Meta, PlanSource, QueryPlan, QueryResult, TurnContext } from './types';

const FALLBACK_EXAMPLES = [
  '上个月华东区退款超过 500 的订单',
  '这个月已支付的订单，按金额从高到低',
  '小程序渠道最近 7 天的订单',
];

const meta = ref<Meta | null>(null);
const question = ref('');
const error = ref('');
const notice = ref('');

const result = ref<QueryResult | null>(null);
const plan = ref<QueryPlan | null>(null);
const source = ref<PlanSource>('rule');
const warning = ref<string | null>(null);
const parseMs = ref(0);
const firstTokenMs = ref<number | null>(null);
const draft = ref('');

const phase = ref<'idle' | 'streaming' | 'planned' | 'done'>('idle');
const loading = ref(false);

// 多轮：只记上一轮。追问是「在上一轮基础上改」，不是聊天记录，不需要存全部历史
const context = ref<TurnContext | null>(null);
const usedContext = ref(false);
// 首屏自动跑的那一次不算「追问」，别一打开就顶一条「追问中」的条
const showCtx = ref(false);
let autoQuery = false;
// 没解析出条件时，不让它变成「一次成功的全量查询」
const unparsed = ref(false);

// 一个请求一个 controller：重新提问和点「取消」都要能把上一路流掐掉
let controller: AbortController | null = null;

const streaming = computed(() => phase.value === 'streaming');
const examples = computed(() => (meta.value?.examples?.length ? meta.value.examples : FALLBACK_EXAMPLES));

const statusText = computed(() => {
  if (!meta.value) return '连接中…';
  return meta.value.aiConfigured ? `AI 已连接 · ${meta.value.model}` : '未配 Key · 规则兜底';
});

const toMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

onMounted(async () => {
  try {
    meta.value = await fetchMeta();
  } catch (e) {
    error.value = toMessage(e);
    return;
  }

  // 首屏就把「一句话 → 条件 → 表格」跑一遍：空白的三个卡片，陌生人看了不知道能干嘛
  const fromUrl = new URLSearchParams(location.search).get('q')?.trim();
  question.value = fromUrl || examples.value[0] || '';
  if (question.value) {
    autoQuery = true;
    await search();
  }
});

/** 把当前问题写进地址栏：别人复制链接就能看到同一次查询 */
function syncUrl(q: string) {
  try {
    const url = new URL(location.href);
    url.searchParams.set('q', q);
    history.replaceState(null, '', url);
  } catch {
    /* 地址栏不可写就算了，不影响查询 */
  }
}

/** 新问题：流式解析 + 查询 */
async function search() {
  const q = question.value.trim();
  if (!q) {
    error.value = '先写一句要查什么，比如「上个月华东区退款超过 500 的订单」';
    return;
  }

  const isAuto = autoQuery;
  autoQuery = false;

  controller?.abort();
  const ctrl = new AbortController();
  controller = ctrl;

  error.value = '';
  notice.value = '';
  draft.value = '';
  plan.value = null;
  result.value = null;
  warning.value = null;
  parseMs.value = 0;
  firstTokenMs.value = null;
  usedContext.value = false;
  unparsed.value = false;
  phase.value = 'streaming';
  loading.value = true;

  try {
    await streamQuery(q, {
      signal: ctrl.signal,
      context: context.value,
      onDelta: (text) => {
        draft.value += text;
      },
      onPlan: (ev) => {
        plan.value = ev.plan;
        source.value = ev.source;
        warning.value = ev.warning;
        parseMs.value = ev.parseMs;
        firstTokenMs.value = ev.firstTokenMs;
        usedContext.value = ev.usedContext;
        unparsed.value = ev.unparsed;
        phase.value = 'planned';
      },
      onRows: (payload) => {
        result.value = payload;
        unparsed.value = payload.unparsed;
        phase.value = 'done';
        syncUrl(payload.question);
        // 这一轮结束，把「问题 + 条件」留给下一轮当上文；
        // 但没解析出条件的就别留了，否则下一句会变成对空气的追问
        if (!payload.unparsed) {
          context.value = { question: payload.question, plan: payload.plan };
          showCtx.value = !isAuto;
        }
      },
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      phase.value = 'idle';
      draft.value = '';
      notice.value = '已取消本次解析。重新提问即可。';
    } else {
      error.value = toMessage(e);
      phase.value = 'idle';
    }
  } finally {
    loading.value = false;
    if (controller === ctrl) controller = null;
  }
}

function cancel() {
  controller?.abort();
}

/** 断开上文，下一句当全新问题解析 */
function clearContext() {
  context.value = null;
  usedContext.value = false;
  showCtx.value = false;
  notice.value = '已断开上文，下一句按新问题解析。';
}

/** 翻页：只传上一次的条件，不重复调模型（一次模型调用就是一次钱和延迟） */
async function goPage({ page, pageSize }: { page: number; pageSize: number }) {
  if (!result.value) return;
  loading.value = true;
  error.value = '';
  try {
    result.value = await runQuery({ question: result.value.question, plan: result.value.plan, page, pageSize });
  } catch (e) {
    error.value = toMessage(e);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="page">
    <header class="hero">
      <div class="top">
        <span class="badge">自然语言查询 · Demo</span>
        <span class="status" :class="meta?.aiConfigured ? 'ok' : 'warn'">
          <span class="dot" />{{ statusText }}
        </span>
      </div>
      <h1>用一句话，查订单</h1>
      <p class="sub">中文问题 → 结构化查询条件 → 表格结果。模型只负责给条件，不碰 SQL，也不碰数据库。</p>
    </header>

    <el-alert v-if="error" class="alert" :title="error" type="error" show-icon closable @close="error = ''" />
    <el-alert v-if="notice" class="alert" :title="notice" type="info" show-icon closable @close="notice = ''" />

    <section class="card">
      <div class="step">
        <span class="no">1</span>
        <h2>输入</h2>
        <span class="hint">一句话说清楚你要什么，模型负责翻译</span>
      </div>
      <QueryBar
        v-model="question"
        :examples="examples"
        :loading="loading"
        :streaming="streaming"
        @submit="search"
        @cancel="cancel"
      />

      <div v-if="context && showCtx" class="ctx-bar">
        <span class="ctx-dot" />
        <span class="ctx-label">追问中</span>
        <span class="ctx-text">上一轮：{{ context.question }}</span>
        <button type="button" class="ctx-clear" @click="clearContext">断开</button>
      </div>
      <p v-else class="ctx-tip">问完之后可以直接追问，比如「只看华南的」「再按月份拆一下」</p>
    </section>

    <section class="card">
      <div class="step">
        <span class="no">2</span>
        <h2>条件回显</h2>
        <span class="hint">模型理解成了什么，摊开给你看</span>
      </div>
      <ConditionEcho
        :plan="plan"
        :source="source"
        :warning="warning"
        :parse-ms="parseMs"
        :first-token-ms="firstTokenMs"
        :draft="draft"
        :phase="phase"
        :used-context="usedContext"
        :unparsed="unparsed"
      />
    </section>

    <section class="card">
      <div class="step">
        <span class="no">3</span>
        <h2>结果</h2>
        <span class="hint">表格看明细，图表看结构</span>
      </div>
      <ResultView :result="result" :loading="loading" @page-change="goPage" />
    </section>

    <footer class="foot">
      <span v-if="meta">数据源：orders.json · {{ meta.totalOrders }} 条 mock 订单 · 今天是 {{ meta.today }}</span>
      <span v-else>数据源：orders.json（本地 mock 数据）</span>
      <span class="dot-sep" />
      <span>Vue 3 + Element Plus + ECharts · DeepSeek · 条件走白名单，不生成 SQL</span>
    </footer>
  </div>
</template>

<style scoped>
.page {
  position: relative;
  z-index: 1;
  max-width: 1080px;
  margin: 0 auto;
  padding: 44px 24px 64px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.hero {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 8px;
}

.top {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: space-between;
}

.badge {
  padding: 3px 10px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid var(--line-strong);
  color: var(--text-2);
  font-size: 11.5px;
  letter-spacing: 0.06em;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 11px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid transparent;
}

.status .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.status.ok {
  color: #15803d;
  background: #f0fdf4;
  border-color: #bbf7d0;
}

.status.warn {
  color: #b45309;
  background: #fffbeb;
  border-color: #fde68a;
}

h1 {
  font-size: 30px;
  line-height: 1.25;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.sub {
  color: var(--text-2);
  font-size: 14px;
  max-width: 640px;
}

.alert {
  border-radius: 12px;
}

/* 上文提示条 */
.ctx-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 6px 10px;
  border-radius: 9px;
  background: #f7f6ff;
  border: 1px solid #e3e0fb;
  font-size: 12.5px;
  color: var(--text-2);
}

.ctx-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex: none;
}

.ctx-label {
  color: var(--accent);
  font-weight: 600;
  flex: none;
}

.ctx-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.ctx-clear {
  margin-left: auto;
  flex: none;
  border: 0;
  background: none;
  padding: 0;
  font-family: inherit;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  border-bottom: 1px dashed var(--line-strong);
}

.ctx-clear:hover {
  color: var(--accent);
}

.ctx-tip {
  margin-top: 8px;
  color: var(--muted);
  font-size: 12px;
}

.alert :deep(.el-alert__title) {
  font-size: 13px;
  line-height: 1.6;
}

.foot {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 10px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.dot-sep {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--line-strong);
}

@media (max-width: 720px) {
  .page {
    padding: 28px 14px 48px;
  }
  h1 {
    font-size: 24px;
  }
  .top {
    flex-wrap: wrap;
    gap: 8px;
  }
}
</style>
