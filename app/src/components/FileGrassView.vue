<script setup lang="ts">
import { draw } from '@gh-file-grass/core'
import type { FileGrassHandle, GitLogData } from '@gh-file-grass/core'
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import { viewMessages } from '../lib/messages'

const props = defineProps<{ data: GitLogData }>()
const emit = defineEmits<{ error: [error: unknown] }>()

const container = ref<HTMLElement | null>(null)
// ref にしない: draw のハンドルを reactive にする意味は無い
let handle: FileGrassHandle | null = null

const isEmpty = computed(() => props.data.stats.length === 0)
const caption = computed(() =>
  viewMessages.caption(
    props.data.repo,
    props.data.branch,
    props.data.commits.length,
    props.data.files.length,
  ),
)

function clear() {
  handle?.destroy()
  handle = null
}

function redraw() {
  clear()
  if (!container.value || isEmpty.value) return
  try {
    // core は structuredClone するので、リアクティブな Proxy ではなく素のオブジェクトを渡す
    handle = draw(toRaw(props.data), { container: container.value })
  } catch (e) {
    emit('error', e) // draw は失敗時にコンテナを元に戻してから投げる
  }
}

onMounted(redraw)
// 参照が変わったときだけ描き直す(data は shallow に渡される)
watch(() => props.data, redraw, { flush: 'post' })
onBeforeUnmount(clear)
</script>

<template>
  <figure class="grass">
    <p v-if="isEmpty" class="grass-empty" role="status">{{ viewMessages.noChanges }}</p>
    <!-- core がこの要素の中に svg とツールチップを作る。スクロールはこの要素が受け持つ -->
    <div v-show="!isEmpty" ref="container" class="grass-scroll"></div>
    <figcaption v-if="!isEmpty" class="grass-caption">{{ caption }}</figcaption>
  </figure>
</template>

<style scoped>
.grass {
  margin: 0;
}
.grass-scroll {
  overflow: auto;
  max-width: 100%;
}
.grass-caption {
  margin-top: 0.5rem;
  font-size: 0.85rem;
  color: #57606a;
}
.grass-empty {
  margin: 0;
  color: #57606a;
}
</style>
