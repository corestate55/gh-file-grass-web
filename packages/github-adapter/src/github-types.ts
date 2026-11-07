// GitHub REST API (GET /repos/{o}/{r}/commits/{sha}) の応答のうち、変換に使う部分だけの型。
// 構造的部分型なので、API の生 JSON をそのまま渡せる。
// 使わないもの: トップレベルの author/committer(GitHub ユーザー。null あり)、各種 URL、tree、verification。

export interface GhGitActor {
  name?: string | null
  email?: string | null
  date?: string | null
}

export interface GhCommitFile {
  /** ファイルの blob sha。removed では「削除前」の blob(Step 0 ④) */
  sha: string | null
  filename: string
  /** 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged' など */
  status: string
  additions: number
  deletions: number
  changes: number
  /** バイナリ・巨大差分・純粋リネームでは欠落する */
  patch?: string
  /** renamed(と copied)のみ */
  previous_filename?: string
}

export interface GhCommitDetail {
  sha: string
  commit: {
    author: GhGitActor | null
    committer: GhGitActor | null
    message: string
  }
  parents: { sha: string }[]
  stats?: { additions: number; deletions: number; total: number }
  files?: GhCommitFile[]
}
