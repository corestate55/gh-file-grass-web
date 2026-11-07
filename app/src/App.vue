<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import BranchSelect from './components/BranchSelect.vue'
import CountInput from './components/CountInput.vue'
import ErrorBanner from './components/ErrorBanner.vue'
import FileGrassView from './components/FileGrassView.vue'
import ProgressBar from './components/ProgressBar.vue'
import RateLimitBadge from './components/RateLimitBadge.vue'
import RepoForm from './components/RepoForm.vue'
import WarningList from './components/WarningList.vue'
import { useHistoryLoader } from './composables/useHistoryLoader'
import { pickDefaultBranch } from './lib/branches'
import { HISTORY_CLIENT } from './lib/client'
import { appMessages as t } from './lib/messages'
import { resolveTimeZone } from './lib/timezone'

const DEFAULT_COUNT = 20
const CLOCK_INTERVAL_MS = 30_000

const client = inject(HISTORY_CLIENT)
if (!client) throw new Error('The GitHub client is not provided')

const loader = useHistoryLoader(client, { timeZone: resolveTimeZone() })
const { phase, branches, hasMoreBranches, progress, result, error, rateLimit } = loader

const repoInput = ref('')
const branch = ref<string | null>(null)
const count = ref<number | null>(DEFAULT_COUNT)
// グラフの描画に失敗した(取得の失敗とは別)
const viewError = ref<unknown>(null)

// 残量バッジの「リセット済み」判定用の時計
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), CLOCK_INTERVAL_MS)
  void loader.refreshRateLimit() // 枠を消費しない
})
onUnmounted(() => clearInterval(clock))

const loadingBranches = computed(() => phase.value === 'loadingBranches')
const loadingHistory = computed(() => phase.value === 'loadingHistory')
const displayedError = computed(() => error.value ?? viewError.value)

const estimate = computed(() =>
  branch.value !== null && count.value !== null ? loader.estimate(branch.value, count.value) : null,
)
const estimateText = computed(() => {
  const e = estimate.value
  if (!e) return ''
  if (!e.exact) return t.estimateUpTo(e.requests, rateLimit.value?.remaining ?? null)
  return e.requests === 0 ? t.estimateCached : t.estimateExact(e.requests)
})

// 枠が尽きていて、まだリセットされず、新しい取得が必要なら押せない。
// それ以外の不足は見積もりが上限値なので、ここでは判定せず client の事前チェックに任せる。
const quotaExhausted = computed(() => {
  const rl = rateLimit.value
  return rl !== null && rl.remaining <= 0 && now.value < rl.resetAt.getTime()
})
const canShow = computed(
  () =>
    phase.value === 'ready' &&
    branch.value !== null &&
    branches.value.some((b) => b.name === branch.value) &&
    count.value !== null &&
    !(quotaExhausted.value && (estimate.value?.requests ?? 1) > 0),
)

async function onRepoSubmit(input: string) {
  viewError.value = null
  const list = await loader.loadBranches(input)
  if (!list) return
  if (branch.value === null || !list.branches.some((b) => b.name === branch.value)) {
    branch.value = pickDefaultBranch(list.branches)
  }
}

function onShow() {
  if (!canShow.value || branch.value === null || count.value === null) return
  viewError.value = null
  void loader.loadHistory(branch.value, count.value)
}

// 確定した入力(ブランチの変更、件数の確定)が変わったら、実行中の取得は中断する。
// 取得済みの詳細は client のキャッシュに残るので、やり直しのコストは小さい。
watch(branch, () => {
  if (loadingHistory.value) loader.cancel()
})
function onCountCommitted() {
  if (loadingHistory.value) loader.cancel()
}

watch(result, () => {
  viewError.value = null
})
</script>

<template>
  <div class="app">
    <header class="app-header">
      <div>
        <h1>{{ t.title }}</h1>
        <p class="tagline">{{ t.tagline }}</p>
      </div>
      <RateLimitBadge :rate-limit="rateLimit" :now="now" />
    </header>

    <section class="controls" aria-label="Repository">
      <RepoForm v-model="repoInput" :busy="loadingBranches" @submit="onRepoSubmit" />

      <form class="show-form" @submit.prevent="onShow">
        <BranchSelect
          v-model="branch"
          :branches="branches"
          :has-more="hasMoreBranches"
          :disabled="loadingBranches"
        />
        <CountInput v-model="count" @change="onCountCommitted" />
        <button type="submit" :disabled="!canShow">{{ t.show }}</button>
        <button v-if="loadingHistory" type="button" @click="loader.cancel()">
          {{ t.cancel }}
        </button>
        <p v-if="estimateText" class="estimate">{{ estimateText }}</p>
      </form>

      <ProgressBar :active="loadingHistory" :progress="progress" />
    </section>

    <ErrorBanner :error="displayedError" :rate-limit="rateLimit" :now="now" />

    <main class="result-area" :aria-busy="loadingHistory">
      <template v-if="result">
        <h2 class="result-heading">
          {{
            t.resultHeading(
              `${result.repo.owner}/${result.repo.repo}`,
              result.branch,
              result.data.commits.length,
            )
          }}
          <span v-if="loadingHistory" class="updating">{{ t.updating }}</span>
        </h2>
        <WarningList :warnings="result.warnings" />
        <div :class="{ stale: loadingHistory }">
          <FileGrassView :data="result.data" @error="viewError = $event" />
        </div>
      </template>
      <p v-else class="intro">{{ t.intro }}</p>
    </main>
  </div>
</template>

<style>
body {
  margin: 0;
  font-family:
    system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
  color: #1f2328;
  background: #fff;
}
.app {
  max-width: 100rem;
  margin: 0 auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.app-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem 1.5rem;
}
.app-header h1 {
  margin: 0;
  font-size: 1.5rem;
}
.tagline {
  margin: 0.25rem 0 0;
  color: #57606a;
}
.controls {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.show-form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.75rem 1.5rem;
}
.estimate {
  margin: 0;
  align-self: center;
  font-size: 0.9rem;
  color: #57606a;
}
.result-area {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.result-heading {
  margin: 0;
  font-size: 1.1rem;
}
.updating {
  margin-left: 0.5rem;
  font-size: 0.85rem;
  font-weight: 400;
  color: #57606a;
}
.stale {
  opacity: 0.5;
}
.intro {
  margin: 0;
  max-width: 48rem;
  color: #57606a;
}
button:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 2px solid #0969da;
  outline-offset: 2px;
}
</style>
