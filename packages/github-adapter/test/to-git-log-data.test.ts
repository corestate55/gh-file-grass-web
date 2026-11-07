import { assertInvariants } from '@gh-file-grass/core/schema'
import { describe, expect, test } from 'vitest'
import { ShaShortCollisionError, toGitLogData } from '../src'
import { compareCodePoints } from '../src/to-git-log-data'
import type { GhCommitDetail } from '../src'
import { added, commit, file, id, modified, removed, renamed } from './helpers/build'

const ref = { owner: 'o', repo: 'r' }
const run = (commits: GhCommitDetail[], extra: Record<string, unknown> = {}) =>
  toGitLogData({ ref, branch: 'main', commits, timeZone: 'Asia/Tokyo', ...extra })

/** 深く freeze して、入力を書き換えたら TypeError になるようにする */
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    Object.values(o).forEach(deepFreeze)
  }
  return o
}

// c3 -> c2 -> c1(root)
const chain = () => [
  commit('c3', ['c2'], [modified('b.txt', 'b3'), modified('a.txt', 'a3')]),
  commit('c2', ['c1'], [modified('a.txt', 'a2')]),
  commit('c1', [], [added('a.txt', 'a1'), added('b.txt', 'b1')]),
]

describe('toGitLogData: top level', () => {
  test('repo / branch / origin', () => {
    const { data } = run(chain())
    expect(data.repo).toBe('o/r')
    expect(data.branch).toBe('main')
    expect(data.origin).toBe('https://github.com/o/r')
  })

  test('satisfies the schema invariants and has no render-only keys', () => {
    expect(() => assertInvariants(run(chain()).data)).not.toThrow()
  })

  test('does not modify its input', () => {
    const input = deepFreeze(chain())
    expect(() => run(input)).not.toThrow()
  })

  test('empty input', () => {
    const { data, warnings } = run([])
    expect(data.commits).toEqual([])
    expect(data.stats).toEqual([])
    expect(data.files).toEqual([])
    expect(warnings).toEqual([])
    expect(() => assertInvariants(data)).not.toThrow()
  })
})

describe('toGitLogData: commits', () => {
  test('keeps newest-first order; index runs N..1', () => {
    const { data } = run(chain())
    expect(data.commits.map((c) => c.sha_short)).toEqual(['c300000', 'c200000', 'c100000'])
    expect(data.commits.map((c) => c.index)).toEqual([3, 2, 1])
  })

  test('sha_short is the first 7 characters', () => {
    expect(run(chain()).data.commits[0]!.sha).toBe(id('c3'))
  })

  test('stat_total comes from commit.stats when present', () => {
    const c = commit('c1', [], [added('a', 'a1')], {
      stats: { additions: 5, deletions: 2, total: 7 },
    })
    expect(run([c]).data.commits[0]!.stat_total).toEqual({
      insertions: 5,
      deletions: 2,
      lines: 7,
      files: 1,
    })
  })

  test('stat_total falls back to the sum over files; files counts renames and empty entries', () => {
    const c = commit(
      'c1',
      [],
      [
        file({ filename: 'a', status: 'added', additions: 3, deletions: 0, changes: 3 }),
        file({ filename: 'b', status: 'modified', additions: 1, deletions: 4, changes: 5 }),
        renamed('x', 'y', 'b9', true),
      ],
    )
    expect(run([c]).data.commits[0]!.stat_total).toEqual({
      insertions: 4,
      deletions: 4,
      lines: 8,
      files: 3,
    })
  })

  test('empty commit (no files / files missing)', () => {
    const a = commit('c2', ['c1'], [])
    const b = commit('c1', [], undefined)
    const { data } = run([a, b])
    expect(data.commits.map((c) => c.stat_total)).toEqual([
      { insertions: 0, deletions: 0, lines: 0, files: 0 },
      { insertions: 0, deletions: 0, lines: 0, files: 0 },
    ])
    expect(data.stats).toEqual([])
    expect(() => assertInvariants(data)).not.toThrow()
  })

  test('author: git author, else committer, else unknown', () => {
    const base = commit('c1', [], [])
    const withAuthor = run([base]).data.commits[0]!.author
    expect(withAuthor).toEqual({ name: 'author', email: 'author@example.com' })

    const noAuthor = { ...base, commit: { ...base.commit, author: null } }
    expect(run([noAuthor]).data.commits[0]!.author).toEqual({
      name: 'committer',
      email: 'committer@example.com',
    })

    const none = { ...base, commit: { ...base.commit, author: null, committer: null } }
    expect(run([none]).data.commits[0]!.author).toEqual({ name: 'unknown', email: '' })

    const nullFields = {
      ...base,
      commit: { ...base.commit, author: { name: null, email: null, date: null } },
    }
    expect(run([nullFields]).data.commits[0]!.author).toEqual({ name: '', email: '' })
  })

  test('date: committer date in the given time zone; falls back to author date, then ""', () => {
    const base = commit('c1', [], [])
    const c1 = {
      ...base,
      commit: {
        ...base.commit,
        author: { date: '2019-12-07T02:43:00Z' },
        committer: { date: '2019-12-07T05:05:01Z' },
      },
    }
    expect(run([c1]).data.commits[0]!.date).toBe('2019-12-07 14:05:01 +0900')
    expect(
      toGitLogData({ ref, branch: 'b', commits: [c1], timeZone: 'UTC' }).data.commits[0]!.date,
    ).toBe('2019-12-07 05:05:01 +0000')

    const noCommitter = { ...base, commit: { ...base.commit, committer: null } }
    expect(run([noCommitter]).data.commits[0]!.date).toBe('2022-05-02 23:21:38 +0900')

    const noDates = {
      ...base,
      commit: { ...base.commit, author: { name: 'a' }, committer: { name: 'c' } },
    }
    expect(run([noDates]).data.commits[0]!.date).toBe('')
  })

  test('message is kept as is (multi-paragraph)', () => {
    const base = commit('c1', [], [])
    const c = { ...base, commit: { ...base.commit, message: 'title\n\nbody\n- item' } }
    expect(run([c]).data.commits[0]!.message).toBe('title\n\nbody\n- item')
  })

  test('sha_short collision throws', () => {
    const a = commit('c1', [], [])
    const b = { ...commit('c2', [], []), sha: 'c100000' + 'f'.repeat(33) }
    expect(() => run([a, b])).toThrow(ShaShortCollisionError)
  })

  test('the same commit twice is reported as a collision', () => {
    const a = commit('c1', [], [])
    expect(() => run([a, a])).toThrow(ShaShortCollisionError)
  })

  test('invalid time zone throws RangeError', () => {
    expect(() => run(chain(), { timeZone: 'Not/AZone' })).toThrow(RangeError)
  })
})

describe('toGitLogData: stats', () => {
  test('flattens newest-first following the API file order; index runs 1..M', () => {
    const { data } = run(chain())
    expect(data.stats.map((s) => [s.index, s.sha_short, s.path])).toEqual([
      [1, 'c300000', 'b.txt'],
      [2, 'c300000', 'a.txt'],
      [3, 'c200000', 'a.txt'],
      [4, 'c100000', 'a.txt'],
      [5, 'c100000', 'b.txt'],
    ])
  })

  test('modified: src is the first-parent blob, dst the new blob (7 digits)', () => {
    const { data, warnings } = run(chain())
    const s = data.stats.find((x) => x.sha_short === 'c300000' && x.path === 'a.txt')!
    expect(s).toMatchObject({
      type: 'modified',
      src: 'a200000',
      dst: 'a300000',
      mode: '',
      bin: false,
    })
    expect(warnings).toEqual([])
  })

  test('added: src 0000000; removed: dst 0000000 and src is the pre-deletion blob', () => {
    const c2 = commit('c2', ['c1'], [removed('a.txt', 'a1'), added('n.txt', 'n2')])
    const c1 = commit('c1', [], [added('a.txt', 'a1')])
    const { data } = run([c2, c1])
    const del = data.stats.find((s) => s.path === 'a.txt' && s.sha_short === 'c200000')!
    expect(del).toMatchObject({ type: 'deleted', src: 'a100000', dst: '0000000' })
    const add = data.stats.find((s) => s.path === 'n.txt')!
    expect(add).toMatchObject({ type: 'new', src: '0000000', dst: 'n200000' })
  })

  test('the arrow chain survives a deletion: no arrow into the deleting stat', () => {
    // removed.dst === '0000000' -> core's findAllDstOf yields nothing
    const c2 = commit('c2', ['c1'], [removed('a.txt', 'a1')])
    const c1 = commit('c1', [], [added('a.txt', 'a1')])
    const { data } = run([c2, c1])
    const deleted = data.stats.find((s) => s.type === 'deleted')!
    expect(deleted.dst).toBe('0000000')
    const add = data.stats.find((s) => s.type === 'new')!
    // add.dst === deleted.src: that is the intended arrow add -> delete
    expect(add.dst).toBe(deleted.src)
  })

  test('lines = insertions + deletions (not GitHub "changes")', () => {
    const c = commit(
      'c1',
      [],
      [file({ filename: 'a', status: 'modified', additions: 2, deletions: 3, changes: 99 })],
    )
    expect(run([c]).data.stats[0]).toMatchObject({ insertions: 2, deletions: 3, lines: 5 })
  })

  test('pure rename: path is the OLD path, stat_path abbreviated, mode/src/dst empty', () => {
    const c2 = commit('c2', ['c1'], [renamed('bin/x.rb', 'lib/x.rb', 'x1', true)])
    const c1 = commit('c1', [], [added('bin/x.rb', 'x1')])
    const { data } = run([c2, c1])
    expect(data.stats[0]).toMatchObject({
      path: 'bin/x.rb',
      type: 'modified',
      src: '',
      dst: '',
      mode: '',
      bin: false,
      insertions: 0,
      deletions: 0,
      lines: 0,
      stat_path: { path: '{bin => lib}/x.rb', src: 'bin/x.rb', dst: 'lib/x.rb' },
    })
  })

  test('rename with changes: src is the old path blob, dst the new blob', () => {
    const c2 = commit('c2', ['c1'], [renamed('a.rb', 'b.rb', 'b2')])
    const c1 = commit('c1', [], [added('a.rb', 'a1')])
    const { data } = run([c2, c1])
    expect(data.stats[0]).toMatchObject({
      path: 'a.rb',
      src: 'a100000',
      dst: 'b200000',
      stat_path: { path: 'a.rb => b.rb', src: 'a.rb', dst: 'b.rb' },
    })
  })

  test('a blob that follows a pure rename links back to it (same arrow as Ruby)', () => {
    const c3 = commit('c3', ['c2'], [modified('lib/x.rb', 'x3')])
    const c2 = commit('c2', ['c1'], [renamed('bin/x.rb', 'lib/x.rb', 'x1', true)])
    const c1 = commit('c1', [], [added('bin/x.rb', 'x1')])
    const { data } = run([c3, c2, c1])
    expect(data.stats[0]).toMatchObject({ path: 'lib/x.rb', src: 'x100000' })
  })

  test('copied: new file, src 0000000, not a rename', () => {
    const c = commit(
      'c1',
      [],
      [
        file({
          filename: 'copy.rb',
          previous_filename: 'orig.rb',
          status: 'copied',
          sha: id('k1'),
        }),
      ],
    )
    expect(run([c]).data.stats[0]).toMatchObject({
      path: 'copy.rb',
      type: 'new',
      src: '0000000',
      stat_path: { path: 'copy.rb', src: 'copy.rb', dst: 'copy.rb' },
    })
  })

  test('status "renamed" without previous_filename is treated as a plain change', () => {
    const c = commit('c1', [], [file({ filename: 'a', status: 'renamed', sha: id('a1') })])
    expect(run([c]).data.stats[0]).toMatchObject({
      path: 'a',
      stat_path: { path: 'a', src: 'a', dst: 'a' },
    })
  })

  test('binary guess is applied', () => {
    const c = commit(
      'c1',
      [],
      [file({ filename: 'x.png', status: 'added', patch: undefined, changes: 0, additions: 0 })],
    )
    expect(run([c]).data.stats[0]).toMatchObject({ bin: true, insertions: 0, lines: 0 })
  })

  test('null blob sha -> empty dst', () => {
    const c = commit('c1', [], [file({ filename: 'a', status: 'added', sha: null })])
    expect(run([c]).data.stats[0]).toMatchObject({ dst: '' })
  })

  test('the same path twice in one commit is kept as two stats', () => {
    const c = commit('c1', [], [added('a', 'a1'), modified('a', 'a2')])
    expect(run([c]).data.stats).toHaveLength(2)
  })
})

describe('toGitLogData: warnings', () => {
  test('unknown-src: one warning per commit with the number of files', () => {
    const c3 = commit('c3', ['c2'], [modified('a', 'a3'), modified('b', 'b3')])
    const c2 = commit('c2', ['c1'], [modified('a', 'a2')]) // c1 is outside the range
    const { data, warnings } = run([c3, c2])
    expect(data.stats.find((s) => s.sha_short === 'c200000')!.src).toBe('')
    expect(data.stats.find((s) => s.path === 'a' && s.sha_short === 'c300000')!.src).toBe('a200000')
    expect(warnings).toEqual([
      { kind: 'unknown-src', sha: id('c3'), detail: '1 file' },
      { kind: 'unknown-src', sha: id('c2'), detail: '1 file' },
    ])
  })

  test('no unknown-src warning for added / removed / copied / pure renames', () => {
    const c = commit(
      'c2',
      ['gone'],
      [added('a', 'a1'), removed('b', 'b1'), renamed('x', 'y', 'x1', true)],
    )
    expect(run([c]).warnings).toEqual([])
  })

  test('truncated commits are reported, and src search stops there', () => {
    const c3 = commit('c3', ['c2'], [modified('f', 'b3')])
    const c2 = commit('c2', ['c1'], [modified('other', 'x2')])
    const c1 = commit('c1', [], [added('f', 'b1')])
    const { data, warnings } = run([c3, c2, c1], { truncatedShas: new Set([id('c2')]) })
    expect(data.stats[0]!.src).toBe('')
    expect(warnings).toEqual([
      { kind: 'unknown-src', sha: id('c3'), detail: '1 file' },
      { kind: 'truncated', sha: id('c2') },
      { kind: 'unknown-src', sha: id('c2'), detail: '1 file' }, // 'other' is not in c1
    ])
  })
})

describe('toGitLogData: files', () => {
  test('one entry per stat path, sorted by name; commits in stats order', () => {
    const { data } = run(chain())
    expect(data.files).toEqual([
      { name: 'a.txt', index: 1, commits: ['c300000', 'c200000', 'c100000'] },
      { name: 'b.txt', index: 2, commits: ['c300000', 'c100000'] },
    ])
  })

  test('sorted by code points (not locale): uppercase before lowercase, "x.js" before "x/a.js"', () => {
    const c = commit(
      'c1',
      [],
      [
        added('bin/z', 'z'),
        added('README.md', 'r'),
        added('Gemfile', 'g'),
        added('x/a.js', 'xa'),
        added('x.js', 'xj'),
        added('b', 'b'),
      ],
    )
    expect(run([c]).data.files.map((f) => f.name)).toEqual([
      'Gemfile',
      'README.md',
      'b',
      'bin/z',
      'x.js',
      'x/a.js',
    ])
  })

  test('the rename target gets no row from the renaming commit; the old path does', () => {
    const c2 = commit('c2', ['c1'], [renamed('bin/x.rb', 'lib/x.rb', 'x1', true)])
    const c1 = commit('c1', [], [added('bin/x.rb', 'x1')])
    const { data } = run([c2, c1])
    expect(data.files).toEqual([{ name: 'bin/x.rb', index: 1, commits: ['c200000', 'c100000'] }])
  })

  test('duplicates within a commit are kept', () => {
    const c = commit('c1', [], [added('a', 'a1'), modified('a', 'a2')])
    expect(run([c]).data.files[0]!.commits).toEqual(['c100000', 'c100000'])
  })
})

describe('compareCodePoints', () => {
  test('orders astral characters after BMP characters (unlike UTF-16 unit order)', () => {
    const astral = '\u{1F600}' // surrogate pair D83D DE00
    const bmpHigh = '～' // FULLWIDTH TILDE
    expect(astral < bmpHigh).toBe(true) // UTF-16 code unit order (wrong for Ruby)
    expect(compareCodePoints(astral, bmpHigh)).toBeGreaterThan(0)
  })
  test('prefix is smaller; equal is 0', () => {
    expect(compareCodePoints('a', 'ab')).toBeLessThan(0)
    expect(compareCodePoints('ab', 'ab')).toBe(0)
  })
})
