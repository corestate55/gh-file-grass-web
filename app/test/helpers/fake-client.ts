import { AbortedError } from '@gh-file-grass/github-adapter'
import type {
  BranchInfo,
  BranchList,
  FetchHistoryOptions,
  HistoryResult,
  RateLimitInfo,
  RepoRef,
} from '@gh-file-grass/github-adapter'
import type { HistoryClient } from '../../src/lib/client'
import { deferred } from './deferred'

export interface PendingCall<T> {
  signal: AbortSignal | undefined
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
  settled: boolean
}

export type BranchesCall = PendingCall<BranchList> & { ref: RepoRef }
export type HistoryCall = PendingCall<HistoryResult> & {
  ref: RepoRef
  branch: string
  opts: FetchHistoryOptions
}

export const emptyData = (repo = 'o/r', branch = 'main') => ({
  repo,
  branch,
  origin: `https://github.com/${repo}`,
  commits: [],
  stats: [],
  files: [],
})

export const branchList = (names: string[], hasMore = false): BranchList => ({
  branches: names.map((name): BranchInfo => ({ name, headSha: 'a'.repeat(40) })),
  hasMore,
})

export const historyResult = (over: Partial<HistoryResult> = {}): HistoryResult => ({
  data: emptyData(),
  warnings: [],
  rateLimit: null,
  ...over,
})

export const rateInfo = (
  remaining: number,
  resetAtMs = Date.UTC(2026, 10, 7, 13, 0, 0),
): RateLimitInfo => ({
  limit: 60,
  remaining,
  resetAt: new Date(resetAtMs),
  observedAt: new Date(Date.UTC(2026, 10, 7, 12, 0, 0)),
})

/**
 * 呼び出しを手動で解決できる fake。実物の GitHubClient と同じく、signal が中断されると
 * AbortedError で reject する。`ignoreAbort: true` なら中断を無視し、後から解決できる
 * (古い結果が混入する状況の再現用)。
 */
export function createFakeClient(options: { ignoreAbort?: boolean } = {}) {
  const state = {
    rate: null as RateLimitInfo | null,
    estimate: (_ref: RepoRef, _branch: string, count: number) =>
      ({ requests: 1 + count, exact: false }) as { requests: number; exact: boolean },
    rateLimitResult: null as RateLimitInfo | Error | null,
  }
  const branchesCalls: BranchesCall[] = []
  const historyCalls: HistoryCall[] = []
  let rateLimitCalls = 0

  function pending<T>(signal: AbortSignal | undefined) {
    const d = deferred<T>()
    const call = { signal, settled: false } as PendingCall<T>
    call.resolve = (v) => {
      call.settled = true
      d.resolve(v)
    }
    call.reject = (e) => {
      call.settled = true
      d.reject(e)
    }
    if (!options.ignoreAbort) {
      signal?.addEventListener('abort', () => {
        if (!call.settled) call.reject(new AbortedError(signal.reason))
      })
    }
    return { call, promise: d.promise }
  }

  const client: HistoryClient = {
    fetchBranches(ref, opts) {
      const { call, promise } = pending<BranchList>(opts?.signal)
      branchesCalls.push(Object.assign(call, { ref }))
      return promise
    },
    fetchHistory(ref, branch, opts = {}) {
      const { call, promise } = pending<HistoryResult>(opts.signal)
      historyCalls.push(Object.assign(call, { ref, branch, opts }))
      return promise
    },
    async fetchRateLimit() {
      rateLimitCalls++
      const r = state.rateLimitResult
      if (r instanceof Error) throw r
      if (r) state.rate = r
      return state.rate ?? rateInfo(60)
    },
    estimateCost(ref, branch, count) {
      return state.estimate(ref, branch, count ?? 20)
    },
    get lastRateLimit() {
      return state.rate
    },
  }

  return {
    client,
    state,
    branchesCalls,
    historyCalls,
    get rateLimitCalls() {
      return rateLimitCalls
    },
  }
}

export type FakeClient = ReturnType<typeof createFakeClient>
