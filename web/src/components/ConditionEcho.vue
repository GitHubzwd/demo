<script setup lang="ts">
// 第 2 块：条件回显
//
// 这一块是整个项目最值钱的 UI：把模型「理解成了什么」摊开给人看。
// 流式之后它多了一个作用 —— 解析过程本身可见：条件是一个字一个字长出来的，
// 用户不会盯着转圈怀疑「是不是卡了」。
//
// 面试官问「模型理解错了怎么办」，指这里：用户当场看得见，也能重新问。

import { computed, ref } from 'vue';
import type { PlanSource, QueryPlan } from '../types';
import { FIELD_LABEL, OP_LABEL, formatDateRange, formatValue } from '../format';

const props = defineProps<{
  plan: QueryPlan | null;
  source: PlanSource;
  warning: string | null;
  parseMs: number;
  firstTokenMs: number | null;
  draft: string;
  phase: 'idle' | 'streaming' | 'planned' | 'done';
  /** 这一轮是不是接着上一轮改的 */
  usedContext: boolean;
  /** 没解析出任何条件 */
  unparsed: boolean;
}>();

const showRaw = ref(false);

const sourceLabel = computed(
  () => ({ ai: 'AI 解析', rule: '规则兜底', replay: '沿用上次条件' })[props.source],
);

interface Chip {
  key: string;
  field: string;
  op: string;
  value: string;
  kind: 'filter' | 'date' | 'sort' | 'chart';
}

const DIM_LABEL: Record<string, string> = { region: '按地区', channel: '按渠道', status: '按状态', month: '按月' };

const chips = computed<Chip[]>(() => {
  const plan = props.plan;
  if (!plan) return [];

  const list: Chip[] = plan.filters.map((f, i) => ({
    key: `f-${i}`,
    field: FIELD_LABEL[f.field] ?? f.field,
    op: OP_LABEL[f.op] ?? f.op,
    value: formatValue(f),
    kind: 'filter',
  }));

  const range = formatDateRange(plan.dateFrom, plan.dateTo);
  if (range) list.push({ key: 'date', field: '下单时间', op: '', value: range, kind: 'date' });

  if (plan.sort) {
    list.push({
      key: 'sort',
      field: '排序',
      op: '',
      value: `${FIELD_LABEL[plan.sort.field] ?? plan.sort.field} ${plan.sort.order === 'desc' ? '从高到低' : '从低到高'}`,
      kind: 'sort',
    });
  }

  if (plan.chart) {
    list.push({
      key: 'chart',
      field: '出图',
      op: '',
      value: DIM_LABEL[plan.chart.groupBy] ?? plan.chart.groupBy,
      kind: 'chart',
    });
  }

  return list;
});

/** 有模型原文就展示原文（那才是它真正写出来的东西），否则展示规整后的 plan */
const rawText = computed(() => (props.draft.trim() ? props.draft : JSON.stringify(props.plan ?? {}, null, 2)));

const timing = computed(() => {
  // 规则兜底没有「首字」这回事，解析耗时为 0 时干脆不显示
  if (props.source === 'replay') return `沿用上次条件 · ${props.parseMs}ms`;
  if (props.firstTokenMs === null) return props.parseMs > 0 ? `${props.parseMs}ms 解析` : '';
  return `首字 ${(props.firstTokenMs / 1000).toFixed(2)}s · 解析 ${(props.parseMs / 1000).toFixed(2)}s`;
});
</script>

<template>
  <div v-if="phase === 'streaming'" class="live">
    <div class="live-head">
      <span class="pulse" />
      <span class="live-title">模型正在解析</span>
      <span class="live-hint">一个字一个字出来，不用等整个 JSON</span>
    </div>
    <pre v-if="draft" class="live-code mono">{{ draft }}<span class="caret" /></pre>
    <div v-else class="live-wait">已发出请求，等第一个字符…</div>
  </div>

  <div v-else-if="plan" class="echo">
    <div class="head">
      <span class="src" :class="source">{{ sourceLabel }}</span>
      <span v-if="usedContext" class="ctx">接上一轮</span>
      <span v-if="timing" class="timing mono">{{ timing }}</span>
    </div>

    <el-alert v-if="warning" class="banner" :title="warning" type="warning" :closable="false" show-icon />

    <div v-if="unparsed" class="unknown">
      <div class="unknown-title">这句话我没能转成查询条件</div>
      <p class="unknown-reason">{{ plan.reason || '模型没有说明原因' }}</p>
      <p class="unknown-hint">
        带上 <b>时间</b>、<b>地区</b>、<b>金额</b> 或 <b>状态</b> 再说一次，比如「上个月华东区的退款单」「金额超过 500 的待支付订单」。
      </p>
    </div>

    <template v-else>
      <div class="chips">
        <div v-for="c in chips" :key="c.key" class="chip" :class="c.kind">
          <span class="k">{{ c.field }}</span>
          <span v-if="c.op" class="op">{{ c.op }}</span>
          <span class="v mono">{{ c.value }}</span>
        </div>
      </div>

      <p class="reason">
        <span class="tag">理解</span>{{ plan.reason || '（这次没有给出说明）' }}
      </p>
    </template>

    <div class="raw">
      <button type="button" class="toggle" @click="showRaw = !showRaw">
        {{ showRaw ? '收起' : '' }}{{ draft.trim() ? '看模型原文' : '看原始 JSON' }}
      </button>
      <pre v-if="showRaw" class="json mono">{{ rawText }}</pre>
    </div>
  </div>

  <div v-else class="placeholder">
    <span class="ph-title">还没有条件</span>
    <span class="ph-sub">在上面问一句，这里会显示模型解析出的条件 —— 以及没加工过的原始 JSON</span>
  </div>
</template>

<style scoped>
/* ---------------- 流式中 ---------------- */
.live {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.live-head {
  display: flex;
  align-items: center;
  gap: 9px;
}

.pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 0 rgba(79, 70, 229, 0.5);
  animation: pulse 1.4s infinite;
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(79, 70, 229, 0.45);
  }
  70% {
    box-shadow: 0 0 0 7px rgba(79, 70, 229, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(79, 70, 229, 0);
  }
}

.live-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
}

.live-hint {
  color: var(--muted);
  font-size: 12px;
}

.live-code {
  margin: 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: #1b1f27;
  color: #c8d3e3;
  font-size: 12.5px;
  line-height: 1.7;
  min-height: 56px;
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.caret {
  display: inline-block;
  width: 7px;
  height: 14px;
  margin-left: 1px;
  vertical-align: text-bottom;
  background: #8b93ff;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

.live-wait {
  padding: 14px 16px;
  border: 1px dashed var(--line-strong);
  border-radius: 10px;
  color: var(--muted);
  font-size: 12.5px;
}

/* ---------------- 解析完 ---------------- */
.placeholder {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px 16px;
  border: 1px dashed var(--line-strong);
  border-radius: 10px;
  background: #fcfcfe;
}

.ph-title {
  color: var(--text-2);
  font-size: 13px;
  font-weight: 600;
}

.ph-sub {
  color: var(--muted);
  font-size: 12.5px;
}

.echo {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.src {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid transparent;
}

.src.ai {
  background: #ecfdf3;
  color: #15803d;
  border-color: #bbf7d0;
}

.src.rule {
  background: #fffbeb;
  color: #b45309;
  border-color: #fde68a;
}

.src.replay {
  background: #f3f4f6;
  color: #4b5563;
  border-color: #e5e7eb;
}

.timing {
  color: var(--muted);
  font-size: 12px;
}

.banner :deep(.el-alert__title) {
  font-size: 12.5px;
  line-height: 1.6;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: #fbfbfd;
  font-size: 13px;
  animation: chip-in 0.22s ease both;
}

@keyframes chip-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
}

.chip .k {
  color: var(--muted);
  font-size: 12px;
}

.chip .op {
  color: var(--text-2);
  font-size: 12px;
}

.chip .v {
  color: var(--text);
  font-weight: 600;
  font-size: 12.5px;
}

.chip.filter {
  border-color: #d9d6fb;
  background: #f7f6ff;
}

.chip.filter .v {
  color: var(--accent);
}

.chip.date {
  border-color: #cfe3f8;
  background: #f4f9ff;
}

.chip.date .v {
  color: #1d6fb8;
}

.chip.sort {
  border-style: dashed;
}

.chip.sort .v {
  color: var(--text);
}

.chip.chart {
  border-color: #fbd9c4;
  background: #fff8f3;
}

.chip.chart .v {
  color: #c2410c;
}

.ctx {
  padding: 2px 8px;
  border-radius: 999px;
  background: #f7f6ff;
  border: 1px solid #e3e0fb;
  color: var(--accent);
  font-size: 11.5px;
}

/* 没看懂 */
.unknown {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border-radius: 10px;
  background: #fffaf5;
  border: 1px solid #fbe0c9;
}

.unknown-title {
  color: #b45309;
  font-size: 13.5px;
  font-weight: 600;
}

.unknown-reason {
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 1.6;
}

.unknown-hint {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.unknown-hint b {
  color: var(--text-2);
  font-weight: 600;
}

.reason {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 9px 12px;
  border-radius: 10px;
  background: #fafafc;
  border: 1px dashed var(--line-strong);
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.65;
}

.reason .tag {
  flex: none;
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.1em;
}

.raw {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toggle {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  border-bottom: 1px dashed var(--line-strong);
}

.toggle:hover {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.json {
  margin: 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: #1b1f27;
  color: #d8dee9;
  font-size: 12px;
  line-height: 1.6;
  overflow: auto;
  max-height: 260px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
