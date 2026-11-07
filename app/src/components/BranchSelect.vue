<script setup lang="ts">
import { computed, useId } from 'vue'
import { formMessages } from '../lib/messages'

const props = defineProps<{
  branches: readonly { name: string }[]
  /** 100 件を超えるブランチがあり、一覧に出ていないものがある */
  hasMore?: boolean
  disabled?: boolean
}>()
const model = defineModel<string | null>({ default: null })

const selectId = useId()
const noteId = useId()
const empty = computed(() => props.branches.length === 0)

function onChange(event: Event) {
  model.value = (event.target as HTMLSelectElement).value
}
</script>

<template>
  <div class="branch-select">
    <label :for="selectId">{{ formMessages.branchLabel }}</label>
    <select
      :id="selectId"
      :value="model ?? ''"
      :disabled="disabled || empty"
      :aria-describedby="hasMore ? noteId : undefined"
      @change="onChange"
    >
      <option v-if="empty" value="">{{ formMessages.branchesFirst }}</option>
      <option v-for="b in branches" :key="b.name" :value="b.name">{{ b.name }}</option>
    </select>
    <p v-if="hasMore" :id="noteId" class="note">{{ formMessages.branchesTruncated }}</p>
  </div>
</template>

<style scoped>
.branch-select {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.note {
  flex-basis: 100%;
  margin: 0;
  font-size: 0.85rem;
  color: #57606a;
}
</style>
