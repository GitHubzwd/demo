import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// @ts-expect-error —— 服务端是纯 .mjs（Node 直接跑，不用编译），类型由 JSDoc 和测试兜着
import { queryApiPlugin } from './server/plugin.mjs';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // /api/meta、/api/query 挂在同一个 dev server 上，省得开两个窗口
    queryApiPlugin(),
  ],
  server: {
    port: 5173,
  },
});
