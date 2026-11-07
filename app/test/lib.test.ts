import { afterEach, describe, expect, test, vi } from 'vitest'
import { pickDefaultBranch } from '../src/lib/branches'
import { resolveTimeZone } from '../src/lib/timezone'

const names = (...n: string[]) => n.map((name) => ({ name }))

describe('pickDefaultBranch', () => {
  test.each([
    [['develop', 'main', 'master'], 'main'],
    [['develop', 'master'], 'master'],
    [['develop', 'feature/x'], 'develop'],
    [['master', 'main'], 'main'],
    [['Main', 'dev'], 'Main'], // case sensitive: falls back to the first
    [['only'], 'only'],
    [[], null],
  ])('%j -> %s', (branches, expected) => {
    expect(pickDefaultBranch(names(...branches))).toBe(expected)
  })
})

describe('resolveTimeZone', () => {
  afterEach(() => vi.restoreAllMocks())

  test('returns the browser time zone', () => {
    const tz = resolveTimeZone()
    expect(tz === undefined || typeof tz === 'string').toBe(true)
    if (tz) expect(() => new Intl.DateTimeFormat('en', { timeZone: tz })).not.toThrow()
  })

  test('undefined when it cannot be resolved', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('unavailable')
    })
    expect(resolveTimeZone()).toBeUndefined()
  })

  test('undefined when the resolved name is rejected', () => {
    const real = Intl.DateTimeFormat
    let calls = 0
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(((...args: unknown[]) => {
      calls++
      if (calls === 1) return { resolvedOptions: () => ({ timeZone: 'Not/AZone' }) }
      return new (real as unknown as new (...a: unknown[]) => object)(...args)
    }) as unknown as typeof Intl.DateTimeFormat)
    expect(resolveTimeZone()).toBeUndefined()
  })

  test('undefined when the name is empty', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation((() => ({
      resolvedOptions: () => ({ timeZone: '' }),
    })) as unknown as typeof Intl.DateTimeFormat)
    expect(resolveTimeZone()).toBeUndefined()
  })
})
