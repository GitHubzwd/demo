<script setup lang="ts">
// SummaryChart —— 只负责画图，数据和维度由外层给。
// echarts 按需引入：全量引入会再塞 1MB 进包里，这里只要柱状 + 折线 + 坐标轴 + tooltip。

import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

import type { GroupBy, SummaryBucket } from '../types';
import { formatMoney } from '../format';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

const props = defineProps<{
  buckets: SummaryBucket[];
  groupBy: GroupBy;
  metric: 'count' | 'amount';
  chartType: 'bar' | 'line';
}>();

const host = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;
let observer: ResizeObserver | null = null;

const UNIT: Record<GroupBy, string> = { region: '地区', channel: '渠道', status: '状态', month: '月份' };

function buildOption(): EChartsCoreOption {
  const names = props.buckets.map((b) => b.key);
  const data = props.buckets.map((b) => (props.metric === 'count' ? b.count : Math.round(b.amount)));
  const isLine = props.chartType === 'line';

  return {
    grid: { left: 4, right: 12, top: 18, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: isLine ? 'line' : 'shadow' },
      backgroundColor: '#1b1f27',
      borderWidth: 0,
      padding: [8, 12],
      textStyle: { color: '#e8ecf3', fontSize: 12 },
      formatter: (params: unknown) => {
        const first = Array.isArray(params) ? params[0] : params;
        const bucket = props.buckets[(first as { dataIndex: number })?.dataIndex ?? 0];
        if (!bucket) return '';
        return `${bucket.key}<br/>订单 ${bucket.count} 笔<br/>金额 ${formatMoney(bucket.amount)}`;
      },
    },
    xAxis: {
      type: 'category',
      data: names,
      axisLine: { lineStyle: { color: '#e7e9ef' } },
      axisTick: { show: false },
      axisLabel: { color: '#8a91a1', fontSize: 11, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#f1f2f6' } },
      axisLabel: {
        color: '#8a91a1',
        fontSize: 11,
        formatter: (value: number) =>
          props.metric === 'amount' && value >= 10000 ? `${Math.round(value / 10000)}万` : String(value),
      },
    },
    series: [
      {
        type: props.chartType,
        data,
        smooth: isLine,
        symbolSize: 6,
        barMaxWidth: 44,
        itemStyle: isLine
          ? { color: '#4f46e5' }
          : {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: '#6d64f0' },
                  { offset: 1, color: '#c9c5fb' },
                ],
              },
              borderRadius: [6, 6, 0, 0],
            },
        lineStyle: { width: 2.5, color: '#4f46e5' },
        areaStyle: isLine ? { color: 'rgba(79,70,229,0.10)' } : undefined,
        emphasis: { itemStyle: { color: '#4f46e5' } },
      },
    ],
  };
}

function render() {
  if (!chart) return;
  chart.setOption(buildOption(), true);
}

onMounted(() => {
  if (!host.value) return;
  chart = echarts.init(host.value);
  render();
  observer = new ResizeObserver(() => chart?.resize());
  observer.observe(host.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  chart?.dispose();
  chart = null;
});

watch(() => [props.buckets, props.metric, props.chartType], render, { deep: true });
</script>

<template>
  <div ref="host" class="chart" :aria-label="`按${UNIT[groupBy]}统计`" />
</template>

<style scoped>
.chart {
  width: 100%;
  height: 300px;
}
</style>
