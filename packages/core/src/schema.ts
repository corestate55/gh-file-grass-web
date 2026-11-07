// GitLogData スキーマ(元リポジトリの public/logs.json と同一)と不変条件の検証。
// d3 や DOM に依存しないこと(adapter は `import type` のみで参照する)。

export type FileChangeType = 'new' | 'modified' | 'deleted'

export interface Author {
  name: string
  email: string
}

export interface StatTotal {
  insertions: number
  deletions: number
  lines: number
  files: number
}

export interface Commit {
  sha: string
  sha_short: string
  author: Author
  date: string
  message: string
  /** 1 = 最古, N = 最新 */
  index: number
  stat_total: StatTotal
}

export interface StatPath {
  path: string
  src: string
  dst: string
}

export interface Stat {
  /** リネーム時は「旧パス」 */
  path: string
  /** adapter では常に '' */
  mode: string
  type: FileChangeType | null
  /** 7桁 blob hash、'0000000'、または '' */
  src: string
  dst: string
  /** Ruby のルートコミットでは欠落。adapter は常に出力 */
  bin?: boolean
  stat_path: StatPath
  insertions: number
  deletions: number
  lines: number
  sha_short: string
  /** 1 = 最新コミットの先頭ファイル */
  index: number
}

export interface FileEntry {
  name: string
  index: number
  /** sha_short, 新しい順 */
  commits: string[]
}

export interface GitLogData {
  repo: string
  branch: string
  origin: string
  commits: Commit[]
  stats: Stat[]
  files: FileEntry[]
}

/** 描画側が付与する項目。入力データには存在してはならない。 */
const RENDER_ONLY_KEYS = [
  'fileIndex',
  'commitIndex',
  'modifiedClass',
  'px',
  'py',
  'logLines',
  'hist',
  'sourceIndex',
  'targetIndex',
  'source',
  'target',
] as const

export class InvariantError extends Error {
  readonly violations: string[]
  constructor(violations: string[]) {
    super(`GitLogData invariant violated:\n- ${violations.join('\n- ')}`)
    this.name = 'InvariantError'
    this.violations = violations
  }
}

const MAX_REPORTED = 20

function isConsecutiveFromOne(indexes: number[]): boolean {
  const sorted = [...indexes].sort((a, b) => a - b)
  return sorted.every((v, i) => v === i + 1)
}

/**
 * 不変条件(DESIGN.md 4.2):
 * 1. commits の index は 1..N 連番(重複なし)
 * 2. sha_short は commits 内で一意。stats/files の sha_short は commits に存在する
 * 3. stats の index は 1..M 連番(配列順 = index 昇順)
 * 4. 描画側付与項目を含まない
 * 違反があれば全件を集めて InvariantError を投げる。
 */
export function assertInvariants(data: GitLogData): void {
  const v: string[] = []
  const report = (msg: string) => {
    if (v.length < MAX_REPORTED) v.push(msg)
  }

  // 1
  if (!isConsecutiveFromOne(data.commits.map((c) => c.index))) {
    report('commits: index must be unique and consecutive from 1..N')
  }

  // 2
  const shortShas = new Set<string>()
  for (const c of data.commits) {
    if (shortShas.has(c.sha_short)) report(`commits: duplicate sha_short ${c.sha_short}`)
    shortShas.add(c.sha_short)
    if (!c.sha.startsWith(c.sha_short)) {
      report(`commits: sha_short ${c.sha_short} is not a prefix of sha ${c.sha}`)
    }
  }
  for (const s of data.stats) {
    if (!shortShas.has(s.sha_short)) report(`stats: unknown sha_short ${s.sha_short} (${s.path})`)
  }
  for (const f of data.files) {
    for (const sha of f.commits) {
      if (!shortShas.has(sha)) report(`files: unknown sha_short ${sha} (${f.name})`)
    }
  }

  // 3
  data.stats.forEach((s, i) => {
    if (s.index !== i + 1) report(`stats[${i}]: index ${s.index} !== ${i + 1}`)
  })

  // 4
  const check = (kind: string, items: object[]) => {
    items.forEach((item, i) => {
      for (const key of RENDER_ONLY_KEYS) {
        if (key in item) report(`${kind}[${i}]: render-only key '${key}' must not be present`)
      }
    })
  }
  check('commits', data.commits)
  check('stats', data.stats)
  check('files', data.files)

  if (v.length > 0) throw new InvariantError(v)
}
