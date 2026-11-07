<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { formMessages } from '../lib/messages'

const props = withDefaults(defineProps<{ min?: number; max?: number }>(), { min: 1, max: 50 })
const emit = defineEmits<{
  /** 入力が確定した(blur / Enter)。取得の中断などの契機に使う。値が不正なときは発生しない */
  change: [value: number]
}>()
/** 現在の値。入力が空・範囲外・整数でないときは null(実行ボタンの無効化に使う) */
const model = defineModel<number | null>({ default: null })

const inputId = useId()
const errorId = useId()

// 入力中の文字列。親から値が変わったとき(初期値など)だけ上書きする
const draft = ref(model.value === null ? '' : String(model.value))
watch(model, (v) => {
  if (v !== null && v !== parse(draft.value)) draft.value = String(v)
})

function parse(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null
  const n = Number(text.trim())
  return n >= props.min && n <= props.max ? n : null
}

const invalid = computed(() => parse(draft.value) === null)

function onInput(event: Event) {
  draft.value = (event.target as HTMLInputElement).value
  model.value = parse(draft.value)
}

function onChange() {
  const n = parse(draft.value)
  if (n !== null) emit('change', n)
}
</script>

<template>
  <div class="count-input">
    <label :for="inputId">{{ formMessages.countLabel }}</label>
    <input
      :id="inputId"
      :value="draft"
      type="number"
      inputmode="numeric"
      :min="min"
      :max="max"
      step="1"
      :aria-invalid="invalid"
      :aria-describedby="invalid ? errorId : undefined"
      @input="onInput"
      @change="onChange"
    />
    <p v-if="invalid" :id="errorId" class="error">{{ formMessages.countInvalid(min, max) }}</p>
  </div>
</template>

<style scoped>
.count-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.count-input input {
  width: 5rem;
}
.error {
  flex-basis: 100%;
  margin: 0;
  font-size: 0.85rem;
  color: #b42318;
}
</style>
