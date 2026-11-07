import { HttpError } from './errors'
import { hasNextLink, mergeRateLimit, requestJson } from './http'
import type { JsonResponse, Operation } from './http'
import { LruCache, TtlCache } from './cache'
import { Semaphore } from './semaphore'
import type { BranchInfo, BranchList, RateLimitInfo, RepoRef } from './types'

export interface GitHubClientOptions {
  /** テスト用に差し替え可。既定は globalThis.fetch */
  fetch?: typeof fetch
  /** 既定 https://api.github.com */
  baseUrl?: string
  /** 詳細取得の同時実行数。既定 4 */
  concurrency?: number
  /** fetchHistory の count の上限。既定 50(1〜100) */
  maxCount?: number
  /** 時計(ms)。TTL・残量の観測時刻に使う。テスト用 */
  now?: () => number
  /** commit 詳細キャッシュの件数上限。既定 500 */
  detailCacheSize?: number
  /** ブランチ・commit 一覧キャッシュの TTL(ms)。既定 5 分 */
  listTtlMs?: number
}

export const DEFAULT_COUNT = 20
const DEFAULT_MAX_COUNT = 50
const DEFAULT_CONCURRENCY = 4
const DEFAULT_DETAIL_CACHE = 500
const DEFAULT_LIST_TTL = 5 * 60_000

const cloneRate = (r: RateLimitInfo): RateLimitInfo => ({
  limit: r.limit,
  remaining: r.remaining,
  resetAt: new Date(r.resetAt),
  observedAt: new Date(r.observedAt),
})

export const repoKey = (ref: RepoRef) => `${ref.owner}/${ref.repo}`.toLowerCase()
export const repoPath = (ref: RepoRef) =>
  `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`

function positiveInt(name: string, value: number, max = Infinity): number {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${name} must be an integer in 1..${max}: ${value}`)
  }
  return value
}

/**
 * GitHub REST API(未認証)から履歴を取得するクライアント。
 * キャッシュはインスタンスの中だけに持つ(1 ページにつき 1 インスタンスを想定)。
 */
export class GitHubClient {
  readonly maxCount: number
  protected readonly fetchFn: typeof fetch
  protected readonly baseUrl: string
  protected readonly now: () => number
  protected readonly semaphore: Semaphore
  protected readonly detailCache: LruCache<string, unknown>
  protected readonly listCache: TtlCache<string, string[]>
  protected readonly branchCache: TtlCache<string, BranchList>
  #rate: RateLimitInfo | null = null

  constructor(options: GitHubClientOptions = {}) {
    const f = options.fetch
    // 素の globalThis.fetch を別オブジェクトのメソッドとして呼ぶと Illegal invocation になるため包む
    this.fetchFn = f ?? ((...args) => globalThis.fetch(...args))
    this.baseUrl = (options.baseUrl ?? 'https://api.github.com').replace(/\/+$/, '')
    this.now = options.now ?? (() => Date.now())
    this.maxCount = positiveInt('maxCount', options.maxCount ?? DEFAULT_MAX_COUNT, 100)
    this.semaphore = new Semaphore(
      positiveInt('concurrency', options.concurrency ?? DEFAULT_CONCURRENCY),
    )
    this.detailCache = new LruCache(
      positiveInt('detailCacheSize', options.detailCacheSize ?? DEFAULT_DETAIL_CACHE),
    )
    const ttl = options.listTtlMs ?? DEFAULT_LIST_TTL
    this.listCache = new TtlCache(ttl, this.now)
    this.branchCache = new TtlCache(ttl, this.now)
  }

  /** 最後に観測した残量(コピー)。並列・古い応答の影響を受けないよう畳み込み済み */
  get lastRateLimit(): RateLimitInfo | null {
    return this.#rate ? cloneRate(this.#rate) : null
  }

  protected observe(info: RateLimitInfo | null): void {
    this.#rate = mergeRateLimit(this.#rate, info)
  }

  protected rateSnapshot(): RateLimitInfo | null {
    return this.#rate
  }

  protected request(
    op: Operation,
    path: string,
    opts: {
      query?: Record<string, string | number>
      signal?: AbortSignal | undefined
      track?: boolean
    } = {},
  ): Promise<JsonResponse> {
    return requestJson({
      fetch: this.fetchFn,
      baseUrl: this.baseUrl,
      path,
      op,
      now: this.now,
      signal: opts.signal,
      ...(opts.query ? { query: opts.query } : {}),
      ...(opts.track === false ? {} : { onRateLimit: (info) => this.observe(info) }),
    })
  }

  /**
   * GET /rate_limit(枠を消費しない)。本文の値を畳み込んで返す。
   * アプリ起動時のバッジ表示や、残量が未観測のときの事前チェックに使う。
   */
  async fetchRateLimit(opts: { signal?: AbortSignal } = {}): Promise<RateLimitInfo> {
    const res = await this.request('rate_limit', '/rate_limit', {
      signal: opts.signal,
      track: false, // このリクエスト自体のヘッダではなく、本文(core の値)を使う
    })
    const body = res.body as {
      resources?: { core?: Record<string, unknown> }
      rate?: Record<string, unknown>
    } | null
    const core = body?.resources?.core ?? body?.rate
    const limit = Number(core?.limit)
    const remaining = Number(core?.remaining)
    const reset = Number(core?.reset)
    if (![limit, remaining, reset].every(Number.isFinite)) {
      throw new HttpError(200, 'invalid response')
    }
    this.observe({
      limit,
      remaining,
      resetAt: new Date(reset * 1000),
      observedAt: new Date(this.now()),
    })
    return this.lastRateLimit!
  }

  /** ブランチ一覧(1 ページ = 最大 100 件)。100 件を超えるときは `hasMore` が立つ */
  async fetchBranches(ref: RepoRef, opts: { signal?: AbortSignal } = {}): Promise<BranchList> {
    const key = repoKey(ref)
    const cached = this.branchCache.get(key)
    if (cached) return cloneBranches(cached)

    const res = await this.request('branches', `${repoPath(ref)}/branches`, {
      query: { per_page: 100 },
      signal: opts.signal,
    })
    if (!Array.isArray(res.body)) throw new HttpError(200, 'invalid response')

    const branches: BranchInfo[] = []
    for (const b of res.body as { name?: unknown; commit?: { sha?: unknown } }[]) {
      if (typeof b?.name === 'string' && typeof b.commit?.sha === 'string') {
        branches.push({ name: b.name, headSha: b.commit.sha })
      }
    }
    const list: BranchList = { branches, hasMore: hasNextLink(res.headers.get('link')) }
    this.branchCache.set(key, list)
    return cloneBranches(list)
  }
}

const cloneBranches = (l: BranchList): BranchList => ({
  branches: l.branches.map((b) => ({ ...b })),
  hasMore: l.hasMore,
})
