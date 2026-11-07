<script setup lang="ts">
import type { Progress } from '@gh-file-grass/github-adapter'
import { computed } from 'vue'
import { statusMessages as t } from '../lib/messages'

const props = defineProps<{ active: boolean; progress: Progress | null }>()

const label = computed(() => {
  const p = props.progress
  if (!p) return t.progressStarting
  return p.phase === 'list' ? t.progressList : t.progressDetail(p.done, p.total)
})
// 件数ごとに読み上げると騒がしいので、段階が変わったときだけ通知する
const announcement = computed(() => {
  if (!props.active) return ''
  const p = props.progress
  if (!p) return t.announceStarting
  return p.phase === 'list' ? t.announceList : t.announceDetail
})
const indeterminate = computed(() => !props.progress || props.progress.phase === 'list')
</script>

<template>
  <div>
    <div v-if="active" class="progress">
      <progress
        :value="indeterminate ? undefined : progress?.done"
        :max="indeterminate ? undefined : Math.max(progress?.total ?? 1, 1)"
        :aria-label="label"
      ></progress>
      <span class="progress-label">{{ label }}</span>
    </div>
    <div class="visually-hidden" role="status">{{ announcement }}</div>
  </div>
</template>

<style scoped>
.progress {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.progress progress {
  flex: 0 1 16rem;
}
.progress-label {
  font-size: 0.9rem;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
