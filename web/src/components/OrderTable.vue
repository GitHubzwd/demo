<script setup lang="ts">
// 表格本体：只负责把 rows 摆出来 + 分页。
// 上面的统计条和「表格/图表」切换在 ResultView 里 —— 图表和表格必须并排比较，不该分家。

import type { QueryResult } from '../types';
import { formatMoney, statusTagType } from '../format';
import { useMediaQuery } from '../useMediaQuery';

const props = defineProps<{
  result: QueryResult | null;
  loading: boolean;
}>();

const emit = defineEmits<{
  'page-change': [payload: { page: number; pageSize: number }];
}>();

// 手机上少放几列：订单号 / 金额 / 状态足够看懂，其余横向挤进去反而看不清
const isMobile = useMediaQuery('(max-width: 720px)');

function onPage(page: number) {
  emit('page-change', { page, pageSize: props.result?.pageSize ?? 10 });
}

function onSize(pageSize: number) {
  emit('page-change', { page: 1, pageSize });
}
</script>

<template>
  <div class="table-wrap">
    <el-table
      v-loading="loading"
      :data="result?.rows ?? []"
      row-key="orderNo"
      stripe
      :border="false"
      max-height="520"
      element-loading-text="查询中"
      class="grid"
    >
      <el-table-column prop="orderNo" label="订单号" min-width="150">
        <template #default="{ row }">
          <span class="mono cell-no">{{ row.orderNo }}</span>
        </template>
      </el-table-column>

      <el-table-column v-if="!isMobile" prop="customer" label="客户" min-width="130" show-overflow-tooltip />

      <el-table-column prop="amount" label="金额" min-width="120" align="right">
        <template #default="{ row }">
          <span class="mono cell-amount">{{ formatMoney(row.amount) }}</span>
        </template>
      </el-table-column>

      <el-table-column v-if="!isMobile" prop="region" label="地区" min-width="90" />

      <el-table-column prop="status" label="状态" min-width="100">
        <template #default="{ row }">
          <el-tag :type="statusTagType(row.status)" effect="light" size="small" round>{{ row.status }}</el-tag>
        </template>
      </el-table-column>

      <el-table-column v-if="!isMobile" prop="channel" label="渠道" min-width="96" />

      <el-table-column v-if="!isMobile" prop="createdAt" label="下单时间" min-width="120">
        <template #default="{ row }">
          <span class="mono cell-date">{{ row.createdAt }}</span>
        </template>
      </el-table-column>

      <template #empty>
        <!-- 加载中先藏起来：v-loading 的遮罩是半透明的，底下压着「还没有结果」很难看 -->
        <div class="empty" :class="{ hidden: loading }">
          <div class="empty-title">
            {{ result && result.total === 0 ? '没有匹配的订单' : '还没有结果' }}
          </div>
          <div class="empty-sub">
            {{ result && result.total === 0 ? '试试放宽条件，或者换个说法再问一次' : '在上面问一句，表格会显示前 10 条' }}
          </div>
        </div>
      </template>
    </el-table>

    <div class="footer">
      <el-pagination
        v-if="result && result.total > 0"
        background
        layout="sizes, prev, pager, next, jumper"
        :total="result.returned"
        :current-page="result.page"
        :page-size="result.pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :disabled="loading"
        @current-change="onPage"
        @size-change="onSize"
      />
      <span v-else class="hint">每页 10 / 20 / 50 / 100 条，分页在服务端做</span>
    </div>
  </div>
</template>

<style scoped>
.table-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.grid {
  --el-table-border-color: var(--line);
  --el-table-header-bg-color: #fafafc;
  --el-table-row-hover-bg-color: #f8f8ff;
  border-radius: 12px;
  overflow: hidden;
}

.grid :deep(th.el-table__cell) {
  background: #fafafc;
  color: var(--muted);
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.04em;
}

.grid :deep(td.el-table__cell) {
  padding: 9px 0;
  font-size: 13px;
}

/* 没有数据时别把卡片撑得老高：el-table 的空状态默认 line-height: 60px，
   会把两行文字顶得很开，这里逐层收回来 */
.grid :deep(.el-table__empty-block) {
  height: 132px;
}

.grid :deep(.el-table__empty-text) {
  width: auto;
  line-height: 1.5;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  line-height: 1.5;
}

.empty.hidden {
  visibility: hidden;
}

.empty-title {
  color: var(--text-2);
  font-size: 13px;
  font-weight: 600;
}

.empty-sub {
  color: var(--muted);
  font-size: 12.5px;
}

.cell-no {
  color: var(--text-2);
  font-size: 12.5px;
}

.cell-amount {
  font-weight: 600;
}

.cell-date {
  color: var(--text-2);
  font-size: 12.5px;
}

.footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  min-height: 32px;
}

.hint {
  color: var(--muted);
  font-size: 12px;
}

.footer :deep(.el-pagination.is-background .el-pager li) {
  border-radius: 8px;
}

@media (max-width: 720px) {
  .footer {
    justify-content: center;
  }
  /* 手机上只留翻页器：每页条数选择和「前往 X 页」会把整行撑出屏幕 */
  .footer :deep(.el-pagination__sizes),
  .footer :deep(.el-pagination__jump) {
    display: none;
  }
  .footer :deep(.el-pagination) {
    flex-wrap: wrap;
    justify-content: center;
    row-gap: 8px;
  }
}
</style>
