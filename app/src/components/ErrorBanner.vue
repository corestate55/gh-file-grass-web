<script setup lang="ts">
import type { RateLimitInfo } from '@gh-file-grass/github-adapter'
import { computed } from 'vue'
import { describeError } from '../lib/describe-error'
import { statusMessages as t } from '../lib/messages'

// 外部由来の文字列(apiMessage など)はテキスト補間のみで表示し、HTML としては解釈しない
const props = defineProps<{
  error: unknown
  rateLimit: RateLimitInfo | null
  now: number
  formatTime?: (d: Date) => string
  affordableCount?: number | null
}>()

const described = computed(() =>
  props.error === null || props.error === undefined
    ? null
    : describeError(props.error, {
        rateLimit: props.rateLimit,
        now: props.now,
        ...(props.formatTime ? { formatTime: props.formatTime } : {}),
        affordableCount: props.affordableCount ?? null,
      }),
)
</script>

<template>
  <div v-if="described" class="error-banner" role="alert">
    <strong class="error-title">{{ described.title }}</strong>
    <p v-if="described.detail" class="error-detail">{{ described.detail }}</p>
    <details v-if="described.apiMessage" class="error-api">
      <summary>{{ t.apiMessage }}</summary>
      <p>{{ described.apiMessage }}</p>
    </details>
  </div>
</template>

<style scoped>
.error-banner {
  padding: 0.75rem 1rem;
  border: 1px solid #f0a8a0;
  border-left-width: 4px;
  border-radius: 4px;
  background: #fff4f2;
  color: #5c1a14;
}
.error-detail {
  margin: 0.25rem 0 0;
}
.error-api {
  margin-top: 0.5rem;
  font-size: 0.85rem;
}
.error-api p {
  margin: 0.25rem 0 0;
  word-break: break-word;
}
</style>
