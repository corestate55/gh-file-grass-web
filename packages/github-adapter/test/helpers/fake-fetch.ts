import type { GhCommitDetail } from '../../src/github-types'
import { loadDetails } from './fixtures'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const RESET_EPOCH = 1_700_003_600

export interface Call {
  seq: number
  url: URL
  /** '/repos/o/r/commits' など(クエリなし) */
  path: string
  kind: 'branches' | 'list' | 'detail' | 'rate_limit' | 'other'
  init: RequestInit | undefined
  signal: AbortSignal | undefined
}

export interface Pending {
  call: Call
  release: () => void
}

export interface FakeFetchOptions {
  limit?: number
  remaining?: number
  /** true の間、詳細リクエストは release() されるまで応答しない */
  hold?: boolean
  /** 詳細 API の応答(既定は録画した 64 件) */
  details?: GhCommitDetail[]
}

type Responder = (call: Call) => Response | Promise<Response> | undefined

const FIXTURES = join(import.meta.dirname, '../fixtures')
const fixtureBody = (name: string) =>
  (JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as { body: unknown }).body

const kindOf = (path: string): Call['kind'] => {
  if (path === '/rate_limit') return 'rate_limit'
  if (/^\/repos\/[^/]+\/[^/]+\/branches$/.test(path)) return 'branches'
  if (/^\/repos\/[^/]+\/[^/]+\/commits$/.test(path)) return 'list'
  if (/^\/repos\/[^/]+\/[^/]+\/commits\/[^/]+$/.test(path)) return 'detail'
  return 'other'
}

/**
 * 録画した fixture を再生する fetch。GitHub を真似て、/rate_limit 以外のリクエストごとに
 * 残量を 1 減らし、0 のときは 403 (remaining=0) を返す。
 */
export function createFakeFetch(options: FakeFetchOptions = {}) {
  const limit = options.limit ?? 60
  // reset: 現在の窓の終了時刻(epoch 秒)。新しい窓を再現するときはテストで進める
  const server = {
    remaining: options.remaining ?? limit,
    hold: options.hold ?? false,
    limit,
    reset: RESET_EPOCH,
  }
  const details = new Map((options.details ?? loadDetails()).map((d) => [d.sha, d]))
  const list = fixtureBody('commits-list.json') as { sha: string }[]
  const branches = fixtureBody('branches.json')

  const calls: Call[] = []
  const pending: Pending[] = []
  const overrides: { match: (c: Call) => boolean; respond: Responder; once: boolean }[] = []
  let inFlight = 0
  let maxInFlight = 0

  const rateHeaders = (): Record<string, string> => ({
    'x-ratelimit-limit': String(limit),
    'x-ratelimit-remaining': String(server.remaining),
    'x-ratelimit-reset': String(server.reset),
    'x-ratelimit-used': String(limit - server.remaining),
    'x-ratelimit-resource': 'core',
  })
  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', ...rateHeaders(), ...extra },
    })

  function route(call: Call): Response {
    if (call.kind === 'rate_limit') {
      const core = {
        limit,
        remaining: server.remaining,
        reset: server.reset,
        used: limit - server.remaining,
      }
      return json({
        resources: { core, search: { limit: 10, remaining: 10, reset: server.reset } },
        rate: core,
      })
    }
    if (server.remaining <= 0) {
      return json({ message: 'API rate limit exceeded for 203.0.113.1.' }, 403)
    }
    server.remaining--
    // consume 後の値をヘッダに載せる
    const h = rateHeaders()
    const ok = (body: unknown, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8', ...h, ...extra },
      })
    if (call.kind === 'branches') return ok(branches)
    if (call.kind === 'list') {
      const perPage = Number(call.url.searchParams.get('per_page') ?? 30)
      return ok(list.slice(0, perPage))
    }
    if (call.kind === 'detail') {
      const sha = decodeURIComponent(call.path.split('/').at(-1)!)
      const d = details.get(sha)
      return d ? ok(d) : json({ message: 'Not Found' }, 404)
    }
    return json({ message: 'Not Found' }, 404)
  }

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    // baseUrl にパス接頭辞(GHE の /api/v3 など)があっても振り分けられるようにする
    const apiPath = /(\/repos\/.*|\/rate_limit)$/.exec(url.pathname)?.[1] ?? url.pathname
    const call: Call = {
      seq: calls.length,
      url,
      path: apiPath,
      kind: kindOf(apiPath),
      init,
      signal: init?.signal ?? undefined,
    }
    calls.push(call)
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    try {
      if (call.signal?.aborted) throw new DOMException('aborted', 'AbortError')

      const i = overrides.findIndex((o) => o.match(call))
      if (i >= 0) {
        const o = overrides[i]!
        if (o.once) overrides.splice(i, 1)
        const r = await o.respond(call)
        if (r) {
          if (call.kind !== 'rate_limit' && server.remaining > 0) server.remaining--
          return r
        }
      }

      if (server.hold && call.kind === 'detail') {
        await new Promise<void>((resolve, reject) => {
          const entry: Pending = { call, release: resolve }
          pending.push(entry)
          call.signal?.addEventListener(
            'abort',
            () => {
              const k = pending.indexOf(entry)
              if (k >= 0) pending.splice(k, 1)
              reject(new DOMException('aborted', 'AbortError'))
            },
            { once: true },
          )
        })
        const k = pending.findIndex((p) => p.call === call)
        if (k >= 0) pending.splice(k, 1)
      }
      return route(call)
    } finally {
      inFlight--
    }
  }) as typeof fetch

  return {
    fetch: fetchImpl,
    server,
    calls,
    pending,
    get inFlight() {
      return inFlight
    },
    get maxInFlight() {
      return maxInFlight
    },
    callsOf: (kind: Call['kind']) => calls.filter((c) => c.kind === kind),
    /** 条件に合うリクエストの応答を差し替える(undefined を返すと通常の応答) */
    override(match: (c: Call) => boolean, respond: Responder, opts: { once?: boolean } = {}) {
      overrides.push({ match, respond, once: opts.once ?? false })
    },
    releaseAll() {
      for (const p of [...pending]) p.release()
    },
    json,
    rateHeaders,
  }
}

export type FakeFetch = ReturnType<typeof createFakeFetch>
