import { assertInvariants } from '@gh-file-grass/core/schema'
import type { GitLogData } from '@gh-file-grass/core/schema'
import { describe, expect, test } from 'vitest'
import { toGitLogData } from '../src'
import { loadDetails, loadLogsJson } from './helpers/fixtures'

// 元 Ruby 実装の出力(logs.json)を期待値にしたゴールデンテスト。
// 入力は Step 0 で録画した実 API 応答。Ruby 版は Asia/Tokyo のローカル時刻で日付を書く。
const ref = { owner: 'corestate55', repo: 'gh-file-grass' }
const TZ = 'Asia/Tokyo'

const logs = loadLogsJson()
const convert = (k?: number) =>
  toGitLogData({ ref, branch: 'develop', commits: loadDetails(k), timeZone: TZ })

/** '2019-11-04 21:51:50 +0900' / 'Mon Nov 4 21:51:50 2019 +0900' を時刻値(ms)にする */
function instantOf(s: string): number {
  const iso = /^\d{4}-\d\d-\d\d /.test(s)
    ? s
        .replace(' ', 'T')
        .replace(' ', '')
        .replace(/(\d\d)(\d\d)$/, '$1:$2')
    : s
  const t = Date.parse(iso)
  if (Number.isNaN(t)) throw new Error(`cannot parse date: ${s}`)
  return t
}

const rootSha = logs.commits.at(-1)!.sha_short

/**
 * 正規化(設計書 6 章)。両側に同じ処理を行う。
 *  - repo / origin: Ruby はローカル .git パスと ssh URL。adapter は owner/repo と https URL
 *  - mode: API に無い。adapter は常に ''
 *  - ルートの stats.bin: Ruby のルート処理(git show)では欠落する
 *  - date: 時刻値で比較(ルートは Ruby が別書式)
 */
function normalize(data: GitLogData) {
  const rest: Partial<GitLogData> & Pick<GitLogData, 'commits' | 'stats' | 'files'> =
    structuredClone(data)
  delete rest.repo
  delete rest.origin
  return {
    ...rest,
    commits: rest.commits.map((c) => ({ ...c, date: instantOf(c.date) })),
    stats: rest.stats.map((s) => {
      const { bin, ...others } = s
      return { ...others, mode: '', ...(s.sha_short === rootSha ? {} : { bin }) }
    }),
  }
}

describe('golden: all 64 commits vs the Ruby output', () => {
  const { data, warnings } = convert()

  test('size', () => {
    expect(data.commits).toHaveLength(64)
    expect(data.stats).toHaveLength(221)
    expect(data.files).toHaveLength(38)
  })

  test('no warnings (the whole history is in range)', () => {
    expect(warnings).toEqual([])
  })

  test('satisfies the schema invariants', () => {
    expect(() => assertInvariants(data)).not.toThrow()
  })

  test('branch', () => {
    expect(data.branch).toBe(logs.branch)
  })

  test('commits are identical (sha, short sha, author, message, index, stat_total, date instant)', () => {
    expect(normalize(data).commits).toEqual(normalize(logs).commits)
  })

  test('stats are identical, in the same order, including index / src / dst / bin / stat_path', () => {
    expect(normalize(data).stats).toEqual(normalize(logs).stats)
  })

  test('files are identical (name, index, commits)', () => {
    expect(data.files).toEqual(logs.files)
  })

  test('whole document is identical after normalization', () => {
    expect(normalize(data)).toEqual(normalize(logs))
  })
})

// 実際の使い方(直近 N 件)では、範囲の端で親が範囲外になる。
describe('golden: partial ranges (newest k commits)', () => {
  const key = (s: { sha_short: string; path: string }) => `${s.sha_short}|${s.path}`
  const rubyByKey = new Map(logs.stats.map((s) => [key(s), s]))

  /** core の findAllDstOf と同じ規則で矢印 (source -> target) を導く */
  const arrows = (stats: { sha_short: string; path: string; src: string; dst: string }[]) => {
    const out = new Set<string>()
    for (const a of stats) {
      if (a.dst === '' || a.dst === '0000000') continue
      for (const b of stats) if (b.src === a.dst) out.add(`${key(a)} -> ${key(b)}`)
    }
    return out
  }
  const rubyArrows = arrows(logs.stats)

  test.each([2, 5, 10, 20, 26, 27, 50, 63])('newest %i commits', (k) => {
    const { data, warnings } = convert(k)
    expect(() => assertInvariants(data)).not.toThrow()

    // commits: Ruby と同じ先頭 k 件。index だけが k 件の範囲で振り直される
    expect(data.commits).toHaveLength(k)
    data.commits.forEach((c, i) => {
      const r = logs.commits[i]!
      expect({ ...c, index: 0, date: instantOf(c.date) }).toEqual({
        ...r,
        index: 0,
        date: instantOf(r.date),
      })
      expect(c.index).toBe(k - i)
    })

    // stats: k 件のコミットに属する Ruby の stats と 1 対 1 に対応する
    const inRange = new Set(data.commits.map((c) => c.sha_short))
    const expectedKeys = logs.stats.filter((s) => inRange.has(s.sha_short)).map(key)
    expect(data.stats.map(key)).toEqual(expectedKeys)
    data.stats.forEach((s, i) => expect(s.index).toBe(i + 1))

    const unknown = new Set(warnings.filter((w) => w.kind === 'unknown-src').map((w) => w.sha))
    const fullSha = new Map(logs.commits.map((c) => [c.sha_short, c.sha]))
    for (const s of data.stats) {
      const r = rubyByKey.get(key(s))!
      const { src, ...rest } = s
      const { src: rubySrc, ...rubyRest } = r
      // src 以外は範囲に依らず Ruby と一致する(ルートの bin / mode は正規化)
      expect({ ...rest, mode: '', bin: s.sha_short === rootSha ? 0 : rest.bin }).toEqual({
        ...rubyRest,
        mode: '',
        bin: s.sha_short === rootSha ? 0 : rubyRest.bin,
      })
      // src は Ruby と同じか、親が範囲外で '' (その場合は必ず unknown-src の warning がある)
      if (src !== rubySrc) {
        expect(src, key(s)).toBe('')
        expect(unknown.has(fullSha.get(s.sha_short)), key(s)).toBe(true)
      }
    }

    // 矢印: 範囲が狭いと減ることはあっても、Ruby に無い矢印(偽の矢印)は決して作らない
    for (const a of arrows(data.stats)) expect(rubyArrows.has(a), a).toBe(true)

    // files: 範囲内の stats から導かれる(Ruby の同じ集計と一致する)
    const names = new Set(data.stats.map((s) => s.path))
    expect(data.files.map((f) => f.name)).toEqual([...names].sort())
    for (const f of data.files) {
      const rubyFile = logs.files.find((x) => x.name === f.name)!
      expect(f.commits).toEqual(rubyFile.commits.filter((c) => inRange.has(c)))
    }
  })

  test('the oldest commit in range never invents a source blob', () => {
    const { data } = convert(10)
    const oldest = data.commits.at(-1)!.sha_short
    const modifiedInOldest = data.stats.filter(
      (s) => s.sha_short === oldest && s.type === 'modified',
    )
    // 親が範囲外なので、変更ファイルの src は不明(''。純粋リネームも '')
    expect(modifiedInOldest.every((s) => s.src === '')).toBe(true)
  })

  test('deleted files keep their src (the pre-deletion blob) even when the adding commit is out of range', () => {
    const deleted = logs.stats.filter((s) => s.type === 'deleted')
    expect(deleted.length).toBe(3)
    for (const r of deleted) {
      const position = logs.commits.findIndex((c) => c.sha_short === r.sha_short)
      // 削除コミットが最古になる範囲。追加したコミットは必ず範囲の外にある
      const { data } = convert(position + 1)
      const s = data.stats.find((x) => key(x) === key(r))!
      expect(s.src, key(r)).toBe(r.src)
      expect(s.src).not.toBe('')
      expect(s.dst).toBe('0000000')
    }
  })
})
