import { parseRepoInput } from '@gh-file-grass/github-adapter'
import type {
  BranchInfo,
  BranchList,
  HistoryResult,
  Progress,
  RateLimitInfo,
  RepoRef,
} from '@gh-file-grass/github-adapter'
import { getCurrentScope, onScopeDispose, ref, shallowRef } from 'vue'
import type { Ref, ShallowRef } from 'vue'
import type { HistoryClient } from '../lib/client'
import { NoBranchesError } from '../lib/errors'

export type Phase = 'idle' | 'loadingBranches' | 'ready' | 'loadingHistory'

/** 表示中の結果。見出しに「どのリポジトリ・ブランチ・件数の結果か」を出すために添える */
export interface LoadedResult extends HistoryResult {
  repo: RepoRef
  branch: string
  count: number
}

export interface HistoryLoader {
  phase: Readonly<Ref<Phase>>
  repo: Readonly<ShallowRef<RepoRef | null>>
  branches: Readonly<ShallowRef<readonly BranchInfo[]>>
  hasMoreBranches: Readonly<Ref<boolean>>
  progress: Readonly<ShallowRef<Progress | null>>
  result: Readonly<ShallowRef<LoadedResult | null>>
  /** 表示すべきエラー。中断(aborted)は入らない */
  error: Readonly<ShallowRef<unknown>>
  rateLimit: Readonly<ShallowRef<RateLimitInfo | null>>
  /** 取得が終わるたびに増える。client 内のキャッシュは reactive でないので、見積もりの再計算に使う */
  cacheVersion: Readonly<Ref<number>>
  /** 入力が不正なら error を設定して null。古い呼び出しの結果も null */
  loadBranches(input: string): Promise<BranchList | null>
  loadHistory(branch: string, count: number): Promise<void>
  cancel(): void
  estimate(branch: string, count: number): { requests: number; exact: boolean } | null
  refreshRateLimit(): Promise<void>
}

const sameRepo = (a: RepoRef, b: RepoRef) =>
  `${a.owner}/${a.repo}`.toLowerCase() === `${b.owner}/${b.repo}`.toLowerCase()

const isAborted = (e: unknown) => (e as { kind?: unknown } | null)?.kind === 'aborted'

/**
 * 取得の状態を持つ composable。
 *
 * - 取得は常に 1 つだけ。新しい取得を始めると前のものは中断され、世代番号で結果を捨てる
 *   (client が中断を無視して後から解決しても、状態は変わらない)。
 * - `client` は ref / reactive に入れない(GitHubClient は #private を持ち、Proxy 越しだと失敗する)。
 * - 大きな GitLogData を deep reactive にしないよう、結果は shallowRef で持つ。
 */
export function useHistoryLoader(
  client: HistoryClient,
  options: { timeZone?: string | undefined } = {},
): HistoryLoader {
  const phase = ref<Phase>('idle')
  const repo = shallowRef<RepoRef | null>(null)
  const branches = shallowRef<readonly BranchInfo[]>([])
  const hasMoreBranches = ref(false)
  const progress = shallowRef<Progress | null>(null)
  const result = shallowRef<LoadedResult | null>(null)
  const error = shallowRef<unknown>(null)
  const rateLimit = shallowRef<RateLimitInfo | null>(null)
  const cacheVersion = ref(0)

  let generation = 0
  let controller: AbortController | null = null

  /** 前の取得を中断して新しい世代を始める */
  function start() {
    controller?.abort()
    controller = new AbortController()
    return { my: ++generation, signal: controller.signal }
  }

  /** 失敗・中断のあとでも、観測できた残量とキャッシュの変化を反映する */
  function syncMeta() {
    rateLimit.value = client.lastRateLimit
    cacheVersion.value++
  }

  const stableAfterBranches = (): Phase => (branches.value.length > 0 ? 'ready' : 'idle')

  async function loadBranches(input: string): Promise<BranchList | null> {
    // 入力の解析に失敗しても、進行中の取得は中断しない
    let parsed: RepoRef
    try {
      parsed = parseRepoInput(input)
    } catch (e) {
      error.value = e
      return null
    }

    const { my, signal } = start()
    error.value = null
    progress.value = null
    if (!repo.value || !sameRepo(repo.value, parsed)) {
      branches.value = []
      hasMoreBranches.value = false
      result.value = null
    }
    repo.value = parsed
    phase.value = 'loadingBranches'

    try {
      const list = await client.fetchBranches(parsed, { signal })
      if (my !== generation) return null
      if (list.branches.length === 0) throw new NoBranchesError()
      branches.value = list.branches
      hasMoreBranches.value = list.hasMore
      phase.value = 'ready'
      return list
    } catch (e) {
      if (my === generation) {
        phase.value = stableAfterBranches()
        if (!isAborted(e)) error.value = e
      }
      return null
    } finally {
      syncMeta()
    }
  }

  async function loadHistory(branch: string, count: number): Promise<void> {
    const target = repo.value
    if (!target) return

    const { my, signal } = start()
    error.value = null
    progress.value = null
    phase.value = 'loadingHistory'

    try {
      const res = await client.fetchHistory(target, branch, {
        count,
        signal,
        ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
        onProgress: (p) => {
          if (my === generation) progress.value = { ...p }
        },
      })
      if (my !== generation) return
      result.value = { ...res, repo: target, branch, count }
      progress.value = null
      phase.value = 'ready'
    } catch (e) {
      if (my === generation) {
        progress.value = null
        phase.value = 'ready'
        if (!isAborted(e)) error.value = e
      }
    } finally {
      syncMeta()
    }
  }

  function cancel(): void {
    controller?.abort()
    controller = null
    generation++ // 進行中の取得の結果は捨てられる
    progress.value = null
    if (phase.value === 'loadingHistory') phase.value = 'ready'
    else if (phase.value === 'loadingBranches') phase.value = stableAfterBranches()
  }

  function estimate(branch: string, count: number) {
    void cacheVersion.value // 依存として登録(取得のたびに再計算される)
    if (!repo.value) return null
    try {
      return client.estimateCost(repo.value, branch, count)
    } catch {
      return null // count が範囲外など
    }
  }

  async function refreshRateLimit(): Promise<void> {
    try {
      await client.fetchRateLimit()
    } catch {
      // 残量バッジが「不明」のままになるだけ
    } finally {
      rateLimit.value = client.lastRateLimit
    }
  }

  if (getCurrentScope()) onScopeDispose(cancel)

  return {
    phase,
    repo,
    branches,
    hasMoreBranches,
    progress,
    result,
    error,
    rateLimit,
    cacheVersion,
    loadBranches,
    loadHistory,
    cancel,
    estimate,
    refreshRateLimit,
  }
}
