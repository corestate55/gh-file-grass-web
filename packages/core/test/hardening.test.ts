import { afterEach, describe, expect, test, vi } from 'vitest'
import { draw as drawInto } from '../src/draw'
import GHLogCommit from '../src/gh_file_grass/commit'
import GHLogStat from '../src/gh_file_grass/stat'
import { encodePath, escapeHtml, safeHref } from '../src/gh_file_grass/escape'
import type { Commit, GitLogData, Stat } from '../src/schema'

const PAYLOAD = '<img src=x onerror="alert(1)">'

const commit = (over: Partial<Commit> = {}): Commit => ({
  sha: 'a'.repeat(40),
  sha_short: 'aaaaaaa',
  author: { name: 'n', email: 'e@example.com' },
  date: '2022-05-02 23:21:38 +0900',
  message: 'msg',
  index: 1,
  stat_total: { insertions: 1, deletions: 0, lines: 1, files: 1 },
  ...over,
})

const stat = (over: Partial<Stat> = {}): Stat => ({
  path: 'a.rb',
  mode: '100644',
  type: 'modified',
  src: '1111111',
  dst: '2222222',
  bin: false,
  stat_path: { path: 'a.rb', src: 'a.rb', dst: 'a.rb' },
  insertions: 1,
  deletions: 0,
  lines: 1,
  sha_short: 'aaaaaaa',
  index: 1,
  ...over,
})

/** tooltip HTML を実際に DOM に流し込み、注入された要素が無いことを確認する */
function expectInert(html: string) {
  const host = document.createElement('div')
  host.innerHTML = html
  expect(host.querySelector('img')).toBeNull()
  expect(host.querySelector('[onerror]')).toBeNull()
  expect(host.textContent).toContain(PAYLOAD)
}

describe('escape helpers', () => {
  test('escapeHtml', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
  })
  test('encodePath keeps separators and encodes the rest', () => {
    expect(encodePath('dir/a b#c?.rb')).toBe('dir/a%20b%23c%3F.rb')
  })
  test('safeHref rejects non-http(s)', () => {
    expect(safeHref('https://github.com/o/r')).toBe('https://github.com/o/r')
    expect(safeHref('javascript:alert(1)')).toBe('#')
  })
})

describe('tooltip XSS', () => {
  test.each(['sha', 'date', 'message'] as const)('commit.%s is escaped', (key) => {
    const c = new GHLogCommit(commit({ [key]: PAYLOAD }))
    expectInert(c.tooltipHtml())
  })

  test('commit author name/email are escaped', () => {
    expectInert(new GHLogCommit(commit({ author: { name: PAYLOAD, email: 'x' } })).tooltipHtml())
    expectInert(new GHLogCommit(commit({ author: { name: 'x', email: PAYLOAD } })).tooltipHtml())
  })

  test.each([
    ['new', { type: 'new' }],
    ['deleted', { type: 'deleted' }],
    ['modified', { type: 'modified' }],
    ['renamed', { stat_path: { path: PAYLOAD, src: 'a', dst: 'b' } } as Partial<Stat>],
  ] as [string, Partial<Stat>][])('stat path is escaped (%s)', (_name, over) => {
    const s = new GHLogStat(stat({ path: PAYLOAD, ...over }))
    expectInert(s.tooltipHtml())
  })

  test('stat sha_short / src / dst / mode are escaped', () => {
    for (const key of ['sha_short', 'src', 'dst', 'mode'] as const) {
      const html = new GHLogStat(stat({ [key]: PAYLOAD })).tooltipHtml()
      const host = document.createElement('div')
      host.innerHTML = html
      expect(host.querySelector('img'), key).toBeNull()
    }
  })
})

describe('draw()', () => {
  afterEach(() => vi.restoreAllMocks())

  const draw = (data: GitLogData) => {
    document.body.innerHTML = '<div id="gh-file-grass"></div>'
    const container = document.querySelector<HTMLElement>('#gh-file-grass')!
    drawInto(data, { container })
    return container
  }
  const base = (over: Partial<GitLogData> = {}): GitLogData => ({
    repo: 'o/r',
    branch: 'main',
    origin: 'https://github.com/o/r',
    commits: [],
    stats: [],
    files: [],
    ...over,
  })
  const hrefOf = (a: Element) => a.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
  const expectFinite = (root: Element) => {
    const html = root.innerHTML
    expect(html).not.toMatch(/NaN|Infinity/)
  }

  test('does not write to console', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    draw(
      base({
        commits: [commit()],
        stats: [stat()],
        files: [{ name: 'a.rb', index: 1, commits: ['aaaaaaa'] }],
      }),
    )
    expect(spy).not.toHaveBeenCalled()
  })

  test('empty data produces no NaN/Infinity', () => {
    expectFinite(draw(base()))
  })

  test('commit without changes (lines = 0) produces no NaN/Infinity', () => {
    const data = base({
      commits: [commit({ stat_total: { insertions: 0, deletions: 0, lines: 0, files: 0 } })],
    })
    expectFinite(draw(data))
  })

  test('file with no commits produces no NaN/Infinity', () => {
    const data = base({
      commits: [commit()],
      stats: [stat()],
      files: [{ name: 'a.rb', index: 1, commits: [] }],
    })
    expectFinite(draw(data))
  })

  test('links are URL-encoded', () => {
    const name = 'dir/a b#c.rb'
    const data = base({
      branch: 'feature/x y',
      commits: [commit()],
      stats: [stat({ path: name, stat_path: { path: name, src: name, dst: name } })],
      files: [{ name, index: 1, commits: ['aaaaaaa'] }],
    })
    const hrefs = [...draw(data).querySelectorAll('a')].map((a) => hrefOf(a))
    expect(hrefs).toContain('https://github.com/o/r/blob/feature/x%20y/dir/a%20b%23c.rb')
    expect(hrefs).toContain(`https://github.com/o/r/tree/${'a'.repeat(40)}/dir/a%20b%23c.rb`)
  })

  test('non-http origin never becomes a link target', () => {
    const data = base({ origin: 'javascript:alert(1)', commits: [commit()] })
    const hrefs = [...draw(data).querySelectorAll('a')].map((a) => hrefOf(a))
    expect(hrefs.every((h) => h === '#')).toBe(true)
  })
})
