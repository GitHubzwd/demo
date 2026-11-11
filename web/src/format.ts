// format.ts —— 回显用的文字格式，集中在一处，别散在模板里

import type { FieldKey, Filter, Op } from './types';

export const FIELD_LABEL: Record<FieldKey, string> = {
  orderNo: '订单号',
  customer: '客户',
  amount: '金额',
  region: '地区',
  status: '状态',
  channel: '渠道',
  createdAt: '下单时间',
};

export const OP_LABEL: Record<Op, string> = {
  eq: '等于',
  ne: '不等于',
  gt: '大于',
  gte: '不小于',
  lt: '小于',
  lte: '不大于',
  in: '属于',
  like: '包含',
};

const money = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ¥1,234.56 */
export const formatMoney = (n: number) => `¥${money.format(Number.isFinite(n) ? n : 0)}`;

/** 条件里的值：金额带 ¥，数组用「或」连起来 */
export function formatValue(filter: Filter): string {
  const { field, value } = filter;
  if (field === 'amount') {
    // 阈值尽量不留小数：¥500 比 ¥500.00 更像人话
    const one = (v: string | number) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return String(v);
      return Number.isInteger(n) ? `¥${n.toLocaleString('zh-CN')}` : formatMoney(n);
    };
    return Array.isArray(value) ? value.map(one).join(' 或 ') : one(value as string | number);
  }
  return Array.isArray(value) ? value.join(' 或 ') : String(value);
}

/** 状态下配色的 tag 类型 */
export function statusTagType(status: string): 'success' | 'warning' | 'danger' | 'info' {
  if (status === '已支付') return 'success';
  if (status === '待支付') return 'warning';
  if (status === '已退款') return 'danger';
  return 'info';
}

/** 2026-10-01 ~ 2026-10-31 / 只有起点 / 只有终点 */
export function formatDateRange(from: string | null, to: string | null): string {
  if (from && to) return from === to ? from : `${from} ~ ${to}`;
  return from ? `${from} 之后` : to ? `${to} 之前` : '';
}
