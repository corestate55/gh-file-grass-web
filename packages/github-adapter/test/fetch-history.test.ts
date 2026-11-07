import { assertInvariants } from '@gh-file-grass/core/schema'
import { describe, expect, test, vi } from 'vitest'
import { GitHubClient, toGitLogData } from '../src'
import type { Progress } from '../src'
import { createFakeFetch } from './helpers/fake-fetch'
import type { FakeFetch } from './helpers/fake-fetch'
import { flush } from './helpers/deferred'
import { loadDetails } from './helpers/fixtures'

const ref = { owner: 'corestate55', repo: 'gh-file-grass' }
const TZ = 'Asia/Tokyo'
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

/** 保留中のリクエストを放しながら、promise が決着するまで回す */
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

const detailShas = (fake: FakeFetch) => fake.callsOf('detail').map((c) => c.path.split('/').at(-1))

describe('fetchHistory: request budget', () => {
  test('N + 1 requests: one list (per_page = maxCount, sha = branch) and N distinct details', async () => {
    const { client, fake } = setup()
    const result = await client.fetchHistory(ref, 'develop', { count: 20, timeZone: TZ })

    expect(fake.calls).toHaveLength(21)
    const list = fake.callsOf('list')
    expect(list).toHaveLength(1)
    expect(fake.calls[0]).toBe(list[0])
    expect(list[0]!.url.searchParams.get('sha')).toBe('develop')
    expect(list[0]!.url.searchParams.get('per_page')).toBe('50')

    expect(new Set(detailShas(fake))).toEqual(new Set(all.slice(0, 20).map((d) => d.sha)))
    expect(detailShas(fake)).toHaveLength(20)
    expect(result.data.commits).toHaveLength(20)
  })

  test('only an Accept header is sent on every request', async () => {
    const { client, fake } = setup()
    await client.fetchHistory(ref, 'develop', { count: 3 })
    for (const c of fake.calls)
      expect(c.init?.headers).toEqual({ Accept: 'application/vnd.github+json' })
  })

  test('branch names with "/" and spaces are encoded in the query', async () => {
    const { client, fake } = setup()
    await client.fetchHistory(ref, 'feature/x y', { count: 1 })
    expect(fake.callsOf('list')[0]!.url.search).toBe('?sha=feature%2Fx+y&per_page=50')
  })

  test('default count is 20', async () => {
    const { client, fake } = setup()
    const { data } = await client.fetchHistory(ref, 'develop')
    expect(data.commits).toHaveLength(20)
    expect(fake.calls).toHaveLength(21)
  })

  test('rateLimit in the result is the latest observation', async () => {
    const { client } = setup()
    const result = await client.fetchHistory(ref, 'develop', { count: 20 })
    expect(result.rateLimit).toMatchObject({ limit: 60, remaining: 39 })
    expect(result.rateLimit).toEqual(client.lastRateLimit)
  })

  test('a history shorter than count uses what exists; an empty one makes no detail requests', async () => {
    const { client, fake } = setup()
    fake.override(
      (c) => c.kind === 'list',
      () => fake.json(all.slice(0, 3).map((d) => ({ sha: d.sha }))),
      { once: true },
    )
    const short = await client.fetchHistory(ref, 'develop', { count: 20 })
    expect(short.data.commits).toHaveLength(3)
    expect(fake.callsOf('detail')).toHaveLength(3)

    const other = setup()
    other.fake.override(
      (c) => c.kind === 'list',
      () => other.fake.json([]),
    )
    const empty = await other.client.fetchHistory(ref, 'develop', { count: 20 })
    expect(empty.data.commits).toEqual([])
    expect(other.fake.callsOf('detail')).toHaveLength(0)
    expect(() => assertInvariants(empty.data)).not.toThrow()
  })
})

describe('fetchHistory: concurrency', () => {
  test('never more than 4 detail requests in flight; a slot frees one more', async () => {
    const { client, fake } = setup({ hold: true })
    const p = client.fetchHistory(ref, 'develop', { count: 20 })
    await vi.waitFor(() => expect(fake.pending).toHaveLength(4))
    await flush()
    expect(fake.callsOf('detail')).toHaveLength(4)

    fake.pending[0]!.release()
    await vi.waitFor(() => expect(fake.callsOf('detail')).toHaveLength(5))
    await flush()
    expect(fake.callsOf('detail')).toHaveLength(5)

    await drain(fake, p)
    expect(fake.maxInFlight).toBe(4)
  })

  test('concurrency option', async () => {
    const { client, fake } = setup({ hold: true }, { concurrency: 2 })
    const p = client.fetchHistory(ref, 'develop', { count: 10 })
    await vi.waitFor(() => expect(fake.pending).toHaveLength(2))
    await flush()
    expect(fake.callsOf('detail')).toHaveLength(2)
    await drain(fake, p)
    expect(fake.maxInFlight).toBe(2)
  })

  test('the limit is per client, not per call: overlapping calls still stay within 4', async () => {
    const { client, fake } = setup({ hold: true })
    const a = client.fetchHistory(ref, 'develop', { count: 10 })
    const b = client.fetchHistory(ref, 'main', { count: 10 })
    await vi.waitFor(() => expect(fake.pending).toHaveLength(4))
    await flush()
    expect(fake.callsOf('detail')).toHaveLength(4)
    await Promise.all([drain(fake, a), drain(fake, b)])
    expect(fake.maxInFlight).toBe(4)
  })
})

describe('fetchHistory: cache', () => {
  test('within the list TTL a repeated call makes no request at all', async () => {
    const { client, fake } = setup()
    const first = await client.fetchHistory(ref, 'develop', { count: 20, timeZone: TZ })
    const n = fake.calls.length
    const second = await client.fetchHistory(ref, 'develop', { count: 20, timeZone: TZ })
    expect(fake.calls).toHaveLength(n)
    expect(second.data).toEqual(first.data)
  })

  test('after the TTL only the list is requested again (details stay cached)', async () => {
    const { client, fake, clock } = setup()
    await client.fetchHistory(ref, 'develop', { count: 20 })
    clock.t += 5 * 60_000 - 1
    await client.fetchHistory(ref, 'develop', { count: 20 })
    expect(fake.calls).toHaveLength(21)
    clock.t += 1
    await client.fetchHistory(ref, 'develop', { count: 20 })
    expect(fake.calls).toHaveLength(22)
    expect(fake.callsOf('list')).toHaveLength(2)
  })

  test('a smaller count reuses everything; a larger one fetches only the difference', async () => {
    const { client, fake } = setup()
    await client.fetchHistory(ref, 'develop', { count: 20 })
    await client.fetchHistory(ref, 'develop', { count: 10 })
    expect(fake.calls).toHaveLength(21)
    await client.fetchHistory(ref, 'develop', { count: 30 })
    expect(fake.calls).toHaveLength(31)
    expect(fake.callsOf('list')).toHaveLength(1)
  })

  test('the cache key ignores the case of owner/repo but not of the branch', async () => {
    const { client, fake } = setup()
    await client.fetchHistory(ref, 'develop', { count: 5 })
    const n = fake.calls.length
    await client.fetchHistory({ owner: 'CORESTATE55', repo: 'GH-FILE-GRASS' }, 'develop', {
      count: 5,
    })
    expect(fake.calls).toHaveLength(n)
    await client.fetchHistory(ref, 'Develop', { count: 5 })
    expect(fake.callsOf('list')).toHaveLength(2)
  })

  test('the result is a fresh object each time: mutating it cannot corrupt the cache', async () => {
    const { client } = setup()
    const first = await client.fetchHistory(ref, 'develop', { count: 10, timeZone: TZ })
    const snapshot = structuredClone(first.data)
    first.data.commits[0]!.message = 'hacked'
    first.data.stats[0]!.path = 'hacked'
    first.data.files.pop()
    const second = await client.fetchHistory(ref, 'develop', { count: 10, timeZone: TZ })
    expect(second.data).toEqual(snapshot)
  })

  test('LRU: with a tiny detail cache the result is still complete, and evicted details are refetched', async () => {
    const { client, fake } = setup({}, { detailCacheSize: 3 })
    const first = await client.fetchHistory(ref, 'develop', { count: 5, timeZone: TZ })
    expect(first.data.commits).toHaveLength(5)
    expect(fake.callsOf('detail')).toHaveLength(5)
    await client.fetchHistory(ref, 'develop', { count: 5, timeZone: TZ })
    // only 3 of the 5 are still cached
    expect(fake.callsOf('detail')).toHaveLength(7)
  })

  test('estimateCost: upper bound before the list is known, exact afterwards', async () => {
    const { client } = setup()
    expect(client.estimateCost(ref, 'develop', 20)).toEqual({ requests: 21, exact: false })
    await client.fetchHistory(ref, 'develop', { count: 10 })
    expect(client.estimateCost(ref, 'develop', 10)).toEqual({ requests: 0, exact: true })
    expect(client.estimateCost(ref, 'develop', 25)).toEqual({ requests: 15, exact: true })
    expect(() => client.estimateCost(ref, 'develop', 0)).toThrow(RangeError)
  })
})

describe('fetchHistory: truncated commits (files split over several pages)', () => {
  const NEXT =
    '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=10>; rel="last"'

  test('reports a truncated warning, also when served from the cache, and never asks for page 2', async () => {
    const { client, fake } = setup()
    const target = all[3]!
    fake.override(
      (c) => c.kind === 'detail' && c.path.endsWith(target.sha),
      () => fake.json(target, 200, { link: NEXT, ...fake.rateHeaders() }),
      { once: true },
    )
    const first = await client.fetchHistory(ref, 'develop', { count: 10, timeZone: TZ })
    expect(first.warnings.filter((w) => w.kind === 'truncated')).toEqual([
      { kind: 'truncated', sha: target.sha },
    ])

    const before = fake.calls.length
    const second = await client.fetchHistory(ref, 'develop', { count: 10, timeZone: TZ })
    expect(fake.calls).toHaveLength(before)
    expect(second.warnings.filter((w) => w.kind === 'truncated')).toEqual([
      { kind: 'truncated', sha: target.sha },
    ])
    expect(fake.calls.every((c) => !c.url.searchParams.has('page'))).toBe(true)
  })

  test('a plain response (no Link) is not truncated', async () => {
    const { client } = setup()
    const { warnings } = await client.fetchHistory(ref, 'develop', { count: 10 })
    expect(warnings.some((w) => w.kind === 'truncated')).toBe(false)
  })
})

describe('fetchHistory: onProgress', () => {
  test('list 0/1, list 1/1, then detail 0/n … n/n with a constant total', async () => {
    const { client } = setup()
    const seen: Progress[] = []
    await client.fetchHistory(ref, 'develop', { count: 6, onProgress: (p) => seen.push({ ...p }) })
    expect(seen).toEqual([
      { phase: 'list', done: 0, total: 1 },
      { phase: 'list', done: 1, total: 1 },
      ...[0, 1, 2, 3, 4, 5, 6].map((done) => ({ phase: 'detail' as const, done, total: 6 })),
    ])
  })

  test('cached details count as done from the start', async () => {
    const { client } = setup()
    await client.fetchHistory(ref, 'develop', { count: 4 })
    const seen: Progress[] = []
    await client.fetchHistory(ref, 'develop', { count: 6, onProgress: (p) => seen.push({ ...p }) })
    const details = seen.filter((p) => p.phase === 'detail')
    expect(details[0]).toEqual({ phase: 'detail', done: 4, total: 6 })
    expect(details.at(-1)).toEqual({ phase: 'detail', done: 6, total: 6 })
    expect(details.map((p) => p.done)).toEqual([4, 5, 6])
  })
})

describe('fetchHistory: integration with the recorded fixtures', () => {
  test.each([20, 50, 64])(
    'newest %i commits equal toGitLogData of the recorded responses',
    async (k) => {
      const { client } = setup({ limit: 5000 }, { maxCount: 100 })
      const result = await client.fetchHistory(ref, 'develop', { count: k, timeZone: TZ })
      const expected = toGitLogData({
        ref,
        branch: 'develop',
        commits: loadDetails(k),
        timeZone: TZ,
      })
      expect(result.data).toEqual(expected.data)
      expect(result.warnings).toEqual(expected.warnings)
      expect(() => assertInvariants(result.data)).not.toThrow()
    },
  )

  test('the whole history has no warnings', async () => {
    const { client } = setup({ limit: 5000 }, { maxCount: 100 })
    const { data, warnings } = await client.fetchHistory(ref, 'develop', {
      count: 64,
      timeZone: TZ,
    })
    expect(warnings).toEqual([])
    expect(data.commits).toHaveLength(64)
    expect(data.stats).toHaveLength(221)
  })
})
