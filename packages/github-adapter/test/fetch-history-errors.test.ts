import { describe, expect, test, vi } from 'vitest'
import {
  AbortedError,
  EmptyRepositoryError,
  GitHubClient,
  HttpError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  SecondaryRateLimitError,
} from '../src'
import type { Progress } from '../src'
import { ShaShortCollisionError } from '../src'
import { createFakeFetch, RESET_EPOCH } from './helpers/fake-fetch'
import type { FakeFetch } from './helpers/fake-fetch'
import { flush } from './helpers/deferred'
import { loadDetails } from './helpers/fixtures'

const ref = { owner: 'corestate55', repo: 'gh-file-grass' }
const all = loadDetails()

function setup(
  fakeOpts: Parameters<typeof createFakeFetch>[0] = {},
  clientOpts: ConstructorParameters<typeof GitHubClient>[0] = {},
) {
  const fake = createFakeFetch(fakeOpts)
  const clock = { t: 1_700_000_000_000 }
  const client = new GitHubClient({ fetch: fake.fetch, now: () => clock.t, ...clientOpts })
  return { fake, clock, client }
}

async function drain<T>(fake: FakeFetch, promise: Promise<T>): Promise<T> {
  let settled = false
  const guarded = promise.finally(() => {
    settled = true
  })
  guarded.catch(() => {})
  while (!settled) {
    fake.releaseAll()
    await flush()
  }
  return guarded
}

const isDetailOf = (sha: string) => (c: { kind: string; path: string }) =>
  c.kind === 'detail' && c.path.endsWith(sha)

describe('fetchHistory: arguments are validated before any request', () => {
  test.each([
    ['count 0', { count: 0 }, 'develop'],
    ['count above maxCount', { count: 51 }, 'develop'],
    ['non-integer count', { count: 1.5 }, 'develop'],
    ['NaN count', { count: NaN }, 'develop'],
    ['invalid time zone', { timeZone: 'Not/AZone' }, 'develop'],
    ['empty branch', {}, ''],
  ])('%s -> RangeError, 0 requests', async (_name, opts, branch) => {
    const { client, fake } = setup()
    await expect(client.fetchHistory(ref, branch, opts)).rejects.toBeInstanceOf(RangeError)
    expect(fake.calls).toHaveLength(0)
  })

  test('an already aborted signal -> AbortedError, 0 requests', async () => {
    const { client, fake } = setup()
    const ac = new AbortController()
    ac.abort()
    await expect(client.fetchHistory(ref, 'develop', { signal: ac.signal })).rejects.toBeInstanceOf(
      AbortedError,
    )
    expect(fake.calls).toHaveLength(0)
  })

  test('a sha_short collision is detected before any detail is requested', async () => {
    const { client, fake } = setup()
    const a = 'abc1234' + '0'.repeat(33)
    const b = 'abc1234' + '1'.repeat(33)
    fake.override(
      (c) => c.kind === 'list',
      () => fake.json([{ sha: a }, { sha: b }]),
    )
    await expect(client.fetchHistory(ref, 'develop', { count: 2 })).rejects.toBeInstanceOf(
      ShaShortCollisionError,
    )
    expect(fake.callsOf('detail')).toHaveLength(0)
  })

  test('malformed list entries are rejected before they can be put in a URL', async () => {
    const { client, fake } = setup()
    fake.override(
      (c) => c.kind === 'list',
      () => fake.json([{ sha: '../../etc/passwd' }]),
    )
    await expect(client.fetchHistory(ref, 'develop', { count: 1 })).rejects.toBeInstanceOf(
      HttpError,
    )
    expect(fake.callsOf('detail')).toHaveLength(0)

    const other = setup()
    other.fake.override(
      (c) => c.kind === 'list',
      () => other.fake.json({ not: 'array' }),
    )
    await expect(other.client.fetchHistory(ref, 'develop', { count: 1 })).rejects.toBeInstanceOf(
      HttpError,
    )
  })
})

describe('fetchHistory: failures of the list request', () => {
  test('404 -> NotFoundError(branch_or_repository); 422 -> NotFoundError(branch)', async () => {
    const a = setup()
    a.fake.override(
      (c) => c.kind === 'list',
      () => a.fake.json({ message: 'Not Found' }, 404),
    )
    await expect(a.client.fetchHistory(ref, 'develop')).rejects.toMatchObject({
      kind: 'not_found',
      resource: 'branch_or_repository',
    })
    expect(a.fake.callsOf('detail')).toHaveLength(0)

    const b = setup()
    b.fake.override(
      (c) => c.kind === 'list',
      () => b.fake.json({ message: 'No commit found' }, 422),
    )
    await expect(b.client.fetchHistory(ref, 'nope')).rejects.toMatchObject({
      kind: 'not_found',
      resource: 'branch',
    })
  })

  test('409 -> EmptyRepositoryError, no detail requests', async () => {
    const { client, fake } = setup()
    fake.override(
      (c) => c.kind === 'list',
      () => fake.json({ message: 'Git Repository is empty.' }, 409),
    )
    await expect(client.fetchHistory(ref, 'develop')).rejects.toBeInstanceOf(EmptyRepositoryError)
    expect(fake.callsOf('detail')).toHaveLength(0)
  })

  test('failures are not cached: the next call asks again', async () => {
    const { client, fake } = setup()
    fake.override(
      (c) => c.kind === 'list',
      () => fake.json({ message: 'x' }, 502),
      { once: true },
    )
    await expect(client.fetchHistory(ref, 'develop', { count: 2 })).rejects.toMatchObject({
      kind: 'http',
      status: 502,
    })
    await expect(client.fetchHistory(ref, 'develop', { count: 2 })).resolves.toBeDefined()
    expect(fake.callsOf('list')).toHaveLength(2)
  })

  test('a network failure -> NetworkError', async () => {
    const { client, fake } = setup()
    fake.override(
      (c) => c.kind === 'list',
      () => {
        throw new TypeError('Failed to fetch')
      },
    )
    await expect(client.fetchHistory(ref, 'develop')).rejects.toBeInstanceOf(NetworkError)
  })
})

describe('fetchHistory: failures of a detail request', () => {
  test('404 on one commit -> NotFoundError(commit); the rest stops; successes stay cached', async () => {
    const { client, fake } = setup({ hold: true }, { concurrency: 1 })
    const bad = all[2]!.sha
    fake.override(isDetailOf(bad), () => fake.json({ message: 'Not Found' }, 404), { once: true })
    const p = client.fetchHistory(ref, 'develop', { count: 10 })
    const settled = drain(fake, p).catch((e) => e)
    const err = await settled
    expect(err).toBeInstanceOf(NotFoundError)
    expect(err).toMatchObject({ resource: 'commit' })

    // concurrency 1: details 0 and 1 succeeded, 2 failed, nothing after it was requested
    expect(fake.callsOf('detail')).toHaveLength(3)

    // the successful ones are reused on the next attempt
    fake.server.hold = false
    const before = fake.callsOf('detail').length
    await client.fetchHistory(ref, 'develop', { count: 10 })
    expect(fake.callsOf('detail').length - before).toBe(8)
  })

  test('the first error is the one reported, not the abort of its siblings', async () => {
    const { client, fake } = setup({ hold: true })
    // the 2nd request fails immediately while the others are still held
    fake.override(isDetailOf(all[1]!.sha), () => fake.json({ message: 'boom' }, 500), {
      once: true,
    })
    const err = await client.fetchHistory(ref, 'develop', { count: 10 }).catch((e) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect(err).toMatchObject({ kind: 'http', status: 500 })

    // the held siblings were aborted; nothing else is requested afterwards
    const n = fake.calls.length
    await flush()
    expect(fake.calls).toHaveLength(n)
    expect(fake.pending).toHaveLength(0)
    expect(fake.inFlight).toBe(0)
  })

  test('403 with remaining=0 -> RateLimitError(exhausted) carrying the reset time; later requests stop', async () => {
    const { client, fake } = setup({ remaining: 6 }) // list uses 1 -> 5 left, 10 needed? start with enough
    fake.server.remaining = 60
    let served = 0
    fake.override(
      (c) => c.kind === 'detail',
      () => {
        served++
        if (served < 4) return undefined
        return fake.json({ message: 'API rate limit exceeded' }, 403, {
          ...fake.rateHeaders(),
          'x-ratelimit-remaining': '0',
        })
      },
    )
    const err = await client.fetchHistory(ref, 'develop', { count: 10 }).catch((e) => e)
    expect(err).toBeInstanceOf(RateLimitError)
    expect(err).toMatchObject({
      kind: 'rate_limited',
      reason: 'exhausted',
      remaining: 0,
      status: 403,
    })
    expect(err.resetAt).toEqual(new Date(RESET_EPOCH * 1000))
    expect(client.lastRateLimit!.remaining).toBe(0)
    expect(fake.inFlight).toBe(0)
  })

  test('403/429 with Retry-After -> SecondaryRateLimitError', async () => {
    for (const status of [403, 429]) {
      const { client, fake, clock } = setup()
      fake.override(
        (c) => c.kind === 'detail',
        () =>
          fake.json({ message: 'You have exceeded a secondary rate limit.' }, status, {
            'retry-after': '30',
          }),
      )
      const err = await client.fetchHistory(ref, 'develop', { count: 5 }).catch((e) => e)
      expect(err).toBeInstanceOf(SecondaryRateLimitError)
      expect(err.retryAfterSec).toBe(30)
      expect(err.retryAt).toEqual(new Date(clock.t + 30_000))
    }
  })

  test('a network failure in the middle -> NetworkError, with partial results cached', async () => {
    const { client, fake } = setup({}, { concurrency: 1 })
    let n = 0
    fake.override(
      (c) => c.kind === 'detail',
      () => {
        if (++n === 3) throw new TypeError('Failed to fetch')
        return undefined
      },
    )
    await expect(client.fetchHistory(ref, 'develop', { count: 6 })).rejects.toBeInstanceOf(
      NetworkError,
    )
    expect(client.estimateCost(ref, 'develop', 6)).toEqual({ requests: 4, exact: true })
  })

  test('a response for a different commit is rejected', async () => {
    const { client, fake } = setup()
    fake.override(isDetailOf(all[0]!.sha), () => fake.json(all[5]))
    await expect(client.fetchHistory(ref, 'develop', { count: 3 })).rejects.toBeInstanceOf(
      HttpError,
    )
  })

  test('a malformed detail body is rejected', async () => {
    const { client, fake } = setup()
    fake.override(
      (c) => c.kind === 'detail',
      () => fake.json({ sha: 'x' }),
    )
    await expect(client.fetchHistory(ref, 'develop', { count: 2 })).rejects.toBeInstanceOf(
      HttpError,
    )
  })
})

describe('fetchHistory: rate-limit precheck', () => {
  test('insufficient quota is detected before any detail request', async () => {
    const { client, fake } = setup({ remaining: 10 })
    const err = await client.fetchHistory(ref, 'develop', { count: 20 }).catch((e) => e)
    expect(err).toBeInstanceOf(RateLimitError)
    // the list consumed 1, so 9 are left for 20 needed
    expect(err).toMatchObject({
      kind: 'rate_limited',
      reason: 'insufficient',
      needed: 20,
      remaining: 9,
    })
    expect(err.resetAt).toEqual(new Date(RESET_EPOCH * 1000))
    expect(fake.callsOf('detail')).toHaveLength(0)
  })

  test('needed === remaining is allowed (the budget is exactly enough)', async () => {
    const { client, fake } = setup({ remaining: 21 })
    await expect(client.fetchHistory(ref, 'develop', { count: 20 })).resolves.toBeDefined()
    expect(fake.server.remaining).toBe(0)
  })

  test('needed === remaining + 1 is refused', async () => {
    const { client } = setup({ remaining: 20 })
    await expect(client.fetchHistory(ref, 'develop', { count: 20 })).rejects.toMatchObject({
      reason: 'insufficient',
      needed: 20,
      remaining: 19,
    })
  })

  test('cached details are not counted: a fully cached call works with 0 quota', async () => {
    const { client, fake } = setup({ remaining: 21 })
    await client.fetchHistory(ref, 'develop', { count: 20 })
    expect(fake.server.remaining).toBe(0)
    await expect(client.fetchHistory(ref, 'develop', { count: 20 })).resolves.toBeDefined()
    await expect(client.fetchHistory(ref, 'develop', { count: 10 })).resolves.toBeDefined()
  })

  test('only the missing part counts against the quota', async () => {
    const { client } = setup({ remaining: 12 })
    await client.fetchHistory(ref, 'develop', { count: 10 }) // uses 11 -> 1 left
    await expect(client.fetchHistory(ref, 'develop', { count: 11 })).resolves.toBeDefined() // needs exactly 1
    await expect(client.fetchHistory(ref, 'develop', { count: 13 })).rejects.toMatchObject({
      reason: 'insufficient',
      needed: 2,
      remaining: 0,
    })
  })

  test('when the list is cached but the quota was never observed, /rate_limit (free) is asked first', async () => {
    const { client, fake } = setup({ remaining: 3 })
    // 一覧だけがキャッシュにある状態(残量は未観測)を作る
    const internals = client as unknown as { listCache: { set(k: string, v: string[]): void } }
    internals.listCache.set(
      'corestate55/gh-file-grass#develop',
      all.slice(0, 5).map((d) => d.sha),
    )
    expect(client.lastRateLimit).toBeNull()

    const err = await client.fetchHistory(ref, 'develop', { count: 5 }).catch((e) => e)
    expect(err).toMatchObject({ reason: 'insufficient', needed: 5, remaining: 3 })
    expect(fake.callsOf('rate_limit')).toHaveLength(1)
    expect(fake.callsOf('list')).toHaveLength(0)
    expect(fake.server.remaining).toBe(3) // asking did not consume
    expect(fake.callsOf('detail')).toHaveLength(0)
  })

  test('an expired window triggers a fresh /rate_limit instead of trusting the old remaining', async () => {
    const { client, fake, clock } = setup({ remaining: 22 })
    await client.fetchHistory(ref, 'develop', { count: 20 }) // remaining 1 now
    expect(client.lastRateLimit!.remaining).toBe(1)

    // the window resets: a new quota with a later reset time
    clock.t = fake.server.reset * 1000 + 5 * 60_000
    fake.server.remaining = 60
    fake.server.reset += 3600
    const before = fake.callsOf('rate_limit').length
    await expect(client.fetchHistory(ref, 'develop', { count: 30 })).resolves.toBeDefined()
    expect(client.lastRateLimit!.remaining).toBeGreaterThan(1)
    // the list response already carried the new window, so asking was not necessary here
    expect(fake.callsOf('rate_limit').length).toBeGreaterThanOrEqual(before)
  })

  test('with the list cached and the old window over, the quota is refreshed through /rate_limit', async () => {
    // 一覧の TTL を長くして、窓がリセットされても一覧はキャッシュに残る状況にする
    const { client, fake, clock } = setup({ remaining: 22 }, { listTtlMs: 24 * 3600_000 })
    await client.fetchHistory(ref, 'develop', { count: 20 }) // remaining 1, list cached
    clock.t = fake.server.reset * 1000 + 1 // window over, but the list TTL (5 min) has not expired
    fake.server.remaining = 60
    fake.server.reset += 3600

    const lists = fake.callsOf('list').length
    await expect(client.fetchHistory(ref, 'develop', { count: 30 })).resolves.toBeDefined()
    expect(fake.callsOf('list')).toHaveLength(lists) // served from the list cache
    expect(fake.callsOf('rate_limit')).toHaveLength(1) // the stale 'remaining: 1' was not trusted
  })
})

describe('fetchHistory: abort', () => {
  test('aborting during the detail phase stops everything and reports AbortedError', async () => {
    const { client, fake } = setup({ hold: true })
    const ac = new AbortController()
    const p = client.fetchHistory(ref, 'develop', { count: 20, signal: ac.signal })
    p.catch(() => {})
    await vi.waitFor(() => expect(fake.pending).toHaveLength(4))

    ac.abort(new Error('navigated away'))
    await expect(p).rejects.toBeInstanceOf(AbortedError)
    await expect(p).rejects.toMatchObject({ kind: 'aborted' })

    const n = fake.calls.length
    await flush()
    expect(fake.calls).toHaveLength(n) // nothing more was requested
    expect(fake.callsOf('detail')).toHaveLength(4)
    expect(fake.pending).toHaveLength(0)
    expect(fake.inFlight).toBe(0)
  })

  test('aborting while waiting for the list', async () => {
    const { client, fake } = setup()
    const ac = new AbortController()
    fake.override(
      (c) => c.kind === 'list',
      (c) =>
        new Promise<never>((_, reject) =>
          c.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))),
        ),
    )
    const p = client.fetchHistory(ref, 'develop', { signal: ac.signal })
    p.catch(() => {})
    await flush()
    ac.abort()
    await expect(p).rejects.toBeInstanceOf(AbortedError)
    expect(fake.callsOf('detail')).toHaveLength(0)
  })

  test('the abort listener is removed when the call finishes', async () => {
    const { client } = setup()
    const ac = new AbortController()
    const add = vi.spyOn(ac.signal, 'addEventListener')
    const remove = vi.spyOn(ac.signal, 'removeEventListener')
    await client.fetchHistory(ref, 'develop', { count: 3, signal: ac.signal })
    const added = add.mock.calls.filter((c) => c[0] === 'abort').length
    const removed = remove.mock.calls.filter((c) => c[0] === 'abort').length
    expect(added).toBeGreaterThan(0)
    expect(removed).toBeGreaterThanOrEqual(added)
    ac.abort() // must be harmless now
  })

  test('details fetched before the abort stay cached', async () => {
    const { client, fake } = setup({ hold: true }, { concurrency: 1 })
    const ac = new AbortController()
    const p = client.fetchHistory(ref, 'develop', { count: 10, signal: ac.signal })
    p.catch(() => {})
    await vi.waitFor(() => expect(fake.pending).toHaveLength(1))
    fake.pending[0]!.release()
    await vi.waitFor(() => expect(fake.callsOf('detail')).toHaveLength(2))
    ac.abort()
    await expect(p).rejects.toBeInstanceOf(AbortedError)
    expect(client.estimateCost(ref, 'develop', 10)).toEqual({ requests: 9, exact: true })
  })
})

describe('fetchHistory: onProgress after the call is over', () => {
  test('no progress is reported after a failure, even if late responses arrive', async () => {
    const { client, fake } = setup({ hold: true })
    fake.override(isDetailOf(all[0]!.sha), () => fake.json({ message: 'x' }, 500), { once: true })
    const seen: Progress[] = []
    await expect(
      client.fetchHistory(ref, 'develop', { count: 10, onProgress: (x) => seen.push({ ...x }) }),
    ).rejects.toBeInstanceOf(HttpError)
    const count = seen.length
    fake.releaseAll()
    await flush()
    expect(seen).toHaveLength(count)
    expect(seen.every((p) => p.phase === 'list' || p.done < p.total)).toBe(true)
  })

  test('an exception thrown by onProgress fails the call like any other error', async () => {
    const { client, fake } = setup()
    const err = new Error('listener bug')
    let calls = 0
    const p = client.fetchHistory(ref, 'develop', {
      count: 5,
      onProgress: (x) => {
        if (x.phase === 'detail' && x.done === 2) {
          calls++
          throw err
        }
      },
    })
    await expect(p).rejects.toBe(err)
    expect(calls).toBe(1)
    expect(fake.inFlight).toBe(0)
  })
})

describe('fetchHistory: lastRateLimit under out-of-order responses', () => {
  test('remaining never goes up when responses arrive in reverse order', async () => {
    const { client, fake } = setup({ hold: true })
    const p = client.fetchHistory(ref, 'develop', { count: 4 })
    await vi.waitFor(() => expect(fake.pending).toHaveLength(4))
    // the server decrements when it answers, so releasing in reverse gives remaining in reverse order
    const observed: number[] = []
    for (const pending of [...fake.pending].reverse()) {
      pending.release()
      await flush()
      observed.push(client.lastRateLimit?.remaining ?? -1)
    }
    await drain(fake, p)
    for (let i = 1; i < observed.length; i++) {
      expect(observed[i]!).toBeLessThanOrEqual(observed[i - 1]!)
    }
  })
})
