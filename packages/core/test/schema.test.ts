import { describe, expect, test } from 'vitest'
import logsJson from './fixtures/logs.json'
import { assertInvariants, InvariantError } from '../src/schema'
import type { GitLogData } from '../src/schema'

const load = (): GitLogData => structuredClone(logsJson) as unknown as GitLogData

describe('logs.json fixture', () => {
  test('has the expected shape and size', () => {
    const data = load()
    expect(data.commits).toHaveLength(64)
    expect(data.stats).toHaveLength(221)
    expect(data.files).toHaveLength(38)
  })

  test('satisfies all invariants', () => {
    expect(() => assertInvariants(load())).not.toThrow()
  })

  test('keeps the commits/stats index asymmetry', () => {
    const data = load()
    // commits: 配列は新しい順、最新 = N
    expect(data.commits[0]?.index).toBe(64)
    expect(data.commits.at(-1)?.index).toBe(1)
    // stats: 1 = 最新コミットの先頭ファイル
    expect(data.stats[0]?.index).toBe(1)
    expect(data.stats[0]?.sha_short).toBe(data.commits[0]?.sha_short)
  })
})

describe('assertInvariants violations', () => {
  const violations = (mutate: (d: GitLogData) => void): string[] => {
    const data = load()
    mutate(data)
    try {
      assertInvariants(data)
    } catch (e) {
      expect(e).toBeInstanceOf(InvariantError)
      return (e as InvariantError).violations
    }
    return []
  }

  test('commit index not consecutive', () => {
    const v = violations((d) => {
      d.commits[0]!.index = 99
    })
    expect(v.join()).toMatch(/commits: index/)
  })

  test('duplicate commit index', () => {
    const v = violations((d) => {
      d.commits[0]!.index = d.commits[1]!.index
    })
    expect(v.join()).toMatch(/commits: index/)
  })

  test('duplicate sha_short', () => {
    const v = violations((d) => {
      d.commits[1]!.sha_short = d.commits[0]!.sha_short
    })
    expect(v.join()).toMatch(/duplicate sha_short/)
  })

  test('stats referencing an unknown commit', () => {
    const v = violations((d) => {
      d.stats[0]!.sha_short = 'zzzzzzz'
    })
    expect(v.join()).toMatch(/stats: unknown sha_short/)
  })

  test('files referencing an unknown commit', () => {
    const v = violations((d) => {
      d.files[0]!.commits.push('zzzzzzz')
    })
    expect(v.join()).toMatch(/files: unknown sha_short/)
  })

  test('stats index gap', () => {
    const v = violations((d) => {
      d.stats[5]!.index = 500
    })
    expect(v.join()).toMatch(/stats\[5\]: index/)
  })

  test('render-only keys are rejected', () => {
    const v = violations((d) => {
      Object.assign(d.commits[0]!, { px: 1 })
      Object.assign(d.stats[0]!, { fileIndex: 0 })
      Object.assign(d.files[0]!, { py: 1 })
    })
    expect(v).toHaveLength(3)
  })
})
