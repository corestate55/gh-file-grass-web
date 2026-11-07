import type { GhCommitDetail } from './github-types'

/**
 * 「このコミットがパス `path` に対して差分を取った相手(= 第一親側)の blob」を返す。
 * 40 桁の sha、または不明なら null。
 */
export type SrcResolver = (commit: GhCommitDetail, path: string) => string | null

export interface SrcResolverOptions {
  /** files が 1 ページ目で切り詰められているコミット。ここに当たったら探索を打ち切る */
  truncatedShas?: ReadonlySet<string>
}

/** コミット後のパス → blob。null は「そのコミットで存在しなくなった(または不明)」 */
type BlobMap = Map<string, string | null>

/**
 * 各コミットは第一親との差分なので、第一親チェーンを遡って最初にそのパスに触れたコミットの
 * 「変更後 blob」が、後続コミットの src になる。
 *
 * - 辿るのは必ず `parents[0]` の sha で、`commits` 配列上の隣ではない(一覧順は親子順とは限らない)。
 * - `removed` の blob は「削除前」なので、変更後の blob としては数えない(= null)。
 * - リネームは旧パスを null、新パスを実 blob にする。同じコミットで旧パスが追加し直された場合は
 *   追加を優先するため、2 パスに分けて書き込む。
 * - 範囲外・親なし・循環・切り詰めコミットで、パスが見つからなければ null。
 */
export function createSrcResolver(
  commits: readonly GhCommitDetail[],
  options: SrcResolverOptions = {},
): SrcResolver {
  const bySha = new Map(commits.map((c) => [c.sha, c]))
  const cache = new Map<string, BlobMap>()
  const truncated = options.truncatedShas

  const blobMapOf = (commit: GhCommitDetail): BlobMap => {
    let map = cache.get(commit.sha)
    if (map) return map
    map = new Map()
    const files = commit.files ?? []
    for (const f of files) {
      if (f.status === 'removed') map.set(f.filename, null)
      else if (f.status === 'renamed' && f.previous_filename !== undefined) {
        map.set(f.previous_filename, null)
      }
    }
    for (const f of files) {
      if (f.status !== 'removed') map.set(f.filename, f.sha)
    }
    cache.set(commit.sha, map)
    return map
  }

  return (commit, path) => {
    const visited = new Set<string>([commit.sha])
    let parentSha = commit.parents[0]?.sha
    while (parentSha !== undefined && !visited.has(parentSha)) {
      visited.add(parentSha)
      const parent = bySha.get(parentSha)
      if (!parent) return null // 範囲外
      const map = blobMapOf(parent)
      if (map.has(path)) return map.get(path) ?? null
      if (truncated?.has(parent.sha)) return null // files が欠けている: 先へ進むと古い blob を拾う
      parentSha = parent.parents[0]?.sha
    }
    return null
  }
}
