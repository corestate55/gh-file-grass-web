import type { GhCommitDetail, GhCommitFile } from '../../src/github-types'

/** 短い識別子を 40 桁の sha にする('c1' -> 'c1000…0') */
export const id = (short: string): string => short.padEnd(40, '0')

export const file = (over: Partial<GhCommitFile> & { filename: string }): GhCommitFile => ({
  sha: id('b0'),
  status: 'modified',
  additions: 1,
  deletions: 0,
  changes: 1,
  patch: '@@',
  ...over,
})

export const added = (filename: string, blob: string): GhCommitFile =>
  file({ filename, status: 'added', sha: id(blob) })
export const modified = (filename: string, blob: string): GhCommitFile =>
  file({ filename, status: 'modified', sha: id(blob) })
/** removed の sha は「削除前」の blob */
export const removed = (filename: string, blobBefore: string): GhCommitFile =>
  file({ filename, status: 'removed', sha: id(blobBefore) })
export const renamed = (from: string, to: string, blob: string, pure = false): GhCommitFile =>
  file({
    filename: to,
    previous_filename: from,
    status: 'renamed',
    sha: id(blob),
    ...(pure ? { changes: 0, additions: 0, patch: undefined } : {}),
  })

export function commit(
  short: string,
  parents: string[],
  files: GhCommitFile[] | undefined,
  over: Partial<GhCommitDetail> = {},
): GhCommitDetail {
  return {
    sha: id(short),
    commit: {
      author: { name: 'author', email: 'author@example.com', date: '2022-05-02T14:21:38Z' },
      committer: {
        name: 'committer',
        email: 'committer@example.com',
        date: '2022-05-02T14:21:38Z',
      },
      message: `message of ${short}`,
    },
    parents: parents.map((p) => ({ sha: id(p) })),
    ...(files ? { files } : {}),
    ...over,
  }
}
