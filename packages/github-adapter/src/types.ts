import type { GitLogData } from '@gh-file-grass/core/schema'

export interface RepoRef {
  owner: string
  repo: string
}

export interface Warning {
  kind: 'truncated' | 'unknown-src'
  sha?: string
  detail?: string
}

export interface RateLimitInfo {
  limit: number
  remaining: number
  resetAt: Date
  /** クライアントの時計で観測した時刻 */
  observedAt: Date
}

export interface BranchInfo {
  name: string
  headSha: string
}

export interface BranchList {
  branches: BranchInfo[]
  /** 100 件を超えるブランチがあり、一覧に出ていないものがある */
  hasMore: boolean
}

export interface Progress {
  phase: 'list' | 'detail'
  done: number
  total: number
}

export interface HistoryResult {
  data: GitLogData
  warnings: Warning[]
  /** 取得後の最新の残量(観測できていれば) */
  rateLimit: RateLimitInfo | null
}
