import {
  AbortedError,
  EmptyRepositoryError,
  HttpError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  SecondaryRateLimitError,
} from './errors'
import type { GitHubError } from './errors'
import type { RateLimitInfo } from './types'

/** どの API を呼んだか。同じステータスでも意味が変わる(404 / 409 / 422)ので分類に使う */
export type Operation = 'branches' | 'list' | 'detail' | 'rate_limit'

const SECONDARY_DEFAULT_WAIT_SEC = 60
const MAX_API_MESSAGE = 500

/** `Link` ヘッダに rel="next" があるか(`rel="next last"` のような複数指定も扱う) */
export function hasNextLink(link: string | null | undefined): boolean {
  if (!link) return false
  for (const m of link.matchAll(/<[^>]*>([^<]*)/g)) {
    const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^\s;,]+))/i.exec(m[1] ?? '')
    const value = rel?.[1] ?? rel?.[2]
    if (value?.toLowerCase().split(/\s+/).includes('next')) return true
  }
  return false
}

/** `X-RateLimit-*` を読む。3 つとも揃った有限数でなければ null。core 以外のリソースは無視 */
export function parseRateLimitHeaders(headers: Headers, now: number): RateLimitInfo | null {
  const resource = headers.get('x-ratelimit-resource')
  if (resource !== null && resource !== 'core') return null
  const num = (name: string): number | null => {
    const v = headers.get(name)
    if (v === null || v.trim() === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const limit = num('x-ratelimit-limit')
  const remaining = num('x-ratelimit-remaining')
  const reset = num('x-ratelimit-reset')
  if (limit === null || remaining === null || reset === null) return null
  return { limit, remaining, resetAt: new Date(reset * 1000), observedAt: new Date(now) }
}

/**
 * 観測値を畳み込む。並列リクエストでは応答の到着順が送信順と一致せず、ブラウザの HTTP キャッシュ
 * から返った応答は古いヘッダを持ち得る。単純に「最後の値」を採ると remaining が戻ってしまう。
 *  - 新しい窓(resetAt が後)なら置き換える
 *  - 同じ窓なら remaining の小さい方
 *  - 古い窓は無視する
 */
export function mergeRateLimit(
  prev: RateLimitInfo | null,
  next: RateLimitInfo | null,
): RateLimitInfo | null {
  if (!next) return prev
  if (!prev) return next
  const p = prev.resetAt.getTime()
  const n = next.resetAt.getTime()
  if (n > p) return next
  if (n < p) return prev
  return next.remaining < prev.remaining ? next : prev
}

/** `Retry-After`(秒数、または HTTP-date)を秒にする。解釈できなければ null */
export function parseRetryAfter(value: string | null, now: number): number | null {
  if (value === null) return null
  const v = value.trim()
  if (/^\d+$/.test(v)) return Number(v)
  // HTTP-date は曜日・月名を含む。Date.parse('-5') のような緩い解釈を避ける
  if (!/[a-z]/i.test(v)) return null
  const t = Date.parse(v)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.ceil((t - now) / 1000))
}

function messageOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const m = (body as { message?: unknown }).message
  return typeof m === 'string' ? m.slice(0, MAX_API_MESSAGE) : undefined
}

/** 失敗したレスポンスを `GitHubError` にする(上から順に判定)。自動リトライはしない */
export function classifyErrorResponse(
  status: number,
  headers: Headers,
  body: unknown,
  ctx: { op: Operation; now: number },
): GitHubError {
  const apiMessage = messageOf(body)

  if (status === 403 || status === 429) {
    const retryAfter = parseRetryAfter(headers.get('retry-after'), ctx.now)
    if (retryAfter !== null) {
      return new SecondaryRateLimitError(
        retryAfter,
        new Date(ctx.now + retryAfter * 1000),
        status,
        apiMessage,
      )
    }
    const rl = parseRateLimitHeaders(headers, ctx.now)
    if (headers.get('x-ratelimit-remaining') === '0') {
      return new RateLimitError({
        reason: 'exhausted',
        limit: rl?.limit ?? 0,
        remaining: 0,
        // 読めなければ最悪の想定(1 時間後)
        resetAt: rl?.resetAt ?? new Date(ctx.now + 3600_000),
        status,
        ...(apiMessage === undefined ? {} : { apiMessage }),
      })
    }
    if (status === 429 || (apiMessage !== undefined && /secondary rate limit/i.test(apiMessage))) {
      return new SecondaryRateLimitError(
        SECONDARY_DEFAULT_WAIT_SEC,
        new Date(ctx.now + SECONDARY_DEFAULT_WAIT_SEC * 1000),
        status,
        apiMessage,
      )
    }
  }

  if (status === 404) {
    if (ctx.op === 'branches') return new NotFoundError('repository', status, apiMessage)
    if (ctx.op === 'list') return new NotFoundError('branch_or_repository', status, apiMessage)
    if (ctx.op === 'detail') return new NotFoundError('commit', status, apiMessage)
  }
  if (status === 409 && ctx.op === 'list') return new EmptyRepositoryError()
  // 存在しないブランチを sha に指定すると 422 になることがある
  if (status === 422 && ctx.op === 'list') return new NotFoundError('branch', status, apiMessage)

  return new HttpError(status, undefined, apiMessage)
}

export interface RequestOptions {
  fetch: typeof fetch
  /** 末尾に / を付けない */
  baseUrl: string
  /** エンコード済みのパス('/repos/o/r/commits') */
  path: string
  query?: Record<string, string | number>
  signal?: AbortSignal | undefined
  op: Operation
  now: () => number
  /** ヘッダから残量を読めたら(成功・失敗を問わず)呼ぶ */
  onRateLimit?: (info: RateLimitInfo) => void
}

export interface JsonResponse {
  body: unknown
  headers: Headers
  rateLimit: RateLimitInfo | null
}

/**
 * GET して JSON を返す。失敗は `GitHubError` として投げる。
 *
 * リクエストヘッダは `Accept` だけにする。これは CORS の「単純ヘッダ」なのでプリフライト
 * (OPTIONS)が発生しない。`X-GitHub-Api-Version` や `If-None-Match` は単純ヘッダではなく、
 * 詳細 API は sha ごとに URL が違うため、付けると全リクエストに OPTIONS の往復が増える。
 * ETag の再検証はブラウザの HTTP キャッシュに任せる。Authorization も付けない(未認証のみ)。
 */
export async function requestJson(o: RequestOptions): Promise<JsonResponse> {
  const url = new URL(o.baseUrl + o.path)
  for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, String(v))

  const aborted = (e: unknown) => new AbortedError(o.signal?.reason ?? e)

  let res: Response
  try {
    res = await o.fetch(url.toString(), {
      headers: { Accept: 'application/vnd.github+json' },
      ...(o.signal ? { signal: o.signal } : {}),
    })
  } catch (e) {
    if (o.signal?.aborted) throw aborted(e)
    throw new NetworkError(e)
  }

  const rateLimit = parseRateLimitHeaders(res.headers, o.now())
  if (rateLimit) o.onRateLimit?.(rateLimit)

  let body: unknown
  let parsed = true
  try {
    body = await res.json()
  } catch (e) {
    if (o.signal?.aborted) throw aborted(e)
    parsed = false
  }

  if (!res.ok) {
    throw classifyErrorResponse(res.status, res.headers, parsed ? body : undefined, {
      op: o.op,
      now: o.now(),
    })
  }
  if (!parsed) throw new HttpError(res.status, 'invalid response')
  return { body, headers: res.headers, rateLimit }
}
