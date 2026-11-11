<script setup lang="ts">
// 第 1 块：输入框
// 只干一件事——把一句中文交出去。示例 chip 点一下就填好并直接查，
// 让第一次打开的人 3 秒内看到结果。

defineProps<{
  modelValue: string;
  examples: string[];
  loading: boolean;
  streaming: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  submit: [];
  cancel: [];
}>();

function onInput(value: string) {
  emit('update:modelValue', value);
}

function pick(example: string) {
  emit('update:modelValue', example);
  emit('submit');
}

// Enter 直接查，Shift + Enter 换行；中文输入法选词时的 Enter 不算
function onKeydown(evt: KeyboardEvent | Event) {
  if (!(evt instanceof KeyboardEvent)) return;
  if (evt.key === 'Enter' && !evt.shiftKey && !evt.isComposing) {
    evt.preventDefault();
    emit('submit');
  }
}
</script>

<template>
  <div class="bar">
    <el-input
      class="ask"
      type="textarea"
      :rows="2"
      resize="none"
      maxlength="200"
      show-word-limit
      :model-value="modelValue"
      placeholder="例如：上个月华东区退款超过 500 的订单（Enter 查询）"
      @update:model-value="onInput"
      @keydown="onKeydown"
    />

    <div class="row">
      <div class="examples">
        <span class="label">试试</span>
        <button v-for="item in examples" :key="item" type="button" class="chip" @click="pick(item)">
          {{ item }}
        </button>
      </div>

      <div class="actions">
        <el-button v-if="streaming" text @click="emit('cancel')">取消</el-button>
        <el-button type="primary" :loading="loading" :disabled="streaming" @click="emit('submit')">
          {{ streaming ? '解析中' : '查询' }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ask :deep(.el-textarea__inner) {
  padding: 12px 14px;
  border-radius: 12px;
  font-size: 15px;
  line-height: 1.7;
  box-shadow: none;
  border: 1px solid var(--line-strong);
  transition: border-color 0.15s, box-shadow 0.15s;
}

.ask :deep(.el-textarea__inner:focus) {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.12);
}

.ask :deep(.el-input__count) {
  background: transparent;
  color: var(--muted);
  font-size: 11px;
}

.row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: nowrap;
}

.examples {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1 1 auto;
  min-width: 0;
}

.label {
  color: var(--muted);
  font-size: 12px;
  letter-spacing: 0.08em;
  flex: none;
}

.chip {
  padding: 5px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: #fbfbfd;
  color: var(--text-2);
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.chip:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  flex: none;
}

.actions :deep(.el-button) {
  min-width: 96px;
  height: 38px;
  border-radius: 10px;
  font-weight: 600;
}

@media (max-width: 720px) {
  .row {
    flex-wrap: wrap;
  }
  .actions {
    width: 100%;
    justify-content: flex-end;
  }
  /* 手机上一行横滑，而不是 3 个 chip 竖着占掉半屏 */
  .examples {
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 2px;
    padding-right: 28px;
    scrollbar-width: none;
    /* 右侧渐隐：提示「右边还有」，滑到头就自然消失 */
    mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
  }
  .examples::-webkit-scrollbar {
    display: none;
  }
  .chip {
    white-space: nowrap;
  }
}
</style>
