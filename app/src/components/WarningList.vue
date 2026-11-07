<script setup lang="ts">
import type { Warning } from '@gh-file-grass/github-adapter'
import { computed } from 'vue'
import { statusMessages as t } from '../lib/messages'

const props = defineProps<{ warnings: readonly Warning[] }>()

interface Group {
  kind: Warning['kind']
  text: string
  shas: string[]
}

const groups = computed<Group[]>(() => {
  const out: Group[] = []
  for (const [kind, text] of [
    ['truncated', t.truncated],
    ['unknown-src', t.unknownSrc],
  ] as const) {
    const items = props.warnings.filter((w) => w.kind === kind)
    if (items.length === 0) continue
    out.push({
      kind,
      text: text(items.length),
      shas: items.flatMap((w) => (w.sha ? [w.sha.slice(0, 7)] : [])),
    })
  }
  return out
})
</script>

<template>
  <section v-if="groups.length > 0" class="warnings" :aria-label="t.warningsLabel" role="status">
    <ul>
      <li v-for="g in groups" :key="g.kind" :data-kind="g.kind">
        {{ g.text }}
        <details v-if="g.shas.length > 0">
          <summary>{{ t.showCommits(g.shas.length) }}</summary>
          <code v-for="sha in g.shas" :key="sha" class="sha">{{ sha }}</code>
        </details>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.warnings {
  padding: 0.5rem 1rem;
  border: 1px solid #e8c766;
  border-left-width: 4px;
  border-radius: 4px;
  background: #fffbea;
  color: #5b4300;
  font-size: 0.9rem;
}
.warnings ul {
  margin: 0;
  padding-left: 1.25rem;
}
.sha {
  margin-right: 0.5rem;
}
</style>
