export interface RepoRef {
  owner: string
  repo: string
}

export interface Warning {
  kind: 'truncated' | 'unknown-src'
  sha?: string
  detail?: string
}
