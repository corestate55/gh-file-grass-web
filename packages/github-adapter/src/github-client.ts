import { AbortedError, HttpError, RateLimitError } from './errors'
import { hasNextLink, mergeRateLimit, requestJson } from './http'
import type { JsonResponse, Operation } from './http'
import { LruCache, TtlCache } from './cache'
import { assertTimeZone } from './date'
import type { GhCommitDetail } from './github-types'
import { Semaphore } from './semaphore'
import { toCachedDetail } from './slim-detail'
import { ShaShortCollisionError, toGitLogData } from './to-git-log-data'
import type {
  BranchInfo,
  BranchList,
  HistoryResult,
  Progress,
  RateLimitInfo,
  RepoRef,
} from './types'

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

export interface FetchHistoryOptions {
  /** 直近何件か。1〜maxCount、既定 20 */
  count?: number
  signal?: AbortSignal
  /** 進捗。一覧(0/1 → 1/1)のあと、詳細は命中済みの件数から始めて 1 件ごとに増える */
  onProgress?: (p: Progress) => void
  /** 日付の書式に使う IANA 名。省略時は実行環境の既定。不正な値は取得前に RangeError */
  timeZone?: string
}

interface DetailEntry {
  detail: GhCommitDetail
  /** files が 1 ページ目で切り詰められている(Link に rel="next" があった) */
  truncated: boolean
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
const detailKey = (ref: RepoRef, sha: string) => `${repoKey(ref)}@${sha}`
// ブランチ名は大文字小文字を区別する
const listKey = (ref: RepoRef, branch: string) => `${repoKey(ref)}#${branch}`

const SHA_RE = /^[0-9a-f]{40}$/

function parseShaList(body: unknown): string[] {
  if (!Array.isArray(body)) throw new HttpError(200, 'invalid response')
  return body.map((c: { sha?: unknown } | null) => {
    // 一覧の応答は信頼できない入力: URL に埋め込む前に形式を確認する
    if (typeof c?.sha !== 'string' || !SHA_RE.test(c.sha)) {
      throw new HttpError(200, 'invalid response')
    }
    return c.sha
  })
}

function assertDetail(body: unknown, sha: string): GhCommitDetail {
  const d = body as Partial<GhCommitDetail> | null
  if (
    typeof d !== 'object' ||
    d === null ||
    d.sha !== sha ||
    !Array.isArray(d.parents) ||
    typeof d.commit !== 'object' ||
    d.commit === null ||
    (d.files !== undefined && !Array.isArray(d.files))
  ) {
    throw new HttpError(200, 'invalid response')
  }
  return d as GhCommitDetail
}
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
  protected readonly detailCache: LruCache<string, DetailEntry>
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

  /**
   * 見積もり。一覧がキャッシュにあれば、詳細の未取得件数(厳密)。無ければ 1 + count(上限値)。
   * 消費するのは「一覧 1 + 未取得の詳細」。
   */
  estimateCost(
    ref: RepoRef,
    branch: string,
    count = DEFAULT_COUNT,
  ): { requests: number; exact: boolean } {
    positiveInt('count', count, this.maxCount)
    const shas = this.listCache.get(listKey(ref, branch))
    if (!shas) return { requests: 1 + count, exact: false }
    const missing = shas.slice(0, count).filter((sha) => !this.detailCache.has(detailKey(ref, sha)))
    return { requests: missing.length, exact: true }
  }

  /**
   * 直近 count 件の履歴を取得して GitLogData にする。
   *
   * 1. 引数を検証(リクエスト前。予算を使い切った後に失敗しないように)
   * 2. 一覧を取得(TTL キャッシュ。常に per_page=maxCount で取り、先頭 count 件を使う)
   * 3. sha_short の衝突を事前検出
   * 4. 未取得の詳細の件数が残量を超えるなら、取得前に RateLimitError
   * 5. 詳細を同時実行数の上限つきで取得。最初のエラーで残りを中断(取得済みはキャッシュに残る)
   * 6. toGitLogData で変換
   */
  async fetchHistory(
    ref: RepoRef,
    branch: string,
    opts: FetchHistoryOptions = {},
  ): Promise<HistoryResult> {
    const count = opts.count ?? DEFAULT_COUNT
    positiveInt('count', count, this.maxCount)
    if (typeof branch !== 'string' || branch === '') {
      throw new RangeError('branch must not be empty')
    }
    assertTimeZone(opts.timeZone)
    const { signal, onProgress } = opts
    if (signal?.aborted) throw new AbortedError(signal.reason)

    // 内部の中断(最初のエラー)と、呼び出し側の中断を合成する
    const internal = new AbortController()
    const onUserAbort = () => internal.abort(signal?.reason)
    signal?.addEventListener('abort', onUserAbort, { once: true })
    let finished = false
    const progress = (p: Progress) => {
      if (!finished) onProgress?.(p)
    }
    try {
      return await this.#history(ref, branch, count, opts.timeZone, signal, internal, progress)
    } finally {
      finished = true
      signal?.removeEventListener('abort', onUserAbort)
    }
  }

  async #history(
    ref: RepoRef,
    branch: string,
    count: number,
    timeZone: string | undefined,
    userSignal: AbortSignal | undefined,
    internal: AbortController,
    progress: (p: Progress) => void,
  ): Promise<HistoryResult> {
    // --- 一覧 ---
    progress({ phase: 'list', done: 0, total: 1 })
    const lk = listKey(ref, branch)
    let shas = this.listCache.get(lk)
    if (!shas) {
      const res = await this.request('list', `${repoPath(ref)}/commits`, {
        query: { sha: branch, per_page: this.maxCount },
        signal: internal.signal,
      })
      shas = parseShaList(res.body)
      this.listCache.set(lk, shas)
    }
    progress({ phase: 'list', done: 1, total: 1 })
    const use = shas.slice(0, count)

    // --- sha_short の衝突は、詳細を取得する前に検出する ---
    const seen = new Set<string>()
    for (const sha of use) {
      const short = sha.slice(0, 7)
      if (seen.has(short)) throw new ShaShortCollisionError(short)
      seen.add(short)
    }

    // --- キャッシュ命中と未取得 ---
    const entries = new Map<string, DetailEntry>()
    for (const sha of use) {
      const hit = this.detailCache.get(detailKey(ref, sha))
      if (hit) entries.set(sha, hit)
    }
    const missing = use.filter((sha) => !entries.has(sha))

    // --- 残量の事前チェック(needed === remaining は通す) ---
    if (missing.length > 0) {
      let rate = this.rateSnapshot()
      if (!rate || this.now() >= rate.resetAt.getTime()) {
        await this.fetchRateLimit({ signal: internal.signal }) // 枠を消費しない
        rate = this.rateSnapshot()
      }
      if (rate && missing.length > rate.remaining) {
        throw new RateLimitError({
          reason: 'insufficient',
          limit: rate.limit,
          remaining: rate.remaining,
          resetAt: new Date(rate.resetAt),
          needed: missing.length,
        })
      }
    }

    // --- 詳細(並列。最初のエラーで残りを中断) ---
    let done = use.length - missing.length
    progress({ phase: 'detail', done, total: use.length })

    let firstError: unknown
    const fail = (e: unknown) => {
      if (firstError === undefined) {
        firstError = e
        internal.abort(e)
      }
    }
    const fetchOne = async (sha: string) => {
      let release: (() => void) | undefined
      try {
        release = await this.semaphore.acquire(internal.signal)
        const res = await this.request('detail', `${repoPath(ref)}/commits/${sha}`, {
          signal: internal.signal,
        })
        const detail = assertDetail(res.body, sha)
        const entry: DetailEntry = {
          detail: toCachedDetail(detail),
          truncated: hasNextLink(res.headers.get('link')),
        }
        this.detailCache.set(detailKey(ref, sha), entry)
        entries.set(sha, entry)
        done++
        progress({ phase: 'detail', done, total: use.length })
      } catch (e) {
        fail(e) // 2 件目以降(兄弟の中断を含む)は捨てられる
      } finally {
        release?.()
      }
    }
    await Promise.allSettled(missing.map(fetchOne))

    if (userSignal?.aborted) throw new AbortedError(userSignal.reason)
    if (firstError !== undefined) throw firstError

    // --- 変換 ---
    const commits = use.map((sha) => entries.get(sha)!.detail)
    const truncatedShas = new Set(use.filter((sha) => entries.get(sha)!.truncated))
    const { data, warnings } = toGitLogData({
      ref,
      branch,
      commits,
      ...(timeZone === undefined ? {} : { timeZone }),
      truncatedShas,
    })
    return { data, warnings, rateLimit: this.lastRateLimit }
  }
}

const cloneBranches = (l: BranchList): BranchList => ({
  branches: l.branches.map((b) => ({ ...b })),
  hasMore: l.hasMore,
})
