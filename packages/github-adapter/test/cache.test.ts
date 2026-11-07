import { describe, expect, test } from 'vitest'
import { LruCache, TtlCache } from '../src/cache'

describe('LruCache', () => {
  test('rejects an invalid size', () => {
    expect(() => new LruCache(0)).toThrow(RangeError)
  })

  test('evicts the least recently used entry beyond the limit', () => {
    const c = new LruCache<string, number>(3)
    c.set('a', 1)
    c.set('b', 2)
    c.set('c', 3)
    c.set('d', 4)
    expect(c.size).toBe(3)
    expect(c.get('a')).toBeUndefined()
    expect([c.get('b'), c.get('c'), c.get('d')]).toEqual([2, 3, 4])
  })

  test('get refreshes the order; has does not', () => {
    const c = new LruCache<string, number>(3)
    c.set('a', 1)
    c.set('b', 2)
    c.set('c', 3)
    c.get('a') // a is now the newest
    c.set('d', 4) // evicts b
    expect(c.has('b')).toBe(false)
    expect(c.has('a')).toBe(true)

    c.has('c') // must not refresh c
    c.set('e', 5) // evicts c (oldest after a, d)
    expect(c.has('c')).toBe(false)
  })

  test('set on an existing key replaces the value and refreshes it', () => {
    const c = new LruCache<string, number>(2)
    c.set('a', 1)
    c.set('b', 2)
    c.set('a', 10)
    c.set('c', 3) // evicts b
    expect(c.get('a')).toBe(10)
    expect(c.has('b')).toBe(false)
  })

  test('delete', () => {
    const c = new LruCache<string, number>(2)
    c.set('a', 1)
    c.delete('a')
    expect(c.size).toBe(0)
  })
})

describe('TtlCache', () => {
  test('entries expire exactly at the TTL', () => {
    let t = 1000
    const c = new TtlCache<string, string>(300_000, () => t)
    c.set('k', 'v')
    t += 299_999
    expect(c.get('k')).toBe('v')
    t += 1
    expect(c.get('k')).toBeUndefined()
  })

  test('set restarts the clock; delete removes', () => {
    let t = 0
    const c = new TtlCache<string, string>(100, () => t)
    c.set('k', 'v1')
    t = 90
    c.set('k', 'v2')
    t = 150
    expect(c.get('k')).toBe('v2')
    c.delete('k')
    expect(c.get('k')).toBeUndefined()
  })
})
