import { describe, expect, test, vi } from 'vitest'
import { AbortedError, HttpError, NetworkError, NotFoundError, RateLimitError } from '../src/errors'
import { requestJson } from '../src/http'
import type { Operation } from '../src/http'

const NOW = 1_700_000_000_000
const RATE = {
  'x-ratelimit-limit': '60',
  'x-ratelimit-remaining': '59',
  'x-ratelimit-reset': '1700003600',
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

function run(
  fetchImpl: typeof fetch,
  over: Partial<Parameters<typeof requestJson>[0]> = {},
  op: Operation = 'detail',
) {
  return requestJson({
    fetch: fetchImpl,
    baseUrl: 'https://api.example.test',
    path: '/repos/o/r/commits',
    op,
    now: () => NOW,
    ...over,
  })
}

describe('requestJson', () => {
  test('sends only a CORS-safelisted Accept header (no preflight, unauthenticated)', async () => {
    const fetchImpl = vi.fn(async () => json([]))
    await run(fetchImpl as unknown as typeof fetch)
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toEqual({ Accept: 'application/vnd.github+json' })
    expect(init.method).toBeUndefined() // GET
    expect(init.credentials).toBeUndefined()
    expect(init.cache).toBeUndefined()
  })

  test('builds the URL from baseUrl, path and query (branch names are encoded)', async () => {
    const fetchImpl = vi.fn<(url: string) => Promise<Response>>(async () => json([]))
    await run(fetchImpl as unknown as typeof fetch, {
      query: { sha: 'dependabot/npm_and_yarn/x y', per_page: 50 },
    })
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://api.example.test/repos/o/r/commits?sha=dependabot%2Fnpm_and_yarn%2Fx+y&per_page=50',
    )
  })

  test('returns the body, headers and parsed rate limit; reports it through onRateLimit', async () => {
    const onRateLimit = vi.fn()
    const res = await run(
      async () => json({ ok: true }, 200, { ...RATE, link: '<x>; rel="next"' }),
      {
        onRateLimit,
      },
    )
    expect(res.body).toEqual({ ok: true })
    expect(res.headers.get('link')).toBe('<x>; rel="next"')
    expect(res.rateLimit).toMatchObject({ limit: 60, remaining: 59 })
    expect(onRateLimit).toHaveBeenCalledTimes(1)
  })

  test('rate limit headers on a failed response are still reported', async () => {
    const onRateLimit = vi.fn()
    const p = run(
      async () => json({ message: 'rate limit' }, 403, { ...RATE, 'x-ratelimit-remaining': '0' }),
      { onRateLimit },
    )
    await expect(p).rejects.toBeInstanceOf(RateLimitError)
    expect(onRateLimit).toHaveBeenCalledWith(expect.objectContaining({ remaining: 0 }))
  })

  test('the operation decides how a 404 is classified', async () => {
    const notFound = async () => json({ message: 'Not Found' }, 404)
    await expect(run(notFound, {}, 'branches')).rejects.toMatchObject({ resource: 'repository' })
    await expect(run(notFound, {}, 'list')).rejects.toMatchObject({
      resource: 'branch_or_repository',
    })
    await expect(run(notFound, {}, 'detail')).rejects.toBeInstanceOf(NotFoundError)
  })

  test('an error response with a non-JSON body is still classified by its status', async () => {
    const p = run(async () => new Response('<html>Bad Gateway</html>', { status: 502 }))
    await expect(p).rejects.toMatchObject({ kind: 'http', status: 502 })
  })

  test('a successful response that is not JSON -> HttpError(invalid response)', async () => {
    const p = run(async () => new Response('not json', { status: 200 }))
    await expect(p).rejects.toBeInstanceOf(HttpError)
    await expect(p).rejects.toMatchObject({ status: 200 })
  })

  test('fetch rejecting (offline / CORS) -> NetworkError with the cause', async () => {
    const cause = new TypeError('Failed to fetch')
    const p = run(async () => {
      throw cause
    })
    await expect(p).rejects.toBeInstanceOf(NetworkError)
    await expect(p).rejects.toMatchObject({ kind: 'network', cause })
  })

  test('abort -> AbortedError carrying the signal reason (not NetworkError)', async () => {
    const ac = new AbortController()
    const reason = new Error('user navigated away')
    const fetchImpl = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))
      })) as unknown as typeof fetch
    const p = run(fetchImpl, { signal: ac.signal })
    ac.abort(reason)
    await expect(p).rejects.toBeInstanceOf(AbortedError)
    await expect(p).rejects.toMatchObject({ kind: 'aborted', cause: reason })
  })

  test('abort while reading the body -> AbortedError', async () => {
    const ac = new AbortController()
    const res = json({ a: 1 })
    vi.spyOn(res, 'json').mockImplementation(async () => {
      ac.abort('stop')
      throw new DOMException('x', 'AbortError')
    })
    await expect(run(async () => res, { signal: ac.signal })).rejects.toBeInstanceOf(AbortedError)
  })

  test('a fetch failure that is not an abort stays a NetworkError even with a live signal', async () => {
    const ac = new AbortController()
    await expect(
      run(
        async () => {
          throw new TypeError('boom')
        },
        { signal: ac.signal },
      ),
    ).rejects.toBeInstanceOf(NetworkError)
  })
})
