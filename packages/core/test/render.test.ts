import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import logsJson from './fixtures/logs.json'
import GHFileGrass from '../src/gh_file_grass'
import type { GitLogData } from '../src/schema'

// golden-original.svg.html は元実装(gh-file-grass の JS)に同じ logs.json を与えて得た
// #gh-file-grass の innerHTML。移植後の出力がバイト単位で一致することを確認する。
const golden = readFileSync(join(import.meta.dirname, 'fixtures/golden-original.svg.html'), 'utf8')

function render(): string {
  document.body.innerHTML = '<div id="gh-file-grass"></div><div id="stat-tooltip"></div>'
  new GHFileGrass().draw(structuredClone(logsJson) as unknown as GitLogData)
  return document.querySelector('#gh-file-grass')!.innerHTML
}

describe('GHFileGrass (TS port of the original implementation)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('renders SVG identical to the original implementation', () => {
    expect(render()).toBe(golden)
  })

  test('element counts', () => {
    render()
    const count = (sel: string) => document.querySelectorAll(sel).length
    expect(count('rect.stats')).toBe(221)
    expect(count('text.file-label')).toBe(38)
    expect(count('text.commit-label')).toBe(64)
    expect(count('path.stat-arrow')).toBe(186)
    expect(count('rect.file-life')).toBe(1583)
    expect(count('rect.commit-chart')).toBe(64)
    expect(count('rect.commit-hist')).toBe(38)
    expect(count('rect.drag-handler')).toBe(3)
  })
})
