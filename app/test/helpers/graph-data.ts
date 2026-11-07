import type { GitLogData } from '@gh-file-grass/core'

const commit = (short: string, index: number, files: number) => ({
  sha: short.padEnd(40, '0'),
  sha_short: short,
  author: { name: 'Ann', email: 'ann@example.com' },
  date: '2022-05-02 23:21:38 +0900',
  message: `commit ${short}`,
  index,
  stat_total: { insertions: files * 3, deletions: files, lines: files * 4, files },
})

const stat = (
  index: number,
  sha_short: string,
  path: string,
  type: 'new' | 'modified',
  src: string,
  dst: string,
) => ({
  path,
  mode: '',
  type,
  src,
  dst,
  bin: false,
  stat_path: { path, src: path, dst: path },
  insertions: 3,
  deletions: type === 'new' ? 0 : 1,
  lines: type === 'new' ? 3 : 4,
  sha_short,
  index,
})

/** 3 コミット・2 ファイル・4 変更の小さなデータ(core の draw にそのまま渡せる) */
export function sampleData(branch = 'main'): GitLogData {
  return {
    repo: 'o/r',
    branch,
    origin: 'https://github.com/o/r',
    commits: [commit('c300000', 3, 1), commit('c200000', 2, 1), commit('c100000', 1, 2)],
    stats: [
      stat(1, 'c300000', 'a.txt', 'modified', 'a200000', 'a300000'),
      stat(2, 'c200000', 'a.txt', 'modified', 'a100000', 'a200000'),
      stat(3, 'c100000', 'a.txt', 'new', '0000000', 'a100000'),
      stat(4, 'c100000', 'b.txt', 'new', '0000000', 'b100000'),
    ],
    files: [
      { name: 'a.txt', index: 1, commits: ['c300000', 'c200000', 'c100000'] },
      { name: 'b.txt', index: 2, commits: ['c100000'] },
    ],
  }
}

/** 先頭 n コミットだけにした版 */
export function smallerData(): GitLogData {
  const d = sampleData('dev')
  return {
    ...d,
    commits: d.commits.slice(1),
    stats: d.stats.slice(1).map((s, i) => ({ ...s, index: i + 1 })),
    files: d.files.map((f) => ({ ...f, commits: f.commits.slice(1) })),
  }
}

export const noChanges = (): GitLogData => ({ ...sampleData(), stats: [], files: [] })
