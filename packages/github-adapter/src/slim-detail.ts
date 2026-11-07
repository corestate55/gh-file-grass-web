import type { GhCommitDetail, GhCommitFile, GhGitActor } from './github-types'

const actor = (a: GhGitActor | null): GhGitActor | null =>
  a === null
    ? null
    : {
        ...(a.name === undefined ? {} : { name: a.name }),
        ...(a.email === undefined ? {} : { email: a.email }),
        ...(a.date === undefined ? {} : { date: a.date }),
      }

const file = (f: GhCommitFile): GhCommitFile => ({
  sha: f.sha,
  filename: f.filename,
  status: f.status,
  additions: f.additions,
  deletions: f.deletions,
  changes: f.changes,
  // patch 本文は使わない(`guessBinary` が見るのは有無だけ)。メモリを大きく節約できる
  ...(f.patch === undefined ? {} : { patch: '' }),
  ...(f.previous_filename === undefined ? {} : { previous_filename: f.previous_filename }),
})

/**
 * キャッシュに入れる射影。`toGitLogData` が使うフィールドだけを新しいオブジェクトに写す。
 *  - patch 本文を捨てる(300 ファイル × 500 件を保持するとメモリが膨らむ)
 *  - API の生の応答オブジェクトを共有しないので、外から書き換えてもキャッシュは汚れない
 */
export function toCachedDetail(d: GhCommitDetail): GhCommitDetail {
  return {
    sha: d.sha,
    commit: {
      author: actor(d.commit.author),
      committer: actor(d.commit.committer),
      message: d.commit.message,
    },
    parents: d.parents.map((p) => ({ sha: p.sha })),
    ...(d.stats === undefined
      ? {}
      : {
          stats: {
            additions: d.stats.additions,
            deletions: d.stats.deletions,
            total: d.stats.total,
          },
        }),
    ...(d.files === undefined ? {} : { files: d.files.map(file) }),
  }
}
