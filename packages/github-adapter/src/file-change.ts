import type { FileChangeType } from '@gh-file-grass/core/schema'
import type { GhCommitFile } from './github-types'

/** 空ファイルの blob sha(`git hash-object /dev/null`) */
export const EMPTY_BLOB_SHA = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'

/**
 * GitHub の status → スキーマの type。
 * renamed は Ruby 版と同じく `modified`(リネームかどうかは stat_path の src/dst で表す)。
 * copied はコピー先を新規ファイルとして扱う。未知の値は `modified`。
 */
export function toChangeType(status: string): FileChangeType {
  switch (status) {
    case 'added':
    case 'copied':
      return 'new'
    case 'removed':
      return 'deleted'
    default:
      return 'modified'
  }
}

/**
 * バイナリ推定。API に binary フラグが無いため、git の numstat が `- -`(= 行数 0)になる
 * ファイルは patch が付かないことを手がかりにする。
 *  - patch が無く changes === 0
 *  - 純粋リネーム(同様に patch/changes が 0)は除く
 *  - 空ファイルの追加・削除も patch が無いので除く
 * 巨大差分で patch が省略されたテキストは changes > 0 なので対象外(Step 0 ⑥)。
 * モード変更のみのコミットは誤判定の余地がある(許容)。
 */
export function guessBinary(f: GhCommitFile): boolean {
  return (
    f.patch === undefined && f.changes === 0 && f.status !== 'renamed' && f.sha !== EMPTY_BLOB_SHA
  )
}
