// gen-orders.mjs —— 生成 mock 数据（第 2 天用）
// 用法：node gen-orders.mjs
// 产出：orders.json，5000 条订单

import fs from 'node:fs';

const REGIONS = ['华东', '华北', '华南', '西南', '其他'];
const STATUS = ['待支付', '已支付', '已支付', '已支付', '已退款', '已取消']; // 已支付占比高，更像真实分布
const CHANNEL = ['APP', 'H5', '小程序', '公众号'];
const CUSTOMERS = ['星辰科技', '云图信息', '海联贸易', '明远电子', '启航物流', '恒泰实业',
  '中科数据', '华信设备', '天成医疗', '新洲文化', '锐驰智能', '朗程教育'];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const pad = (n) => String(n).padStart(2, '0');

function randomDate(monthsBack = 6) {
  const now = Date.now();
  const t = now - Math.random() * monthsBack * 30 * 24 * 3600 * 1000;
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const orders = Array.from({ length: 5000 }, (_, i) => {
  const amount = Math.round((20 + Math.random() ** 2 * 5000) * 100) / 100; // 小额多、大额少
  return {
    orderNo: `A${202600 + Math.floor(i / 100)}${String(i).padStart(4, '0')}`,
    customer: pick(CUSTOMERS),
    amount,
    region: pick(REGIONS),
    status: pick(STATUS),
    channel: pick(CHANNEL),
    createdAt: randomDate(6),
  };
});

fs.writeFileSync('orders.json', JSON.stringify(orders, null, 0), 'utf8');
console.log(`已生成 orders.json，共 ${orders.length} 条`);
console.log('示例：', JSON.stringify(orders[0]));
