import type { Author, Commit, GitLogData, Stat } from '@gh-file-grass/core/schema'
import { createSrcResolver } from './blob-history'
import { formatGitDate } from './date'
import { guessBinary, toChangeType } from './file-change'
import type { GhCommitDetail, GhCommitFile } from './github-types'
import { formatRenamePath } from './rename'
import type { RepoRef, Warning } from './types'

const ZERO_BLOB = '0000000'

export interface ToGitLogDataInput {
  ref: RepoRef
  branch: string
  /** 新しい順(一覧 API の順)。各コミットは第一親との差分を持つ詳細 API の応答 */
  commits: readonly GhCommitDetail[]
  /** 日付の書式に使う IANA タイムゾーン名。省略時は実行環境の既定。不正な値は RangeError */
  timeZone?: string
  /** files が 1 ページ目で切り詰められたコミット(判定は取得側が行う) */
  truncatedShas?: ReadonlySet<string>
}

export interface ToGitLogDataResult {
  data: GitLogData
  warnings: Warning[]
}

/** 範囲内で sha_short が重複した(commits/stats/files の結合キーが壊れる) */
export class ShaShortCollisionError extends Error {
  readonly shaShort: string
  constructor(shaShort: string) {
    super(`sha_short collision within the range: ${shaShort}`)
    this.name = 'ShaShortCollisionError'
    this.shaShort = shaShort
  }
}

const shortOf = (sha: string) => sha.slice(0, 7)

/** Ruby の文字列比較と同じ、コードポイント順(UTF-16 コード単位順とはサロゲートペアで異なる) */
export function compareCodePoints(a: string, b: string): number {
  const ia = a[Symbol.iterator]()
  const ib = b[Symbol.iterator]()
  for (;;) {
    const x = ia.next()
    const y = ib.next()
    if (x.done && y.done) return 0
    if (x.done) return -1
    if (y.done) return 1
    const d = x.value.codePointAt(0)! - y.value.codePointAt(0)!
    if (d !== 0) return d
  }
}

function toAuthor(c: GhCommitDetail): Author {
  // git メタデータの author を使う(GitHub ユーザーの author は null があり得るので使わない)
  const actor = c.commit.author ?? c.commit.committer
  if (!actor) return { name: 'unknown', email: '' }
  return { name: actor.name ?? '', email: actor.email ?? '' }
}

function toDate(c: GhCommitDetail, timeZone: string | undefined): string {
  // Ruby(ruby-git)の date は committer の日付(Step 0 ⑨)
  const iso = c.commit.committer?.date ?? c.commit.author?.date
  return iso ? formatGitDate(iso, timeZone) : ''
}

const isRenamedFile = (f: GhCommitFile) =>
  f.status === 'renamed' && f.previous_filename !== undefined
const isPureRename = (f: GhCommitFile) => isRenamedFile(f) && f.changes === 0

export function toGitLogData(input: ToGitLogDataInput): ToGitLogDataResult {
  const { ref, branch, commits: details, timeZone, truncatedShas } = input
  const warnings: Warning[] = []
  const resolveSrc = createSrcResolver(details, truncatedShas ? { truncatedShas } : {})

  // --- commits(配列は新しい順、index は最新 = N, 最古 = 1) ---
  const seen = new Set<string>()
  const commits: Commit[] = details.map((c, i) => {
    const shaShort = shortOf(c.sha)
    if (seen.has(shaShort)) throw new ShaShortCollisionError(shaShort)
    seen.add(shaShort)

    const files = c.files ?? []
    const insertions = c.stats?.additions ?? files.reduce((n, f) => n + f.additions, 0)
    const deletions = c.stats?.deletions ?? files.reduce((n, f) => n + f.deletions, 0)
    return {
      sha: c.sha,
      sha_short: shaShort,
      author: toAuthor(c),
      date: toDate(c, timeZone),
      message: c.commit.message,
      index: details.length - i,
      stat_total: { insertions, deletions, lines: insertions + deletions, files: files.length },
    }
  })

  // --- stats(新しいコミットから順に、各コミットのファイルを API の順で平坦化。index は 1 始まり) ---
  const stats: Stat[] = []
  for (const c of details) {
    const shaShort = shortOf(c.sha)
    if (truncatedShas?.has(c.sha)) warnings.push({ kind: 'truncated', sha: c.sha })

    let unknownSrc = 0
    for (const f of c.files ?? []) {
      const renamed = isRenamedFile(f)
      const pure = isPureRename(f)
      const path = renamed ? f.previous_filename! : f.filename

      // 出力 dst: 削除は 0000000、純粋リネームは ''(Ruby に合わせる)、他は変更後 blob
      const dst = f.status === 'removed' ? ZERO_BLOB : pure || !f.sha ? '' : f.sha.slice(0, 7)

      let src: string
      if (pure) src = ''
      else if (f.status === 'added' || f.status === 'copied') src = ZERO_BLOB
      else if (f.status === 'removed')
        src = f.sha ? f.sha.slice(0, 7) : '' // removed の sha は削除前の blob
      else {
        const blob = resolveSrc(c, path)
        if (blob) src = blob.slice(0, 7)
        else {
          src = ''
          unknownSrc++
        }
      }

      stats.push({
        path,
        mode: '',
        type: toChangeType(f.status),
        src,
        dst,
        bin: guessBinary(f),
        stat_path: renamed
          ? { path: formatRenamePath(path, f.filename), src: path, dst: f.filename }
          : { path: f.filename, src: f.filename, dst: f.filename },
        insertions: f.additions,
        deletions: f.deletions,
        lines: f.additions + f.deletions,
        sha_short: shaShort,
        index: stats.length + 1,
      })
    }
    if (unknownSrc > 0) {
      warnings.push({
        kind: 'unknown-src',
        sha: c.sha,
        detail: `${unknownSrc} file${unknownSrc > 1 ? 's' : ''}`,
      })
    }
  }

  // --- files(stats.path ごとに sha_short を stats 順に集め、名前順。リネーム先の行には含まれない) ---
  const commitsOfFile = new Map<string, string[]>()
  for (const s of stats) {
    const list = commitsOfFile.get(s.path)
    if (list) list.push(s.sha_short)
    else commitsOfFile.set(s.path, [s.sha_short])
  }
  const files = [...commitsOfFile.keys()].sort(compareCodePoints).map((name, i) => ({
    name,
    index: i + 1,
    commits: commitsOfFile.get(name)!,
  }))

  return {
    data: {
      repo: `${ref.owner}/${ref.repo}`,
      branch,
      origin: `https://github.com/${ref.owner}/${ref.repo}`,
      commits,
      stats,
      files,
    },
    warnings,
  }
}
