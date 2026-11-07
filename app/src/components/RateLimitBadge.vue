<script setup lang="ts">
import type { RateLimitInfo } from '@gh-file-grass/github-adapter'
import { computed } from 'vue'
import { formatClock } from '../lib/format'
import { statusMessages as t } from '../lib/messages'

// 色だけに頼らず、少ないときは "low" と文字でも示す
const LOW_REMAINING = 5

const props = defineProps<{
  rateLimit: RateLimitInfo | null
  /** 現在時刻(ms)。resetAt を過ぎたかの判定に使う */
  now: number
  formatTime?: (d: Date) => string
}>()

const low = computed(() => props.rateLimit !== null && props.rateLimit.remaining <= LOW_REMAINING)
const text = computed(() => {
  const rl = props.rateLimit
  if (!rl) return t.quotaUnknown
  if (props.now >= rl.resetAt.getTime()) return t.quotaReset
  return t.quota(rl.remaining, rl.limit, (props.formatTime ?? formatClock)(rl.resetAt), low.value)
})
</script>

<template>
  <p class="badge" :data-low="low" role="status">{{ text }}</p>
</template>

<style scoped>
.badge {
  margin: 0;
  font-size: 0.85rem;
  color: #57606a;
}
.badge[data-low='true'] {
  color: #b42318;
  font-weight: 600;
}
</style>
