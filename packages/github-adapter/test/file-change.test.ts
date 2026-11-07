import { describe, expect, test } from 'vitest'
import { EMPTY_BLOB_SHA, guessBinary, toChangeType } from '../src/file-change'
import type { GhCommitFile } from '../src/github-types'
import { loadDetails, loadLogsJson } from './helpers/fixtures'

const file = (over: Partial<GhCommitFile> = {}): GhCommitFile => ({
  sha: 'a'.repeat(40),
  filename: 'f',
  status: 'modified',
  additions: 0,
  deletions: 0,
  changes: 0,
  ...over,
})

describe('toChangeType', () => {
  test.each([
    ['added', 'new'],
    ['copied', 'new'],
    ['removed', 'deleted'],
    ['modified', 'modified'],
    ['changed', 'modified'],
    ['unchanged', 'modified'],
    ['renamed', 'modified'],
    ['something-new', 'modified'],
  ])('%s -> %s', (status, expected) => {
    expect(toChangeType(status)).toBe(expected)
  })
})

describe('guessBinary', () => {
  test.each([
    ['no patch, no changes (binary add)', file({ status: 'added' }), true],
    ['no patch, no changes (binary modify)', file(), true],
    ['no patch, no changes (binary delete)', file({ status: 'removed' }), true],
    ['pure rename', file({ status: 'renamed' }), false],
    ['empty blob', file({ status: 'added', sha: EMPTY_BLOB_SHA }), false],
    ['with patch', file({ patch: '@@', changes: 1, additions: 1 }), false],
    ['patch omitted for a huge text diff', file({ changes: 31208, additions: 30000 }), false],
    ['null sha', file({ sha: null }), true],
  ])('%s', (_name, f, expected) => {
    expect(guessBinary(f)).toBe(expected)
  })
})

describe('against the recorded fixtures', () => {
  const logs = loadLogsJson()
  const details = loadDetails()
  const rubyStat = (sha: string, f: GhCommitFile) =>
    logs.stats.find(
      (s) => s.sha_short === sha.slice(0, 7) && s.path === (f.previous_filename ?? f.filename),
    )

  test('type matches Ruby for every file (including the root commit)', () => {
    let n = 0
    for (const d of details) {
      for (const f of d.files ?? []) {
        expect(toChangeType(f.status), `${d.sha.slice(0, 7)} ${f.filename}`).toBe(
          rubyStat(d.sha, f)?.type,
        )
        n++
      }
    }
    expect(n).toBe(logs.stats.length)
  })

  test('bin matches Ruby for every non-root file; exactly 5 binaries', () => {
    let binaries = 0
    for (const d of details.slice(0, -1)) {
      for (const f of d.files ?? []) {
        const expected = rubyStat(d.sha, f)?.bin
        expect(guessBinary(f), `${d.sha.slice(0, 7)} ${f.filename}`).toBe(expected)
        if (expected) binaries++
      }
    }
    expect(binaries).toBe(5)
  })
})
