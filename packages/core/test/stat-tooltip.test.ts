import { describe, expect, test } from 'vitest'
import GHLogStat from '../src/gh_file_grass/stat'
import type { Stat } from '../src/schema'

const stat = (over: Partial<Stat> = {}): Stat => ({
  path: 'a.rb',
  mode: '100644',
  type: 'modified',
  src: '1111111',
  dst: '2222222',
  bin: false,
  stat_path: { path: 'a.rb', src: 'a.rb', dst: 'a.rb' },
  insertions: 3,
  deletions: 1,
  lines: 4,
  sha_short: 'aaaaaaa',
  index: 1,
  ...over,
})

/** ツールチップの「src..dst mode」の行(<code> の中身)。無ければ null */
function indexLine(over: Partial<Stat>): string | null {
  const host = document.createElement('div')
  host.innerHTML = new GHLogStat(stat(over)).tooltipHtml()
  const items = [...host.querySelectorAll('li')]
  const li = items.find(
    (l) => /\.\./.test(l.querySelector('code')?.textContent ?? '') && l.querySelector('code'),
  )
  return li?.querySelector('code')?.textContent ?? null
}

describe('stat tooltip: the blob range line', () => {
  test('both blobs and the mode', () => {
    expect(indexLine({})).toBe('1111111..2222222 100644')
  })

  test('no mode (the GitHub API does not give one): no trailing space', () => {
    expect(indexLine({ mode: '' })).toBe('1111111..2222222')
  })

  test('the previous blob is unknown (outside the fetched range): shown as "?" instead of nothing', () => {
    expect(indexLine({ src: '', mode: '' })).toBe('?..2222222')
    expect(indexLine({ src: '' })).toBe('?..2222222 100644')
  })

  test('the new blob is unknown', () => {
    expect(indexLine({ dst: '', mode: '' })).toBe('1111111..?')
  })

  test('a new file keeps the all-zero source as it is', () => {
    expect(indexLine({ type: 'new', src: '0000000', mode: '' })).toBe('0000000..2222222')
  })

  test('a deleted file keeps the all-zero destination as it is', () => {
    expect(indexLine({ type: 'deleted', dst: '0000000', mode: '' })).toBe('1111111..0000000')
  })

  test('no line when nothing changed (no lines)', () => {
    expect(indexLine({ lines: 0, insertions: 0, deletions: 0 })).toBeNull()
  })

  test('still escaped', () => {
    const host = document.createElement('div')
    host.innerHTML = new GHLogStat(stat({ src: '<img src=x onerror=alert(1)>' })).tooltipHtml()
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>..2222222')
  })
})
