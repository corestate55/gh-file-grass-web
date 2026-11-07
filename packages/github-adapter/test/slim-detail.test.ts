import { describe, expect, test } from 'vitest'
import { assertTimeZone } from '../src/date'
import { toCachedDetail } from '../src/slim-detail'
import { toGitLogData } from '../src'
import { loadDetails } from './helpers/fixtures'

const ref = { owner: 'corestate55', repo: 'gh-file-grass' }

describe('toCachedDetail', () => {
  const details = loadDetails()

  test('conversion output is identical before and after the projection (all 64 recorded commits)', () => {
    const slim = details.map(toCachedDetail)
    const run = (commits: typeof details) =>
      toGitLogData({ ref, branch: 'develop', commits, timeZone: 'Asia/Tokyo' })
    expect(run(slim)).toEqual(run(details))
  })

  test('drops patch bodies but keeps whether a patch existed', () => {
    const withPatch = details.find((d) => d.files?.some((f) => f.patch))!
    const slim = toCachedDetail(withPatch)
    for (const [i, f] of slim.files!.entries()) {
      const orig = withPatch.files![i]!
      expect(f.patch === undefined).toBe(orig.patch === undefined)
      if (f.patch !== undefined) expect(f.patch).toBe('')
    }
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(withPatch).length / 2)
  })

  test('keeps only the fields used by toGitLogData', () => {
    const slim = toCachedDetail(details[0]!)
    expect(Object.keys(slim).sort()).toEqual(['commit', 'files', 'parents', 'sha', 'stats'])
    expect(Object.keys(slim.commit).sort()).toEqual(['author', 'committer', 'message'])
    expect(Object.keys(slim.files![0]!)).not.toContain('raw_url')
  })

  test('shares no objects with its input (mutating the input cannot corrupt the cache)', () => {
    const input = structuredClone(details[1]!)
    const slim = toCachedDetail(input)
    const before = JSON.stringify(slim)
    input.commit.message = 'changed'
    input.files![0]!.filename = 'changed'
    input.parents[0]!.sha = 'changed'
    input.commit.author!.name = 'changed'
    if (input.stats) input.stats.additions = -1
    expect(JSON.stringify(slim)).toBe(before)
  })

  test('tolerates missing optional parts', () => {
    const slim = toCachedDetail({
      sha: 'a'.repeat(40),
      commit: { author: null, committer: null, message: 'm' },
      parents: [],
    })
    expect(slim).toEqual({
      sha: 'a'.repeat(40),
      commit: { author: null, committer: null, message: 'm' },
      parents: [],
    })
  })
})

describe('assertTimeZone', () => {
  test('accepts undefined and valid names; throws RangeError otherwise', () => {
    expect(() => assertTimeZone()).not.toThrow()
    expect(() => assertTimeZone('Asia/Tokyo')).not.toThrow()
    expect(() => assertTimeZone('UTC')).not.toThrow()
    expect(() => assertTimeZone('Not/AZone')).toThrow(RangeError)
    expect(() => assertTimeZone('')).toThrow(RangeError)
  })
})
