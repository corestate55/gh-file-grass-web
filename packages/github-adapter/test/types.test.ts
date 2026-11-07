import { expect, test } from 'vitest'
import type { GitLogData } from '@gh-file-grass/core/schema'

// 型だけを参照する(実行時の依存は無い)ことと、プロジェクト参照が通ることの確認
test('core schema types are importable from the adapter', () => {
  const empty: GitLogData = { repo: '', branch: '', origin: '', commits: [], stats: [], files: [] }
  expect(empty.commits).toEqual([])
})
