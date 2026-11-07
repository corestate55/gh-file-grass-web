import { describe, expect, test } from 'vitest'
import { createSrcResolver } from '../src/blob-history'
import type { GhCommitFile } from '../src/github-types'
import { loadDetails, loadLogsJson } from './helpers/fixtures'
import { added, commit, file, id, modified, removed, renamed } from './helpers/build'

describe('createSrcResolver (synthetic)', () => {
  test('linear chain: the nearest previous touch wins', () => {
    const c3 = commit('c3', ['c2'], [modified('f', 'b3')])
    const c2 = commit('c2', ['c1'], [modified('f', 'b2')])
    const c1 = commit('c1', [], [added('f', 'b1')])
    const src = createSrcResolver([c3, c2, c1])
    expect(src(c3, 'f')).toBe(id('b2'))
    expect(src(c2, 'f')).toBe(id('b1'))
    expect(src(c1, 'f')).toBeNull() // root: no parent
  })

  test('follows the first parent, not the neighbour in the list', () => {
    // 一覧順は [c3, c2, c1] だが、c3 の第一親は c1(c2 は別の枝)
    const c3 = commit('c3', ['c1'], [modified('f', 'b3')])
    const c2 = commit('c2', ['c1'], [modified('f', 'b2')])
    const c1 = commit('c1', [], [added('f', 'b1')])
    expect(createSrcResolver([c3, c2, c1])(c3, 'f')).toBe(id('b1'))
  })

  test('merge commit: uses the first parent only', () => {
    const m = commit('m', ['pa', 'pb'], [modified('f', 'bm')])
    const pa = commit('pa', ['r'], [modified('f', 'ba')])
    const pb = commit('pb', ['r'], [modified('f', 'bb')])
    const r = commit('r', [], [added('f', 'b0')])
    const src = createSrcResolver([m, pa, pb, r])
    expect(src(m, 'f')).toBe(id('ba'))
  })

  test('skips commits that did not touch the path', () => {
    const c3 = commit('c3', ['c2'], [modified('f', 'b3')])
    const c2 = commit('c2', ['c1'], [modified('other', 'x2')])
    const c1 = commit('c1', [], [added('f', 'b1'), added('other', 'x1')])
    expect(createSrcResolver([c3, c2, c1])(c3, 'f')).toBe(id('b1'))
  })

  test('a removed file has no blob after the commit (its sha is the blob BEFORE)', () => {
    const c3 = commit('c3', ['c2'], [added('f', 'b3')])
    const c2 = commit('c2', ['c1'], [removed('f', 'b1')])
    const c1 = commit('c1', [], [added('f', 'b1')])
    const c4 = commit('c4', ['c3'], [modified('f', 'b4')])
    const src = createSrcResolver([c4, c3, c2, c1])
    expect(src(c3, 'f')).toBeNull() // deleted in c2, never the pre-deletion blob b1
    expect(src(c4, 'f')).toBe(id('b3')) // re-added in c3
  })

  test('pure rename keeps the blob under the new path', () => {
    const c3 = commit('c3', ['c2'], [modified('new', 'b3')])
    const c2 = commit('c2', ['c1'], [renamed('old', 'new', 'b1', true)])
    const c1 = commit('c1', [], [added('old', 'b1')])
    const src = createSrcResolver([c3, c2, c1])
    expect(src(c3, 'new')).toBe(id('b1'))
    expect(src(c3, 'old')).toBeNull() // the old path is gone
    expect(src(c2, 'old')).toBe(id('b1')) // the renaming commit itself diffs against the old path
  })

  test('rename with changes: the new path takes the new blob', () => {
    const c3 = commit('c3', ['c2'], [modified('new', 'b3')])
    const c2 = commit('c2', ['c1'], [renamed('old', 'new', 'b2')])
    const c1 = commit('c1', [], [added('old', 'b1')])
    const src = createSrcResolver([c3, c2, c1])
    expect(src(c2, 'old')).toBe(id('b1'))
    expect(src(c3, 'new')).toBe(id('b2'))
  })

  test.each([
    ['rename listed first', (r: GhCommitFile, a: GhCommitFile) => [r, a]],
    ['add listed first', (r: GhCommitFile, a: GhCommitFile) => [a, r]],
  ])('same commit renames A->B and adds A (%s): the add wins', (_n, order) => {
    const files = order(renamed('A', 'B', 'bB'), added('A', 'bA'))
    const c2 = commit('c2', ['c1'], files)
    const c1 = commit('c1', [], [added('A', 'b1')])
    const c3 = commit('c3', ['c2'], [modified('A', 'b3')])
    expect(createSrcResolver([c3, c2, c1])(c3, 'A')).toBe(id('bA'))
  })

  test('parent outside the range -> null', () => {
    const c2 = commit('c2', ['c1'], [modified('f', 'b2')])
    expect(createSrcResolver([c2])(c2, 'f')).toBeNull()
  })

  test('terminates on cyclic (invalid) input', () => {
    const c1 = commit('c1', ['c2'], [modified('x', 'b1')])
    const c2 = commit('c2', ['c1'], [modified('y', 'b2')])
    expect(createSrcResolver([c1, c2])(c1, 'f')).toBeNull()
  })

  test('tolerates commits without files', () => {
    const c3 = commit('c3', ['c2'], [modified('f', 'b3')])
    const c2 = commit('c2', ['c1'], undefined)
    const c1 = commit('c1', [], [added('f', 'b1')])
    expect(createSrcResolver([c3, c2, c1])(c3, 'f')).toBe(id('b1'))
  })

  test('null blob sha -> unknown', () => {
    const c2 = commit('c2', ['c1'], [modified('f', 'b2')])
    const c1 = commit('c1', [], [file({ filename: 'f', sha: null, status: 'added' })])
    expect(createSrcResolver([c2, c1])(c2, 'f')).toBeNull()
  })

  describe('truncated commits', () => {
    const c3 = commit('c3', ['c2'], [modified('f', 'b3')])
    const c1 = commit('c1', [], [added('f', 'b1')])
    test('stops at a truncated commit that does not list the path', () => {
      const c2 = commit('c2', ['c1'], [modified('other', 'x2')])
      const src = createSrcResolver([c3, c2, c1], { truncatedShas: new Set([id('c2')]) })
      expect(src(c3, 'f')).toBeNull() // would otherwise wrongly pick b1
    })
    test('still uses a truncated commit that lists the path', () => {
      const c2 = commit('c2', ['c1'], [modified('f', 'b2')])
      const src = createSrcResolver([c3, c2, c1], { truncatedShas: new Set([id('c2')]) })
      expect(src(c3, 'f')).toBe(id('b2'))
    })
  })
})

describe('createSrcResolver (recorded fixtures vs Ruby src)', () => {
  const details = loadDetails()
  const logs = loadLogsJson()
  const src = createSrcResolver(details)

  test('every modified / renamed-with-changes file resolves to the Ruby src (7 digits)', () => {
    let checked = 0
    for (const d of details) {
      for (const f of d.files ?? []) {
        if (f.status === 'added' || f.status === 'removed') continue
        if (f.status === 'renamed' && f.changes === 0) continue // src は '' (別途)
        const path = f.previous_filename ?? f.filename
        const ruby = logs.stats.find((s) => s.sha_short === d.sha.slice(0, 7) && s.path === path)!
        expect(src(d, path)?.slice(0, 7) ?? '', `${d.sha.slice(0, 7)} ${path}`).toBe(ruby.src)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(150)
  })

  test('dependabot commits resolve to the same blob although they are far apart in the list', () => {
    const dependabot = details.filter((d) =>
      (d.files ?? []).some((f) => f.filename === 'package-lock.json' && f.status === 'modified'),
    )
    const resolved = dependabot.map((d) => src(d, 'package-lock.json')?.slice(0, 7))
    const ruby = dependabot.map(
      (d) =>
        logs.stats.find((s) => s.sha_short === d.sha.slice(0, 7) && s.path === 'package-lock.json')!
          .src,
    )
    expect(dependabot.length).toBeGreaterThanOrEqual(7)
    expect(resolved).toEqual(ruby)
    expect(resolved).toContain('e7912cd') // the shared base blob
  })
})
