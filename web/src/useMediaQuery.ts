// useMediaQuery —— 表格列在窄屏要少显示几列，靠 CSS 藏不掉（el-table 的列是渲染出来的）
import { onMounted, onUnmounted, ref } from 'vue';

export function useMediaQuery(query: string) {
  const matches = ref(false);
  let mql: MediaQueryList | null = null;

  const update = () => {
    matches.value = mql?.matches ?? false;
  };

  onMounted(() => {
    mql = window.matchMedia(query);
    update();
    mql.addEventListener('change', update);
  });

  onUnmounted(() => {
    mql?.removeEventListener('change', update);
  });

  return matches;
}
