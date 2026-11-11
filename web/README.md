# web

Day 3 起的 Vue 工程。**整个页面只有一个文件**：[`src/App.vue`](src/App.vue)，按三块竖着排：输入 → 条件回显 → 表格。

运行方式、接口契约、踩过的坑、实测数字，都写在仓库根目录的 [README](../README.md#3-day-3搭-ui-骨架-) 里，这里只记本目录的命令。

```powershell
npm run dev        # 开发（/api 跟着一起起来，见 vite.config.ts）
npm run build      # vue-tsc 类型检查 + 打包
npm run preview    # 预览打包产物（/api 也挂上了）
npm test           # server/parser.test.mjs：规则解析的回归用例，不需要 Key
npm run typecheck  # 只跑类型检查
```

上线用的是仓库根目录的 `npm start`（`server.mjs`，托管 `dist` + 复用同一份 `api/*.js`），
部署见根 README 第 4 节。

## 目录

```
src/
├─ App.vue              三块骨架 + 流式状态机 + 多轮上下文
├─ components/
│  ├─ QueryBar.vue      ① 输入框 + 示例 chip + 取消
│  ├─ ConditionEcho.vue ② 条件回显 / 流式 / 没看懂
│  ├─ ResultView.vue    ③ 统计条 + 表格/图表切换 + 维度指标
│  ├─ OrderTable.vue    表格 + 分页
│  └─ SummaryChart.vue  echarts（按需引入）
├─ api.ts               /api/meta、/api/stream、/api/query、/api/summary
├─ types.ts             前后端共用契约
├─ useMediaQuery.ts     窄屏少渲染几列
└─ format.ts            字段名 / 操作符 / 金额格式

server/                 纯 Node ESM，不进前端产物
├─ core.mjs             业务逻辑 + 限流 + 汇总（三个入口共用）
├─ sse.mjs              SSE 协议层：分帧、取消、错误事件
├─ schema.mjs           字段白名单 + prompt（含追问）+ 校验
├─ parser.mjs           中文 → JSON：模型（含流式）、规则兜底
├─ engine.mjs           JSON → 数组过滤 + 分页
├─ plugin.mjs           把 core 挂到 Vite 的 dev / preview server 上
├─ parser.test.mjs      12 条：中文 → 条件
├─ robust.test.mjs      14 条：白名单拦截、没看懂、错误文案
└─ summary.test.mjs     7 条：图表汇总口径
```

## 接口

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/meta` | 有没有配 Key、示例问题、订单总数 |
| POST | `/api/stream` | 新问题：SSE，`delta → plan → rows → done`；body 可带 `context` 做追问 |
| POST | `/api/query` | 翻页：带上次的 `plan`，不重复调模型 |
| POST | `/api/summary` | 图表汇总：按地区/渠道/状态/月份分组 |

三个入口（Vite 中间件 / `server.mjs` / Vercel Function）都只是薄壳，逻辑都在 `server/core.mjs`。

## Key 放哪

复制 `.env.example` 成 `.env.local`（已被 `.gitignore` 忽略），填 `DEEPSEEK_API_KEY=sk-...`，重启 `npm run dev`。

不填也能跑：`parser.mjs` 会退回本地规则解析，页面上标注「规则兜底」。
