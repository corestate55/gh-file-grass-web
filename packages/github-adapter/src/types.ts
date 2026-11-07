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
