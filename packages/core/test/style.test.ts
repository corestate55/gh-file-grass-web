import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import * as sass from 'sass'

describe('file_grass.scss', () => {
  const css = sass.compile(join(import.meta.dirname, '../src/style/file_grass.scss')).css

  test('every selector is scoped under .gh-file-grass', () => {
    const selectors = [...css.matchAll(/(^|\})\s*([^{}@][^{}]*)\{/g)]
      .flatMap((m) => m[2]!.split(','))
      .map((s) => s.trim())
      .filter(Boolean)
    expect(selectors.length).toBeGreaterThan(20)
    const unscoped = selectors.filter((s) => !s.startsWith('.gh-file-grass '))
    expect(unscoped).toEqual([])
  })

  test('styles the in-container tooltip class instead of a global id', () => {
    expect(css).toContain('.gh-file-grass .gh-file-grass-tooltip')
    expect(css).not.toContain('#stat-tooltip')
  })

  test('keeps the grass colour classes', () => {
    for (const cls of ['mod1', 'mod4', 'rank0', 'rank4', 'stat-arrow', 'file-life']) {
      expect(css).toContain(cls)
    }
  })
})
