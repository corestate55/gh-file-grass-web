<script setup lang="ts">
import { computed, useId } from 'vue'
import { formMessages } from '../lib/messages'

const props = defineProps<{ busy?: boolean }>()
const emit = defineEmits<{ submit: [input: string] }>()
const model = defineModel<string>({ default: '' })

const inputId = useId()
const canSubmit = computed(() => !props.busy && model.value.trim() !== '')

function onSubmit() {
  if (canSubmit.value) emit('submit', model.value)
}
</script>

<template>
  <form class="repo-form" @submit.prevent="onSubmit">
    <label :for="inputId">{{ formMessages.repoLabel }}</label>
    <input
      :id="inputId"
      v-model="model"
      type="text"
      name="repository"
      autocomplete="off"
      spellcheck="false"
      :placeholder="formMessages.repoPlaceholder"
    />
    <button type="submit" :disabled="!canSubmit">{{ formMessages.loadBranches }}</button>
  </form>
</template>

<style scoped>
.repo-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.repo-form input {
  flex: 1 1 18rem;
  min-width: 0;
}
</style>
