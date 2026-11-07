# gh-file-grass-web 詳細設計

元リポジトリ: `gh-file-grass`(Ruby コレクタ + Vue3/d3 ビジュアライザ)。本書はその設計調査(2026-11-07)に基づく。

凡例: **【事実】** = 元リポジトリのコードや `public/logs.json` を読んで確認済み。**【要検証】** = 未確認(主に GitHub API の挙動)。Step 0 で確かめる。

---

## 1. 目的と要求

- GitHub Pages だけで動く静的 SPA。入力は公開リポジトリの URL または `owner/repo`。ブランチを選び、直近 N 件の変更履歴を「file grass」(x=コミット、y=ファイル、セル色=変更行数)で表示する。
- データ取得は未認証の GitHub REST API のみ(60 req/h)。データは保存しない(メモリのみ)。トークン入力欄は付けない。公開リポジトリ限定。
- **N の既定値は 20**(動作確認が済むまで。上限 50。徐々に調整する)。
- npm workspaces のモノレポ、全て TypeScript。
  - `packages/core`: d3 描画。Vue 非依存。`draw(data, {container})`
  - `packages/github-adapter`: GitHub API 応答 → 既存 `logs.json` スキーマ
  - `app`: Vite + Vue 3 + sass
  - GitHub Actions で Pages にデプロイ
- 出力スキーマは現行 `public/logs.json` と同一にし、既存描画ロジックを再利用する。
- 非機能: レート制限内で使える / 任意リポジトリのデータを扱うので XSS 対策必須 / 再描画・破棄を繰り返しても安定。

## 2. 元実装の分析(事実)

### 2.1 データ生成(Ruby)

- `bin/log_collector.rb` → `GitLog.new(repo, count).to_data` を JSON 出力。同梱 `public/logs.json` は全履歴 64 コミット(最新 `d64a81b`=index 64、ルート `266cba1`=index 1)、stats 221 件。
- ルート以外: `git.diff(parent.sha, sha)`(`git_log_entry.rb:10`)。parent は第一親。マージも第一親との差分。
- ルートコミットは `git show` を `GitShowParser` で別ロジック処理し末尾に追加(`git_log.rb:18-22, 65-72`)。

### 2.2 描画側

- 継承チェーン `GHFileGrassBase → Builder → BarChartBuilder → Operator → GHFileGrass`。`draw(logUrl)` が順にメソッド呼び出し(`gh_file_grass.js:4-26`)。
- `base.js:1,31` で `d3-fetch` の `json(logUri)`。使うキーは `branch, origin, files, commits, stats` のみ(`repo` は未使用)。
- 固定 DOM ID 依存: `#gh-file-grass`(`base.js:102`)、`div#stat-tooltip`、`document.getElementById`(`operator.js:56,66,74`)、clipPath ID(`base.js:92`)、`file1-label` 等 → 1 ページ 1 インスタンスしか置けない。
- **XSS**: ツールチップが `.html(htmlStr)`(`operator.js:66-70`)。commit message/author(`commit.js:29-32`)、ファイルパス/`stat_path.path`(`stat.js:50-59`)が無エスケープ。
- 入力破壊: `_px/_py`(`base.js:18-28`)が入力の `px/py` を書き換える(`files.js:3-4`, `builder.js:54-55`)。
- `console.log` 残り: `stats.js:48-50`。
- `-Infinity`: `chart_builder.js:22`(`log10(0)`)、`:31,65`(空配列 `Math.max`)、`files.js:10`。
- `_ghUri`(`builder.js:34-41`): `git@host:path` → `https://host/path`、https はそのまま。パスの URL エンコード無し。
- SCSS が `text/rect/code/path` など全体セレクタ(`file_grass.scss`)。

## 3. 設計方針

| 項目       | 方針                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| core 移植  | 継承チェーン・メソッド構成をそのまま TS 化し、データ注入・コンテナ指定・破棄・XSS 対策・入力複製のみ追加。リファクタは最小限    |
| スキーマ型 | `packages/core/src/schema.ts`(d3 を import しない)。サブパス `@gh-file-grass/core/schema` で公開、adapter は `import type` のみ |
| adapter    | (a) 純粋変換 `toGitLogData`(fetch しない)と (b) 取得クライアントに分離                                                          |
| 並列制御   | 自前セマフォ(既定 4)                                                                                                            |
| キャッシュ | commit 詳細を `owner/repo@sha` キーで保持(上限約 500)。ブランチ/commit 一覧は TTL 5 分                                          |
| テスト     | vitest(workspace)。core は happy-dom か jsdom                                                                                   |

却下案: 型を独立パッケージにする(規模的に過剰、未決事項 8 参照)/ core を関数型に作り直す(差分が大きく「再利用」要件に反する)。

## 4. スキーマとマッピング

### 4.1 型定義

```ts
// packages/core/src/schema.ts
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
  index: number // 1 = 最古, N = 最新
  stat_total: StatTotal
}
export interface StatPath {
  path: string
  src: string
  dst: string
}
export interface Stat {
  path: string // リネーム時は「旧パス」
  mode: string // adapter では常に ''
  type: FileChangeType | null
  src: string
  dst: string // 7桁 blob hash、'0000000'、または ''
  bin?: boolean // Ruby のルートコミットでは欠落。adapter は常に出力
  stat_path: StatPath
  insertions: number
  deletions: number
  lines: number
  sha_short: string
  index: number // 1 = 最新コミットの先頭ファイル
}
export interface FileEntry {
  name: string
  index: number
  commits: string[] /* sha_short, 新しい順 */
}
export interface GitLogData {
  repo: string
  branch: string
  origin: string
  commits: Commit[]
  stats: Stat[]
  files: FileEntry[]
}
```

### 4.2 Ruby 生成規則との対応(事実)

| フィールド                   | Ruby の規則                                                                                                                                                                | adapter の規則                                                                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repo`                       | ローカル .git パス(描画未使用)                                                                                                                                             | `"owner/repo"`                                                                                                                                                                               |
| `branch`                     | 現在のローカルブランチ                                                                                                                                                     | 選択したブランチ名                                                                                                                                                                           |
| `origin`                     | `remote.origin.url` から `.git` 除去                                                                                                                                       | `https://github.com/{owner}/{repo}`                                                                                                                                                          |
| commits 並び                 | 配列は新しい順、`index = length - i`(最新=N、最古=1)。描画側が index 昇順に並べ替え(`commits.js:15-17`)                                                                    | 同じ。index は 1..N 連番                                                                                                                                                                     |
| `sha_short`                  | `sha[0,7]`                                                                                                                                                                 | 同じ                                                                                                                                                                                         |
| `author`                     | `log.author.name/email`                                                                                                                                                    | `commit.author`(git メタデータ)。欠落時 `committer`、それも無ければ `{name:'unknown',email:''}`。GitHub ユーザーの `author`(null あり)は使わない                                             |
| `date`                       | `Time#to_s`(実行マシンのローカル TZ)例 `2022-05-02 23:21:38 +0900`                                                                                                         | 同形式 `YYYY-MM-DD HH:MM:SS +HHMM`。author/committer どちらの日付かは Step 0 で確定(ruby-git の `date` は committer_date の別名と推測)                                                       |
| `message`                    | 全文(ルートは最後の 1 行のみ=実質バグ)                                                                                                                                     | 全文                                                                                                                                                                                         |
| `stat_total`                 | `diff.stats[:total]`                                                                                                                                                       | `{insertions: stats.additions, deletions: stats.deletions, lines: stats.total, files: files.length}`。`commit.stats` 無ければ files 合計                                                     |
| stats 並び                   | 新しいコミットから順に各コミットのファイルを diff 順で平坦化、`index = i+1`(**1=最新**)。ルートは末尾に追加して振り直し                                                    | 新しい順に処理して連番                                                                                                                                                                       |
| `stats.path`                 | `diff_file.path`(**リネーム時は旧パス**)                                                                                                                                   | `previous_filename ?? filename`                                                                                                                                                              |
| `stats.type`                 | new/modified/deleted。**リネームは `modified`**                                                                                                                            | 4.3 の表                                                                                                                                                                                     |
| `mode`                       | `100644` 等。純粋リネームは `""`                                                                                                                                           | `''` 固定(API に無い)                                                                                                                                                                        |
| `src/dst`                    | `index` 行の 7 桁 blob。新規 src=`0000000`、削除 dst=`0000000`。**純粋リネームは両方 `""`**                                                                                | 4.3 で再構成                                                                                                                                                                                 |
| `bin`                        | `binary?`                                                                                                                                                                  | 推定(4.3)                                                                                                                                                                                    |
| `stat_path`                  | 通常は 3 つとも同じパス。リネーム時 path は git 短縮表記(`{bin => lib}/x.rb`、`bin/{a.rb => b.rb}`、`a.rb => bin/a.rb` の 3 形式が fixture にある)、src=旧パス、dst=新パス | git の `pprint_rename` と同規則                                                                                                                                                              |
| `insertions/deletions/lines` | numstat。バイナリは 0。`lines = ins + del`                                                                                                                                 | additions/deletions、和                                                                                                                                                                      |
| `files`                      | stats.path ごとに sha_short を stats 順で集め、**名前でソート**して `index = i+1`                                                                                          | 同じ。ソートは**コードポイント順**(Ruby の文字列比較と同じ。UTF-16 コード単位順とはサロゲートペアで異なる)。`localeCompare` 禁止(fixture では `Gemfile/LICENSE/README.md` が `bin/…` より前) |
| リネーム先ファイル行         | stats.path が旧パスなので、新パス行に**リネームしたコミットは含まれない**(例 `lib/git_show_parser.rb` に `dd63220` 無し)                                                   | 同挙動を再現                                                                                                                                                                                 |

**描画側が付与する項目(adapter は出力禁止)**: stats の `fileIndex/commitIndex/modifiedClass/px/py`、commits/files の `px/py`、`GHLogCommit/GHLogStat` ラッパー、`logLines/hist`、矢印データ `sourceIndex/targetIndex/source/target`。

**adapter の不変条件**

1. commit の index は 1..N 連番(`commits.indexOf` が位置=index を前提、`commits.js:19-21`)
2. `sha_short` は範囲内で一意(commits/stats/files の結合キー)
3. stats の index は最新コミットから 1..M 連番
4. 描画側付与項目は出力しない

### 4.3 GitHub API → スキーマ変換仕様

**status マッピング**(status 値自体は【要検証】)

| GitHub status                    | type       | stats.path          | stat_path                     |
| -------------------------------- | ---------- | ------------------- | ----------------------------- |
| `added`                          | `new`      | filename            | 3 つとも filename             |
| `removed`                        | `deleted`  | filename            | 同上                          |
| `modified`/`changed`/`unchanged` | `modified` | filename            | 同上                          |
| `renamed`                        | `modified` | `previous_filename` | path=短縮表記、src=旧、dst=新 |
| `copied`                         | `new`      | filename            | 同上(コピー元は無視)          |

**リネーム短縮表記**: 共通の先頭・末尾を `/` 境界で切り出し `{旧 => 新}`。共通部が無ければ `旧 => 新`。fixture の 3 形式を単体テストにする。

**src/dst 再構成**(矢印に直結する最重要部)

- 矢印は `findAllDstOf`(`d.src === stat.dst` かつ dst が `''`/`0000000` でない、`stats.js:24-29`)で作られる【事実】。
- API の files[] の blob は `sha` のみ。`removed` の `sha` は**削除前の blob**(Step 0 ④で確認)。それ以外は変更後の blob。
  1. `dst`: `removed` なら `0000000`、他は `sha.slice(0,7)`。内部の `blobAfter` は、`removed` では「存在しない」(null)として扱い、`sha` を入れない(後続コミットの src に誤って使われるため)。
  2. `src`: `added/copied` なら `0000000`。**`removed` は API の `sha`(削除前の blob)をそのまま使う**(Step 0 ④・Step 5 で Ruby と一致を確認。範囲端でも欠けない)。それ以外は対象パス(リネームなら旧パス)について、**範囲内の第一親チェーンを遡り**、最初にそのパスに触れたコミットの `blobAfter`。リネームで触れた場合は新パス側として数える。無ければ(範囲外)`''` とし、コミットごとに `unknown-src` の warning を 1 件出す。チェーンは必ず `parents[0]` の sha で辿る(一覧順の隣ではない。dependabot の 7 件は第一親が一覧で離れている)。files が切り詰められたコミットに当たったら探索を打ち切る。
     - 根拠: 各コミットは第一親との差分なので、第一親チェーンの差分の積み重ねがツリー状態になる。
  3. 純粋リネーム(`renamed` かつ `changes === 0`)は出力の `mode/src/dst` を `''` にして Ruby に合わせる。内部 `blobAfter` は実 sha を保持(後続コミットの src が一致し、Ruby と同じ矢印になる)。
- 詳細 API の応答に `parents` が含まれるため、一覧 API の `parents[]` を保持する必要は無い。

**バイナリ(patch 無し)**【推測】: `bin = patch === undefined && changes === 0 && status !== 'renamed' && sha !== 空blob(e69de29…)`。巨大差分省略・モード変更のみでも patch は無いので誤判定の余地あり。ルールをテストで固定する。

**300 ファイル超**【要検証】: 詳細 API は 1 ページ 300 件、Link ヘッダで最大 3000 件。1 ページ目のみ使用し `warnings` に `{kind:'truncated', sha}`。

**マージコミット**: 詳細 API の files が第一親との差分であることを期待【要検証】。違えば `compare/{parent0}...{sha}`(同じ 1 リクエスト)。

**ルートコミット**: 範囲内にあれば他と同じ規則(全ファイル `added` の想定)。Ruby 固有の癖(メッセージ最後の 1 行、日付形式、`bin` 欠落)は再現しない。テストでは正規化して比較。※実測では、ルートの type は null ではなく `new`、メッセージも 1 行で一致した(Step 5)。

**commit の並び順**【要検証・大リスク】: 一覧 API の順と ruby-git の `git log` 順が一致するか不明(fixture に 2021-03-20 のマージや dependabot が入り組む)。ずれると全 index がずれる。Step 0 で確認し、API 順のまま使うか並べ替えるか決める。

### 4.4 core の変更点と公開 API

1. **データ注入**: `_initialize(logUri)` → `_initialize(data: GitLogData)`。`d3-fetch` 依存除去。冒頭で `structuredClone(data)`(呼び出し側/adapter キャッシュを汚さない)。
2. `console.log` 削除(`stats.js:48-50`)。
3. **コンテナ指定**: `select('#gh-file-grass')` → `select(container)`。ツールチップ div は core がコンテナ内に生成。`#stat-tooltip`/`document.getElementById` はコンテナ内クエリに。clipPath/ラベル/グラフの ID にインスタンス接頭辞(`gfg{n}-`)。
4. **ツールチップ位置**: `window.pageXOffset + getScreenCTM` をやめ、コンテナ `position:relative` + `getBoundingClientRect` 差分でコンテナ内座標を算出。
5. **XSS 対策(必須)**: `tooltipHtml` で message/author/email/path/stat_path.path/sha/date を全て `escapeHtml()`。固定の SVG マークアップは対象外。
6. **GitHub URL**: `_ghUri` の origin 変換は残す。ブランチ名とパスは `/` 区切りの各要素を `encodeURIComponent`(`#?%` 空白対策)。※既存挙動の小変更。
7. **-Infinity 防止**: `logLines` は `lines > 0` のときのみ計算、他は 0。`Math.max(0, ...arr)`。`maxFileNameLength` も下限 0。stats 空なら空状態を描画(または app 側で「変更なし」表示)。
8. **`destroy()`**: svg とツールチップ要素を削除し参照解放(d3 リスナーは要素ごと消えるので `.on(x,null)` 不要)。
9. **SCSS**: `.gh-file-grass` 配下にスコープ化。全体セレクタ廃止。`@gh-file-grass/core/style.css` として配布。

```ts
export interface DrawOptions {
  container: HTMLElement
}
export interface FileGrassHandle {
  destroy(): void
}
export function draw(data: GitLogData, options: DrawOptions): FileGrassHandle
export type * from './schema'
```

再描画は呼び出し側が `destroy()` → `draw()`。

### 4.5 adapter のインタフェース

```ts
export interface RepoRef {
  owner: string
  repo: string
}
export function parseRepoInput(input: string): RepoRef // InvalidInputError
// 受理: owner/repo, https://github.com/o/r(.git)(/tree/…), github.com/o/r, git@github.com:o/r.git
// owner: /^[A-Za-z0-9-]{1,39}$/  repo: /^[A-Za-z0-9._-]{1,100}$/

export interface BranchInfo {
  name: string
  headSha: string
}
export interface RateLimitInfo {
  limit: number
  remaining: number
  resetAt: Date
  observedAt: Date
}
export type Progress = { phase: 'list' | 'detail'; done: number; total: number }
export interface Warning {
  kind: 'truncated' | 'unknown-src'
  sha?: string
  detail?: string
}
export interface HistoryResult {
  data: GitLogData
  warnings: Warning[]
  rateLimit: RateLimitInfo | null
}

export interface GitHubClientOptions {
  fetch?: typeof fetch
  baseUrl?: string // テスト差し替え用
  concurrency?: number // 既定 4
  maxCount?: number // 上限 50
}
export class GitHubClient {
  fetchBranches(ref: RepoRef, opts?: { signal?: AbortSignal }): Promise<BranchInfo[]> // per_page=100, 1ページ
  fetchHistory(
    ref: RepoRef,
    branch: string,
    opts?: {
      count?: number
      signal?: AbortSignal
      onProgress?: (p: Progress) => void
    },
  ): Promise<HistoryResult>
  estimateCost(ref: RepoRef, shas: string[]): number // キャッシュに無い件数
  get lastRateLimit(): RateLimitInfo | null
  fetchRateLimit(opts?): Promise<RateLimitInfo> // GET /rate_limit(非消費。Step 0 ⑧で確認済み)
}
export function toGitLogData(input: {
  ref: RepoRef
  branch: string
  commits: GhCommitDetail[] // 新しい順, parents 含む
  timeZone?: string // IANA 名。不正なら RangeError
  truncatedShas?: ReadonlySet<string> // files が 1 ページ目で切り詰められたコミット。判定は取得側(Step 6)が Link ヘッダで行う
}): { data: GitLogData; warnings: Warning[] } // 純粋関数。件数上限なし。sha_short 衝突は ShaShortCollisionError
```

**fetchHistory の流れ**: (1) `GET /repos/{o}/{r}/commits?sha={branch}&per_page={count}`(1 req) → (2) キャッシュに無い sha 件数を数え `lastRateLimit.remaining` と比較、不足なら詳細取得前に `RateLimitError`(needed/remaining/resetAt) → (3) 詳細を並列 4 で取得、1 件ごとに `onProgress` → (4) 最初のエラーで内部 AbortController を中断。取得済みはキャッシュに残す。

**レート制限**: 全レスポンスから `X-RateLimit-Limit/Remaining/Reset` を読む(CORS で公開されているかは【要検証】。無理なら `/rate_limit`)。`403` かつ remaining=0 → `RateLimitError`。`403/429` で `Retry-After` → `SecondaryRateLimitError`。

**エラー型**: 基底 `GitHubError` に `kind`: `invalid_input` / `not_found`(404、private 含む) / `rate_limited`(resetAt) / `secondary_rate_limited`(retryAfter) / `empty_repository`(409) / `http`(status) / `network` / `aborted`(UI は無視)。

**予算**: branches 1 + 一覧 1 + 詳細 N。N=20 で約 22、N=50 で約 52。60/h の枠では新規リポジトリは 1 時間に 2〜3 回程度。ブラウザ HTTP キャッシュの ETag 再検証(304 は非計上)が効く可能性【推測】。

### 4.6 app

- コンポーネント: `RepoForm`, `BranchSelect`, `CountInput`(1〜50、既定 20), `ProgressBar`, `RateLimitBadge`(残り回数/リセット時刻), `ErrorBanner`, `FileGrassView`。
- `FileGrassView`: `onMounted` と `watch(data)` で `destroy → draw`、`onBeforeUnmount` で `destroy`。
- 状態: composable `useHistoryLoader`(AbortController 保持、入力変更で前の取得を中断)。Pinia 不使用。
- Vite `base: '/gh-file-grass-web/'`(リポジトリ名に合わせる)。

## 5. 実装計画(1 ステップ ≒ 1 PR)

依存: 1→2→3 は順次。4 と 5 は 3 の後に並行可。6 は 2 と 5 の後。7→8 は 6 の後。

**Step 0: 調査スパイク(API 挙動確認 + フィクスチャ録画)**

- `scripts/record-fixtures.ts`(開発専用、`GITHUB_TOKEN` 使用、成果物に含めない)。`corestate55/gh-file-grass` の `commits?sha=<d64a81b…>&per_page=100`、64 件分の `commits/{sha}`、`branches`、レスポンスヘッダ(CORS/Rate 系)を保存。
- 検証項目: ①リモートに `d64a81b` があるか ②一覧の並び順 ③マージの files が第一親差分か ④`removed` の sha の意味 ⑤純粋リネームの `changes` ⑥バイナリ判別手がかり ⑦`Access-Control-Expose-Headers` ⑧`/rate_limit` が非消費か ⑨date は author/committer どちらか
- 完了条件: `packages/github-adapter/test/fixtures/` に保存、検証メモ(PR 本文)で未決事項の材料が揃う。

**Step 1: モノレポ雛形と CI** — ルート `package.json`(workspaces)、`tsconfig.base.json`、ESLint/Prettier、vitest workspace、3 パッケージの空 `index.ts` と雛形テスト、`ci.yml`(lint/typecheck/test)。完了: `npm ci && npm run typecheck && npm test` green。

**Step 2: スキーマ型と検証関数** — `core/src/schema.ts`、不変条件(4.2 の 1〜4)の `assertInvariants(data)`。元リポジトリの `public/logs.json` をフィクスチャにコピーして型として読めること/不変条件を満たすことをテスト。

**Step 3: core を TS へ移植(挙動不変)** — JS 10 ファイルを TS 化。この段階ではデータ注入化のみ、`d3-fetch` 除去。happy-dom で `logs.json` を描画し、元実装から算出した期待値とスナップショット比較(`rect.stats`=221、file-label 数=files 件数、commit-label=64、`path.stat-arrow` 数、file-life rect 数)。

**Step 4: core 改修** — 4.4 の 2〜9。検証: ①`<img onerror>` を含むメッセージで要素化されない ②2 インスタンスで ID 衝突なし ③`destroy` 後コンテナが空 ④空コミット/空 stats で例外も NaN 属性も無い ⑤Step 3 のスナップショット数不変。

**Step 5: adapter 純粋変換 `toGitLogData`** — status 対応、短縮表記、第一親チェーンでの src 再構成、bin 推定、日付書式、index 付与。検証: 単体(リネーム 3 形式、純粋/変更伴うリネーム、追加→削除、copied、author 欠落、空コミット)+ゴールデン(Step 0 フィクスチャ 64 件を `logs.json` と正規化比較)。

**Step 6: adapter 取得クライアント** — `parseRepoInput`, `fetchBranches`, `fetchHistory`、セマフォ、キャッシュ、エラー型、ヘッダ解析、事前残量チェック、中断。`fetch` モックで検証: N+1 リクエスト / 同時 ≤4 / 2 回目はキャッシュで 1 リクエスト / 403 remaining=0 → RateLimitError / 404 / 409 / abort で残り停止 / 残量不足の事前検出 / onProgress 順。

**Step 7: app** — 4.6 のコンポーネント群。vitest + @vue/test-utils(エラー表示、処理中の入力変更で中断)。手動で公開リポジトリを 1 つ表示。完了: `npm run build` と `vite preview` で動作。

**Step 8: Pages デプロイ** — `deploy.yml`(configure-pages / upload-pages-artifact / deploy-pages)、`app/dist` を公開。公開 URL で動作し base パスが正しい。

## 6. テスト方針

**ゴールデン比較**(`logs.json` vs フィクスチャ変換結果)。`TZ=Asia/Tokyo` 固定(Ruby がローカル TZ で書式化)。

- 厳密一致: commits の sha/sha_short/author/stat_total/sha 集合、index(並び順方針確定後)、files の name/index/commits、コミットごとの stats 集合(path ソート): path/type/stat_path/insertions/deletions/lines/dst
- 導出結果比較: `_makeStatArrowsData` 相当の (source, target) 組集合、`_lifeStartIndex/_lifeEndIndex` による各ファイル寿命範囲
- 正規化して除外: `repo`/`origin`、`mode`、ルートの `bin` の有無、date は時刻値として比較(ルートは Ruby が別書式)。**src は除外せず**、全範囲では厳密一致、部分範囲では「Ruby と同じ、または `''` かつ `unknown-src` の warning あり」を検証する
- 実装結果(Step 5): stats は順序・index 込みで 221 件が完全一致。部分範囲(k=2〜63)では、Ruby に無い偽の矢印を作らないことも検証している
- API モック: `fetch` 注入(MSW 不要)
- core: happy-dom で要素数/XSS/destroy/複数インスタンス。`getScreenCTM` はスタブ

## 7. リスク

| リスク                                      | 影響                               | 対策                                                            |
| ------------------------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| 一覧順が git log と違う【要検証】           | index 全ずれ                       | Step 0 で確認、必要なら parents でトポロジカル順+日付で並べ替え |
| マージの files が第一親差分でない【要検証】 | stats 膨張                         | `compare/{p0}...{sha}` に切替                                   |
| src が API から取れない                     | 範囲端で矢印欠落                   | 第一親チェーンで再構成、差異は仕様として許容                    |
| mode が取れない                             | ツールチップ mode 欄が空           | 受容                                                            |
| bin が推定                                  | BIN/行数表示がぶれる               | ルールをテストで固定                                            |
| レート制限 60/h                             | 1 時間に取れる回数が少ない         | 事前残量チェック、sha キャッシュ、残量表示、N 既定 20           |
| CORS でレート制限ヘッダ不可【要検証】       | 事前チェック不可                   | `/rate_limit` で代替                                            |
| XSS【事実】                                 | 任意リポジトリ経由でスクリプト実行 | Step 4 で必ずエスケープ                                         |
| 巨大リポジトリ(300 ファイル超/長いパス)     | 描画が重い/切り詰め                | warnings 表示、N 上限 50                                        |
| 範囲内で sha_short 衝突                     | 結合キー破壊                       | 検出したらエラー                                                |
| ブランチ 100 超                             | 一覧に出ない                       | 手入力欄を用意するか(未決 7)                                    |
| Ruby 固有の癖                               | 完全互換にならない                 | 再現しない方針を明記                                            |

切り戻し: core と adapter は独立パッケージなので問題のあるものだけ戻せる。

## 7.5 Step 0 の結果(2026-11-07 完了)

詳細は `packages/github-adapter/test/fixtures/NOTES.md`。要点: ①〜③⑤〜⑨は想定どおり、④のみ設計を訂正(上記 4.3)。マージの files は第一親差分、レート制限ヘッダは CORS で読める、`/rate_limit` は非消費。

## 7.6 Step 5 の結果(2026-11-07 完了)

`toGitLogData` は全 64 件で Ruby の出力と完全一致(正規化後)。決定事項: `removed` の src は API の `sha` から取る / 切り詰めは取得側が判定し `truncatedShas` で渡す / `unknown-src` はコミットごとに 1 件 / sha_short 衝突は例外 / files はコードポイント順 / 不正な timeZone は例外。

## 8. 未決事項(状況は HANDOVER.md 参照)

1. commit 並び順 → **確定: API 順のまま**(Step 0 ②で logs.json と完全一致。ただし 1 リポジトリのみの観測)
2. 日付の TZ → ブラウザのローカル TZ を推奨。日付は **committer.date を使う**(Step 0 ⑨で確定)
3. 300 超ファイル → 1 ページ目のみ+警告を推奨
4. N の既定値 → **20 で確定**(上限 50)
5. 純粋リネームの src/dst='' → Ruby に合わせる(推奨)
6. `_ghUri` の URL エンコード追加 → 推奨(既存挙動の小変更)
7. app の追加機能(URL クエリ共有、ブランチ名手入力欄) → 当面入れない案
8. スキーマ型の置き場所 → core のサブパス(推奨)
9. Step 0 の個人トークン運用 → ローカルで一度だけ使用しコミットしない案(**ユーザー未回答**)
