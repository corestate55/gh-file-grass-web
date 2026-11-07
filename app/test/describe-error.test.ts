import {
  AbortedError,
  EmptyRepositoryError,
  HttpError,
  InvalidInputError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  SecondaryRateLimitError,
  ShaShortCollisionError,
} from '@gh-file-grass/github-adapter'
import type { InvalidInputReason, RateLimitInfo } from '@gh-file-grass/github-adapter'
import { describe, expect, test } from 'vitest'
import { describeError } from '../src/lib/describe-error'
import { NoBranchesError } from '../src/lib/errors'

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0)
const RESET = new Date(NOW + 30 * 60_000)
const formatTime = (d: Date) => `T${d.getTime() - NOW}`
const ctx = (rateLimit: RateLimitInfo | null = null) => ({ rateLimit, now: NOW, formatTime })
const describe_ = (err: unknown, rl: RateLimitInfo | null = null) => describeError(err, ctx(rl))
const rl = (remaining: number, resetAt = RESET): RateLimitInfo => ({
  limit: 60,
  remaining,
  resetAt,
  observedAt: new Date(NOW),
})

describe('describeError: not shown', () => {
  test('aborted -> null', () => {
    expect(describe_(new AbortedError('x'))).toBeNull()
  })
})

describe('describeError: invalid input', () => {
  test.each([
    ['empty', /Enter a repository/],
    ['unsupported_scheme', /https GitHub URL or owner\/repo/],
    ['unsupported_host', /Only github\.com/],
    ['invalid_format', /doesn't look like a repository/],
    ['invalid_owner', /doesn't look like a repository/],
    ['invalid_repo', /doesn't look like a repository/],
  ] as [InvalidInputReason, RegExp][])('%s', (reason, title) => {
    expect(describe_(new InvalidInputError('x', reason))!.title).toMatch(title)
  })

  test('the unsupported-scheme message names what is not accepted', () => {
    expect(
      describe_(new InvalidInputError('git@github.com:o/r', 'unsupported_scheme'))!.detail,
    ).toMatch(/ssh, git@ and http/)
  })
})

describe('describeError: not found', () => {
  test.each([
    ['repository', /Repository not found/, /Private repositories are not supported/],
    ['branch_or_repository', /Branch not found/, /Load the branches again/],
    ['branch', /Branch not found/, /deleted/],
    ['commit', /commit could not be fetched/, /force push/],
  ] as const)('%s', (resource, title, detail) => {
    const e = describe_(new NotFoundError(resource, 404))!
    expect(e.title).toMatch(title)
    expect(e.detail).toMatch(detail)
  })

  test('keeps the GitHub message separately', () => {
    expect(describe_(new NotFoundError('repository', 404, 'Not Found'))!.apiMessage).toBe(
      'Not Found',
    )
    expect(describe_(new NotFoundError('repository', 404))!.apiMessage).toBeUndefined()
  })
})

describe('describeError: rate limits', () => {
  test('exhausted shows the reset time', () => {
    const e = describe_(
      new RateLimitError({
        reason: 'exhausted',
        limit: 60,
        remaining: 0,
        resetAt: RESET,
        status: 403,
      }),
    )!
    expect(e.title).toMatch(/rate limit reached/i)
    expect(e.detail).toContain('60 per hour')
    expect(e.detail).toContain(`T${30 * 60_000}`)
  })

  test('insufficient shows needed, remaining and the reset time', () => {
    const e = describe_(
      new RateLimitError({
        reason: 'insufficient',
        limit: 60,
        remaining: 9,
        resetAt: RESET,
        needed: 20,
      }),
    )!
    expect(e.title).toMatch(/Not enough API quota/)
    expect(e.detail).toMatch(/20 requests are needed but 9 remain/)
    expect(e.detail).toContain(`T${30 * 60_000}`)
  })

  describe('insufficient quota with the number of commits that can still be fetched', () => {
    const insufficient = () =>
      new RateLimitError({
        reason: 'insufficient',
        limit: 60,
        remaining: 10,
        resetAt: RESET,
        needed: 20,
      })
    const detailWith = (affordableCount?: number | null) =>
      describeError(insufficient(), { rateLimit: null, now: NOW, formatTime, affordableCount })!
        .detail!

    test('tells how many commits can be fetched now', () => {
      expect(detailWith(10)).toBe(
        `About 20 requests are needed but 10 remain. Up to 10 commits can be fetched now, or wait until T${30 * 60_000}.`,
      )
    })

    test('singular', () => {
      expect(detailWith(1)).toContain('Up to 1 commit can be fetched now')
    })

    test('nothing can be fetched: only waiting helps', () => {
      expect(detailWith(0)).toBe(
        `About 20 requests are needed but 10 remain. Wait until T${30 * 60_000}.`,
      )
    })

    test('unknown: the generic advice', () => {
      for (const unknown of [null, undefined]) {
        expect(detailWith(unknown)).toContain('Reduce the number of commits, or wait until')
      }
    })
  })

  test('secondary rate limit shows when to retry', () => {
    const retryAt = new Date(NOW + 45_000)
    const e = describe_(new SecondaryRateLimitError(45, retryAt, 403))!
    expect(e.title).toMatch(/Too many requests/)
    expect(e.detail).toContain('T45000')
    expect(e.detail).toContain('45 seconds')
  })
})

describe('describeError: other GitHub errors', () => {
  test('empty repository', () => {
    expect(describe_(new EmptyRepositoryError())!.title).toMatch(/empty/)
  })

  test('http shows the status and the GitHub message', () => {
    const e = describe_(new HttpError(502, undefined, 'Bad Gateway'))!
    expect(e.title).toBe('GitHub returned HTTP 502.')
    expect(e.apiMessage).toBe('Bad Gateway')
  })

  test('network failure', () => {
    const e = describe_(new NetworkError(new TypeError('Failed to fetch')))!
    expect(e.title).toMatch(/Could not reach the GitHub API/)
    expect(e.detail).toMatch(/offline|blocked/)
  })

  test('network failure while the quota is known to be exhausted is shown as a rate limit (403 without CORS)', () => {
    const e = describe_(new NetworkError(new TypeError('x')), rl(0))!
    expect(e.title).toMatch(/rate limit reached/i)
    expect(e.detail).toContain(`T${30 * 60_000}`)
  })

  test.each([
    ['quota left', rl(5)],
    ['window already over', rl(0, new Date(NOW - 1000))],
    ['never observed', null],
  ])('network failure stays a network error (%s)', (_name, observed) => {
    expect(describe_(new NetworkError(new TypeError('x')), observed)!.title).toMatch(
      /Could not reach/,
    )
  })
})

describe('describeError: errors that are not GitHubError', () => {
  test('ShaShortCollisionError', () => {
    expect(describe_(new ShaShortCollisionError('abc1234'))!.title).toMatch(/same short SHA/)
  })

  test('NoBranchesError', () => {
    expect(describe_(new NoBranchesError())!.title).toMatch(/no branches/)
  })

  test('unknown Error: the message is shown as detail', () => {
    const e = describe_(new RangeError('count must be an integer'))!
    expect(e.title).toBe('Unexpected error.')
    expect(e.detail).toBe('count must be an integer')
  })

  test('non-Error values', () => {
    expect(describe_('boom')!.detail).toBe('boom')
    expect(describe_(undefined)!.detail).toBe('undefined')
    expect(describe_({ a: 1 })!.title).toBe('Unexpected error.')
  })

  test('markup in messages stays plain text in the returned strings (rendering is by interpolation)', () => {
    const e = describe_(new HttpError(500, undefined, '<img src=x onerror=alert(1)>'))!
    expect(e.apiMessage).toBe('<img src=x onerror=alert(1)>')
  })
})

describe('describeError: default time formatting', () => {
  test('works without a formatter', () => {
    const e = describeError(
      new RateLimitError({ reason: 'exhausted', limit: 60, remaining: 0, resetAt: RESET }),
      { rateLimit: null, now: NOW },
    )!
    expect(e.detail).toMatch(/resets at .+\./)
  })
})
