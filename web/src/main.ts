import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import './style.css';
import App from './App.vue';

// 全量引入 Element Plus：Day 3 阶段先别折腾按需加载，
// 骨架阶段多 300KB 不影响验证，等功能定下来再优化。
createApp(App).use(ElementPlus, { locale: zhCn }).mount('#app');
