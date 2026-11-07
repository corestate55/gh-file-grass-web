import { describe, expect, test } from 'vitest'
import { AbortedError, HttpError, NotFoundError } from '../src/errors'
import { GitHubClient } from '../src/github-client'
import { RESET_EPOCH, createFakeFetch } from './helpers/fake-fetch'

const ref = { owner: 'corestate55', repo: 'gh-file-grass' }

function setup(opts: Parameters<typeof createFakeFetch>[0] = {}) {
  const fake = createFakeFetch(opts)
  const clock = { t: 1_700_000_000_000 }
  const client = new GitHubClient({ fetch: fake.fetch, now: () => clock.t })
  return { fake, clock, client }
}

describe('GitHubClient: construction', () => {
  test.each([
    [{ concurrency: 0 }],
    [{ concurrency: 1.5 }],
    [{ maxCount: 0 }],
    [{ maxCount: 101 }],
    [{ detailCacheSize: 0 }],
  ])('rejects invalid options %j', (opts) => {
    expect(() => new GitHubClient(opts)).toThrow(RangeError)
  })

  test('baseUrl: trailing slashes are removed', async () => {
    const fake = createFakeFetch()
    const client = new GitHubClient({
      fetch: fake.fetch,
      baseUrl: 'https://ghe.example.test/api/v3//',
    })
    await client.fetchBranches(ref)
    expect(fake.calls[0]!.url.href).toBe(
      'https://ghe.example.test/api/v3/repos/corestate55/gh-file-grass/branches?per_page=100',
    )
  })

  test('works with the global fetch when none is injected (bound, not an illegal invocation)', async () => {
    const original = globalThis.fetch
    const fake = createFakeFetch()
    globalThis.fetch = fake.fetch
    try {
      await new GitHubClient().fetchBranches(ref)
      expect(fake.calls).toHaveLength(1)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('GitHubClient: rate limit', () => {
  test('lastRateLimit is null until something is observed', () => {
    expect(setup().client.lastRateLimit).toBeNull()
  })

  test('responses update lastRateLimit; the getter returns a copy', async () => {
    const { client, clock } = setup()
    await client.fetchBranches(ref)
    const rl = client.lastRateLimit!
    expect(rl).toMatchObject({ limit: 60, remaining: 59 })
    expect(rl.resetAt).toEqual(new Date(RESET_EPOCH * 1000))
    expect(rl.observedAt).toEqual(new Date(clock.t))
    rl.remaining = -1
    rl.resetAt.setFullYear(1999)
    expect(client.lastRateLimit!.remaining).toBe(59)
    expect(client.lastRateLimit!.resetAt.getFullYear()).not.toBe(1999)
  })

  test('fetchRateLimit reads the core values from the body and does not consume the quota', async () => {
    const { client, fake } = setup({ remaining: 42 })
    const rl = await client.fetchRateLimit()
    expect(rl).toMatchObject({ limit: 60, remaining: 42 })
    expect(fake.server.remaining).toBe(42)
    expect(client.lastRateLimit!.remaining).toBe(42)
    await client.fetchRateLimit()
    expect(fake.server.remaining).toBe(42)
  })

  test('fetchRateLimit never raises remaining within the same window (keeps the conservative value)', async () => {
    const { client, fake } = setup()
    await client.fetchBranches(ref) // remaining 59
    fake.server.remaining = 60 // a stale/odd body claiming more
    const rl = await client.fetchRateLimit()
    expect(rl.remaining).toBe(59)
  })

  test('a newer window replaces the old observation', async () => {
    const { client, fake } = setup({ remaining: 1 })
    await client.fetchBranches(ref) // remaining 0
    fake.override(
      (c) => c.kind === 'rate_limit',
      () =>
        fake.json({
          resources: { core: { limit: 60, remaining: 60, reset: RESET_EPOCH + 3600 } },
        }),
    )
    const rl = await client.fetchRateLimit()
    expect(rl.remaining).toBe(60)
  })

  test('falls back to `rate` when `resources` is missing; invalid bodies are HttpError', async () => {
    const { client, fake } = setup()
    fake.override(
      (c) => c.kind === 'rate_limit',
      () => fake.json({ rate: { limit: 60, remaining: 7, reset: RESET_EPOCH } }),
      { once: true },
    )
    expect((await client.fetchRateLimit()).remaining).toBe(7)

    const other = setup()
    other.fake.override(
      (c) => c.kind === 'rate_limit',
      () => other.fake.json({ nope: 1 }),
    )
    await expect(other.client.fetchRateLimit()).rejects.toBeInstanceOf(HttpError)
  })
})

describe('GitHubClient: fetchBranches', () => {
  test('maps the recorded branches API response', async () => {
    const { client, fake } = setup()
    const { branches, hasMore } = await client.fetchBranches(ref)
    expect(hasMore).toBe(false)
    expect(branches.length).toBeGreaterThan(0)
    for (const b of branches) {
      expect(b.name).toEqual(expect.any(String))
      expect(b.headSha).toMatch(/^[0-9a-f]{40}$/)
    }
    expect(branches.map((b) => b.name)).toContain('develop')
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]!.url.searchParams.get('per_page')).toBe('100')
  })

  test('sends only an Accept header', async () => {
    const { client, fake } = setup()
    await client.fetchBranches(ref)
    expect(fake.calls[0]!.init?.headers).toEqual({ Accept: 'application/vnd.github+json' })
  })

  test('cached within the TTL (0 requests), refetched exactly at 5 minutes', async () => {
    const { client, fake, clock } = setup()
    await client.fetchBranches(ref)
    await client.fetchBranches(ref)
    expect(fake.calls).toHaveLength(1)
    clock.t += 299_999
    await client.fetchBranches(ref)
    expect(fake.calls).toHaveLength(1)
    clock.t += 1
    await client.fetchBranches(ref)
    expect(fake.calls).toHaveLength(2)
  })

  test('the cache key ignores the case of owner/repo', async () => {
    const { client, fake } = setup()
    await client.fetchBranches(ref)
    await client.fetchBranches({ owner: 'CoreState55', repo: 'GH-File-Grass' })
    expect(fake.calls).toHaveLength(1)
  })

  test('returned objects are copies: mutating them cannot corrupt the cache', async () => {
    const { client } = setup()
    const first = await client.fetchBranches(ref)
    const name = first.branches[0]!.name
    first.branches[0]!.name = 'hacked'
    first.branches.pop()
    first.hasMore = true
    const second = await client.fetchBranches(ref)
    expect(second.branches[0]!.name).toBe(name)
    expect(second.hasMore).toBe(false)
  })

  test('hasMore when the response has a next link', async () => {
    const { client, fake } = setup()
    fake.override(
      (c) => c.kind === 'branches',
      () =>
        fake.json([{ name: 'main', commit: { sha: 'a'.repeat(40) } }], 200, {
          link: '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=3>; rel="last"',
        }),
    )
    expect(await client.fetchBranches(ref)).toEqual({
      branches: [{ name: 'main', headSha: 'a'.repeat(40) }],
      hasMore: true,
    })
  })

  test('skips malformed entries; a non-array body is an HttpError', async () => {
    const { client, fake } = setup()
    fake.override(
      (c) => c.kind === 'branches',
      () => fake.json([{ name: 'ok', commit: { sha: 'b'.repeat(40) } }, { name: 1 }, null, {}]),
      { once: true },
    )
    expect((await client.fetchBranches(ref)).branches).toEqual([
      { name: 'ok', headSha: 'b'.repeat(40) },
    ])

    const other = setup()
    other.fake.override(
      (c) => c.kind === 'branches',
      () => other.fake.json({ not: 'an array' }),
    )
    await expect(other.client.fetchBranches(ref)).rejects.toBeInstanceOf(HttpError)
  })

  test('encodes owner and repo in the path', async () => {
    const { client, fake } = setup()
    await client.fetchBranches({ owner: 'o', repo: 'r.js' })
    expect(fake.calls[0]!.path).toBe('/repos/o/r.js/branches')
  })

  test('404 -> NotFoundError(repository); nothing is cached for failures', async () => {
    const { client, fake } = setup()
    fake.override(
      (c) => c.kind === 'branches',
      () => fake.json({ message: 'Not Found' }, 404),
      { once: true },
    )
    await expect(client.fetchBranches(ref)).rejects.toBeInstanceOf(NotFoundError)
    await expect(client.fetchBranches(ref)).resolves.toBeDefined()
    expect(fake.calls).toHaveLength(2)
  })

  test('abort -> AbortedError', async () => {
    const { client, fake } = setup()
    const ac = new AbortController()
    ac.abort()
    await expect(client.fetchBranches(ref, { signal: ac.signal })).rejects.toBeInstanceOf(
      AbortedError,
    )
    expect(fake.calls.length).toBeLessThanOrEqual(1)
  })
})
