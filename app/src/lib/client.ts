import type { InjectionKey } from 'vue'
import type { GitHubClient } from '@gh-file-grass/github-adapter'

/** UI が使う GitHubClient の範囲。テストでは fake を差し込む */
export type HistoryClient = Pick<
  GitHubClient,
  'fetchBranches' | 'fetchHistory' | 'fetchRateLimit' | 'estimateCost' | 'lastRateLimit'
>

export const HISTORY_CLIENT: InjectionKey<HistoryClient> = Symbol('history-client')
