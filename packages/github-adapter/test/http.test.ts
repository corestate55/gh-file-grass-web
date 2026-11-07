import { describe, expect, test } from 'vitest'
import {
  EmptyRepositoryError,
  HttpError,
  NotFoundError,
  RateLimitError,
  SecondaryRateLimitError,
} from '../src/errors'
import {
  classifyErrorResponse,
  hasNextLink,
  mergeRateLimit,
  parseRateLimitHeaders,
  parseRetryAfter,
} from '../src/http'
import type { RateLimitInfo } from '../src/types'

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0)
const h = (init: Record<string, string> = {}) => new Headers(init)
const rl = (remaining: number, resetSec: number, limit = 60): RateLimitInfo => ({
  limit,
  remaining,
  resetAt: new Date(resetSec * 1000),
  observedAt: new Date(NOW),
})

describe('hasNextLink', () => {
  test.each([
    [null, false],
    [undefined, false],
    ['', false],
    ['<https://api.github.com/x?page=1>; rel="prev"', false],
    [
      '<https://api.github.com/x?page=1>; rel="prev", <https://api.github.com/x?page=9>; rel="last"',
      false,
    ],
    ['<https://api.github.com/x?page=2>; rel="next"', true],
    [
      '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=9>; rel="last"',
      true,
    ],
    [
      '<https://api.github.com/x?page=1>; rel="prev", <https://api.github.com/x?page=3>; rel="next"',
      true,
    ],
    ['<https://api.github.com/x?page=2>; rel="next last"', true],
    ['<https://api.github.com/x?page=2>;   rel = "NEXT"', true],
    ['<https://api.github.com/x?page=2>; rel=next', true],
    ['<https://api.github.com/x?a=1,2&page=2>; rel="next"', true], // comma inside the URL
    ['<https://api.github.com/x?rel="next">; rel="last"', false], // "next" only inside the URL
    ['<https://api.github.com/x?page=2>; title="next"', false],
  ])('%j -> %s', (link, expected) => {
    expect(hasNextLink(link)).toBe(expected)
  })
})

describe('parseRateLimitHeaders', () => {
  test('reads limit / remaining / reset', () => {
    const info = parseRateLimitHeaders(
      h({
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '41',
        'x-ratelimit-reset': '1700000000',
      }),
      NOW,
    )
    expect(info).toEqual({
      limit: 60,
      remaining: 41,
      resetAt: new Date(1700000000_000),
      observedAt: new Date(NOW),
    })
  })
  test('null unless all three are finite numbers', () => {
    expect(parseRateLimitHeaders(h(), NOW)).toBeNull()
    expect(
      parseRateLimitHeaders(h({ 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '1' }), NOW),
    ).toBeNull()
    expect(
      parseRateLimitHeaders(
        h({ 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': 'abc', 'x-ratelimit-reset': '1' }),
        NOW,
      ),
    ).toBeNull()
    expect(
      parseRateLimitHeaders(
        h({ 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '', 'x-ratelimit-reset': '1' }),
        NOW,
      ),
    ).toBeNull()
  })
  test('ignores non-core resources', () => {
    const base = {
      'x-ratelimit-limit': '30',
      'x-ratelimit-remaining': '3',
      'x-ratelimit-reset': '1',
    }
    expect(parseRateLimitHeaders(h({ ...base, 'x-ratelimit-resource': 'search' }), NOW)).toBeNull()
    expect(
      parseRateLimitHeaders(h({ ...base, 'x-ratelimit-resource': 'core' }), NOW),
    ).not.toBeNull()
  })
})

describe('mergeRateLimit', () => {
  test('null handling', () => {
    expect(mergeRateLimit(null, null)).toBeNull()
    const a = rl(10, 100)
    expect(mergeRateLimit(null, a)).toBe(a)
    expect(mergeRateLimit(a, null)).toBe(a)
  })
  test('same window: the smaller remaining wins, whatever the arrival order', () => {
    const lo = rl(8, 100)
    const hi = rl(9, 100)
    expect(mergeRateLimit(hi, lo)).toBe(lo)
    expect(mergeRateLimit(lo, hi)).toBe(lo)
  })
  test('a newer window replaces; an older window is ignored', () => {
    const old = rl(0, 100)
    const fresh = rl(60, 3700)
    expect(mergeRateLimit(old, fresh)).toBe(fresh)
    expect(mergeRateLimit(fresh, old)).toBe(fresh)
  })
})

describe('parseRetryAfter', () => {
  test('seconds, HTTP-date, garbage', () => {
    expect(parseRetryAfter(null, NOW)).toBeNull()
    expect(parseRetryAfter('30', NOW)).toBe(30)
    expect(parseRetryAfter(' 0 ', NOW)).toBe(0)
    expect(parseRetryAfter(new Date(NOW + 90_500).toUTCString(), NOW)).toBe(90)
    expect(parseRetryAfter(new Date(NOW - 5000).toUTCString(), NOW)).toBe(0)
    expect(parseRetryAfter('soon', NOW)).toBeNull()
    expect(parseRetryAfter('-5', NOW)).toBeNull()
  })
})

describe('classifyErrorResponse', () => {
  const c = (
    status: number,
    headers: Record<string, string> = {},
    body: unknown = { message: 'm' },
    op: 'branches' | 'list' | 'detail' | 'rate_limit' = 'detail',
  ) => classifyErrorResponse(status, h(headers), body, { op, now: NOW })

  test('403/429 with Retry-After -> secondary rate limit', () => {
    for (const status of [403, 429]) {
      const e = c(status, { 'retry-after': '30' })
      expect(e).toBeInstanceOf(SecondaryRateLimitError)
      expect(e).toMatchObject({ kind: 'secondary_rate_limited', retryAfterSec: 30, status })
      expect((e as SecondaryRateLimitError).retryAt).toEqual(new Date(NOW + 30_000))
    }
  })

  test('Retry-After wins over remaining=0', () => {
    const e = c(403, { 'retry-after': '10', 'x-ratelimit-remaining': '0' })
    expect(e).toBeInstanceOf(SecondaryRateLimitError)
  })

  test('403 with remaining=0 -> primary rate limit with the reset time', () => {
    const e = c(403, {
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1700000000',
    })
    expect(e).toBeInstanceOf(RateLimitError)
    expect(e).toMatchObject({
      kind: 'rate_limited',
      reason: 'exhausted',
      limit: 60,
      remaining: 0,
      status: 403,
    })
    expect((e as RateLimitError).resetAt).toEqual(new Date(1700000000_000))
  })

  test('429 with remaining=0 is also a primary rate limit', () => {
    expect(c(429, { 'x-ratelimit-remaining': '0' })).toBeInstanceOf(RateLimitError)
  })

  test('remaining=0 without a readable reset falls back to one hour', () => {
    const e = c(403, { 'x-ratelimit-remaining': '0' }) as RateLimitError
    expect(e.resetAt).toEqual(new Date(NOW + 3600_000))
  })

  test('403 whose message mentions the secondary limit; bare 429', () => {
    const e = c(403, {}, { message: 'You have exceeded a secondary rate limit.' })
    expect(e).toBeInstanceOf(SecondaryRateLimitError)
    expect((e as SecondaryRateLimitError).retryAfterSec).toBe(60)
    expect(c(429)).toBeInstanceOf(SecondaryRateLimitError)
  })

  test('other 403 -> HttpError', () => {
    expect(c(403)).toBeInstanceOf(HttpError)
    expect(c(403, { 'x-ratelimit-remaining': '12' })).toMatchObject({ kind: 'http', status: 403 })
  })

  test.each([
    ['branches', 'repository'],
    ['list', 'branch_or_repository'],
    ['detail', 'commit'],
  ] as const)('404 on %s -> not_found(%s)', (op, resource) => {
    const e = c(404, {}, { message: 'Not Found' }, op)
    expect(e).toBeInstanceOf(NotFoundError)
    expect(e).toMatchObject({ kind: 'not_found', resource, status: 404, apiMessage: 'Not Found' })
  })

  test('404 on /rate_limit is a plain HttpError', () => {
    expect(c(404, {}, {}, 'rate_limit')).toBeInstanceOf(HttpError)
  })

  test('409 on the list -> empty repository; elsewhere HttpError', () => {
    expect(c(409, {}, {}, 'list')).toBeInstanceOf(EmptyRepositoryError)
    expect(c(409, {}, {}, 'detail')).toBeInstanceOf(HttpError)
  })

  test('422 on the list -> unknown branch; elsewhere HttpError', () => {
    expect(c(422, {}, {}, 'list')).toMatchObject({
      kind: 'not_found',
      resource: 'branch',
      status: 422,
    })
    expect(c(422, {}, {}, 'detail')).toBeInstanceOf(HttpError)
  })

  test.each([500, 502, 503, 451, 400])('%i -> HttpError', (status) => {
    expect(c(status)).toMatchObject({ kind: 'http', status })
  })

  test('apiMessage is kept, truncated, and tolerates non-object bodies', () => {
    expect(c(500, {}, { message: 'x'.repeat(1000) }).apiMessage).toHaveLength(500)
    expect(c(500, {}, null).apiMessage).toBeUndefined()
    expect(c(500, {}, 'oops').apiMessage).toBeUndefined()
    expect(c(500, {}, { message: 42 }).apiMessage).toBeUndefined()
  })
})
