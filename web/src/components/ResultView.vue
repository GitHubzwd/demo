<script setup lang="ts">
// ResultView —— 第 3 块的壳：统计条 + 「表格 / 图表」切换 + 维度指标选择。
//
// 图表和表格共用同一批数据（都受 plan.limit 约束，见 server/core.mjs 的 handleSummary），
// 所以「切到图表数字对不上」这种事不会发生。

import { computed, ref, watch } from 'vue';
import OrderTable from './OrderTable.vue';
import SummaryChart from './SummaryChart.vue';
import { fetchSummary } from '../api';
import { formatMoney } from '../format';
import type { GroupBy, QueryResult, SummaryResult } from '../types';

const props = defineProps<{
  result: QueryResult | null;
  loading: boolean;
}>();

const emit = defineEmits<{
  'page-change': [payload: { page: number; pageSize: number }];
}>();

const view = ref<'table' | 'chart'>('table');
const groupBy = ref<GroupBy>('region');
const metric = ref<'count' | 'amount'>('count');

const summary = ref<SummaryResult | null>(null);
const summaryLoading = ref(false);
const summaryError = ref('');

// 没解析出条件时不直接甩全量表 —— 让用户自己决定要不要看
const showAll = ref(false);
const showCta = computed(() => Boolean(props.result?.unparsed) && !showAll.value);

const DIMS: Array<{ key: GroupBy; label: string }> = [
  { key: 'region', label: '地区' },
  { key: 'channel', label: '渠道' },
  { key: 'status', label: '状态' },
  { key: 'month', label: '按月' },
];

/** 时间维度画折线，分类维度画柱状 —— 这就是「按结果类型自动选图」 */
const chartType = computed<'bar' | 'line'>(() => (groupBy.value === 'month' ? 'line' : 'bar'));

const chartHint = computed(() => (chartType.value === 'line' ? '折线：按时间看趋势' : '柱状：按分类比大小'));

/** 只有一个时间点时画不出折线 —— 与其让人盯着一个点猜，不如说清楚 */
const sparseNote = computed(() => {
  const n = summary.value?.buckets.length ?? 0;
  return chartType.value === 'line' && n === 1 ? '这个范围只落在一个月里，拆不出趋势 —— 换个时间范围再看看' : '';
});

/** 自动挑一个「用户还没筛过」的维度，比死默认地区更聪明 */
function pickGroupBy(result: QueryResult): GroupBy {
  const used = new Set<string>(result.plan.filters.map((f) => f.field));
  const candidates: GroupBy[] = ['region', 'channel', 'status'];
  return candidates.find((key) => !used.has(key)) ?? 'month';
}

// 切维度/切视图会并发请求，用一个自增 id 丢掉过期响应
let reqId = 0;

async function loadSummary() {
  if (!props.result) return;
  const my = ++reqId;
  summaryLoading.value = true;
  summaryError.value = '';
  try {
    const data = await fetchSummary(props.result.plan, groupBy.value);
    if (my !== reqId) return;
    summary.value = data;
  } catch (e) {
    if (my !== reqId) return;
    summaryError.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (my === reqId) summaryLoading.value = false;
  }
}

watch(
  () => props.result,
  (result) => {
    if (!result) {
      summary.value = null;
      showAll.value = false;
      return;
    }
    summary.value = null;
    showAll.value = false;

    // 追问里说了「按月份拆一下」：模型给的 chart.groupBy 优先，并且直接切到图表
    const requested = result.plan.chart?.groupBy ?? null;
    const next = requested ?? pickGroupBy(result);
    const viewChanged = Boolean(requested) && view.value !== 'chart';
    const dimChanged = next !== groupBy.value;

    if (viewChanged) view.value = 'chart';
    if (dimChanged) groupBy.value = next;

    // 两个都没变时下面的 watcher 不会触发，这里补一次
    if (!viewChanged && !dimChanged && view.value === 'chart') loadSummary();
  },
);

watch([groupBy, view], () => {
  if (view.value === 'chart' && props.result) loadSummary();
});
</script>

<template>
  <div class="result">
    <div v-if="showCta" class="cta">
      <div class="cta-title">这句话没转成条件，就不查全量了</div>
      <p class="cta-sub">
        现在查会返回全部 {{ result?.total ?? 0 }} 条订单，看着像成功了，其实什么问题都没回答。
      </p>
      <el-button size="small" @click="showAll = true">仍然查看全部订单</el-button>
    </div>

    <div v-if="!showCta" class="toolbar">
      <div v-if="result" class="stats">
        <span>共 <b>{{ result.total }}</b> 条</span>
        <span class="sep" />
        <span>金额合计 <b>{{ formatMoney(result.stats.sum) }}</b></span>
        <span v-if="result.returned < result.total" class="cap">
          本次只返回前 {{ result.returned }} 条
        </span>
      </div>
      <div v-else class="stats muted">查一次之后这里会显示条数和金额合计</div>

      <div v-if="result" class="tabs">
        <button type="button" :class="{ on: view === 'table' }" @click="view = 'table'">表格</button>
        <button type="button" :class="{ on: view === 'chart' }" @click="view = 'chart'">图表</button>
      </div>
    </div>

    <div v-if="!showCta && result && view === 'chart'" class="chart-bar">
      <span class="label">维度</span>
      <button
        v-for="dim in DIMS"
        :key="dim.key"
        type="button"
        class="pill"
        :class="{ on: groupBy === dim.key }"
        @click="groupBy = dim.key"
      >
        {{ dim.label }}
      </button>

      <span class="divider" />

      <span class="label">指标</span>
      <button type="button" class="pill" :class="{ on: metric === 'count' }" @click="metric = 'count'">订单数</button>
      <button type="button" class="pill" :class="{ on: metric === 'amount' }" @click="metric = 'amount'">金额</button>

      <span class="hint">{{ chartHint }}</span>
    </div>

    <OrderTable v-if="!showCta && view === 'table'" :result="result" :loading="loading" @page-change="emit('page-change', $event)" />

    <div v-else-if="!showCta" class="chart-body">
      <el-alert v-if="summaryError" :title="summaryError" type="error" :closable="false" show-icon />
      <el-skeleton v-else-if="summaryLoading" :rows="5" animated />
      <el-empty v-else-if="!summary || summary.buckets.length === 0" :image-size="48" description="这批数据没有可汇总的维度" />
      <template v-else>
        <SummaryChart
          :buckets="summary.buckets"
          :group-by="summary.groupBy"
          :metric="metric"
          :chart-type="chartType"
        />
        <p class="footnote">
          统计范围 = 表格返回的那 {{ summary.total.count }} 条；合计
          <b>{{ formatMoney(summary.total.amount) }}</b>
        </p>
        <p v-if="sparseNote" class="note">{{ sparseNote }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.result {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  min-height: 24px;
}

.stats {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-2);
  font-size: 13px;
  flex-wrap: wrap;
}

.stats b {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.stats.muted {
  color: var(--muted);
  font-size: 12.5px;
}

.sep {
  width: 1px;
  height: 12px;
  background: var(--line-strong);
}

.cap {
  padding: 1px 8px;
  border-radius: 999px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #b45309;
  font-size: 11.5px;
}

/* 没解析出条件时的引导态 */
.cta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 18px 20px;
  border-radius: 12px;
  background: #fcfcfe;
  border: 1px dashed var(--line-strong);
}

.cta-title {
  color: var(--text-2);
  font-size: 14px;
  font-weight: 600;
}

.cta-sub {
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.7;
  max-width: 620px;
}

/* 表格 / 图表 切换 */
.tabs {
  margin-left: auto;
  display: inline-flex;
  padding: 2px;
  border-radius: 9px;
  background: #f1f2f6;
}

.tabs button {
  border: 0;
  background: none;
  padding: 4px 14px;
  border-radius: 7px;
  font-size: 12.5px;
  color: var(--text-2);
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tabs button.on {
  background: #fff;
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(23, 26, 33, 0.08);
}

/* 维度 / 指标 */
.chart-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border-radius: 10px;
  background: #fafafc;
  border: 1px solid var(--line);
}

.chart-bar .label {
  color: var(--muted);
  font-size: 11.5px;
  letter-spacing: 0.08em;
  margin-right: 2px;
}

.chart-bar .divider {
  width: 1px;
  height: 12px;
  background: var(--line-strong);
  margin: 0 4px;
}

.pill {
  border: 1px solid transparent;
  background: none;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12.5px;
  color: var(--text-2);
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
}

.pill:hover {
  color: var(--accent);
}

.pill.on {
  background: var(--accent-soft);
  border-color: #d9d6fb;
  color: var(--accent);
  font-weight: 600;
}

.hint {
  margin-left: auto;
  color: var(--muted);
  font-size: 11.5px;
}

.chart-body {
  padding: 4px 2px 0;
}

.footnote {
  margin-top: 6px;
  color: var(--muted);
  font-size: 12px;
}

.footnote b {
  color: var(--text-2);
}

.note {
  margin-top: 4px;
  color: #b45309;
  font-size: 12px;
}

@media (max-width: 720px) {
  .tabs {
    margin-left: 0;
  }
  .chart-bar .hint {
    display: none;
  }
  .chart-body {
    overflow-x: auto;
  }
}
</style>
