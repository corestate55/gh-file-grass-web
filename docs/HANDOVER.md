# 引き継ぎメモ(新セッション用)

最終更新: 2026-11-07。前セッションは `gh-file-grass`(元リポジトリ)で行った。このディレクトリ(`gh-file-grass-web`)が新アプリのリポジトリ。**まだ実装は一切始めていない。docs のみ。**

## 何を作るか

元リポジトリ gh-file-grass(Git のファイル単位変更履歴を GitHub 草グラフ風に可視化。Ruby コレクタ → `logs.json` → Vue3+d3)と同様の可視化を、**ブラウザ上で GitHub Pages だけで**動かす。GitHub URL を入力 → ブランチ選択 → 直近 N 件の履歴を可視化。データは保存しない。

詳細設計は [DESIGN.md](./DESIGN.md)。

## ユーザーが確定させた方針

- 公開リポジトリのみ(機密を持たないため)。トークン入力欄なし。
- データ取得は **GitHub REST API のみ**(未認証 60 req/h)。CORS プロキシなど外部依存は持たない。GitHub Pages で完結。
- 「直近 N 件」に範囲を絞る。**N は動作確認が済むまで 20**(上限 50)。徐々に調整する。
- rename は Ruby 版と同等にしたい(API の `previous_filename` で実現可能。重い処理なら近似でも可)。
- 描画部分は **パッケージ化**(`packages/core`)。
- 言語は **TypeScript**。
- 構成は設計書のとおりで承認済み(npm workspaces: core / github-adapter / app)。リポジトリ名・場所は `gh-file-grass-web`。

## 進捗

- **Step 0 完了(2026-11-07)**: トークン(fine-grained PAT、`(a local file)`、期限 2026-11-07 15:00 UTC)をローカルでのみ使用して録画。結果は `packages/github-adapter/test/fixtures/NOTES.md`。DESIGN.md に反映済み(④のみ設計訂正、未決 1・2 確定)。
- トークンは用途終了。**ユーザーが GitHub 上で Revoke する**こと。リポジトリには一切含めていない。
- `git init` 済み。
- **Step 1 完了**(モノレポ雛形・CI)、**Step 2 完了**(`packages/core/src/schema.ts` に型と `assertInvariants`、`packages/core/test/fixtures/logs.json` を基準に検証)。
- トークンはユーザーが Revoke 済み。
- **Step 3 完了**: 元 JS 10 ファイルを `packages/core/src/gh_file_grass/*.ts` に移植(データ注入化・d3-fetch 除去のみ。`console.log`・XSS 等は Step 4 で対応)。元実装の出力を `test/fixtures/golden-original.svg.html` として固定し、SVG が完全一致することをテストで保証。未使用の `_classifyByModifiedLines` は削除。
- **Step 5 完了**: `packages/github-adapter/src/` に `toGitLogData`(`rename.ts` / `date.ts` / `file-change.ts` / `blob-history.ts` / `to-git-log-data.ts`)。録画 64 件が `logs.json` と正規化後に完全一致(stats は順序・index・src 込み)、部分範囲(k=2〜63)も検証。architect の計画に従い、判断事項 7 件は推奨どおり(DESIGN 7.6)。
  - Step 6 への引き継ぎ: 取得クライアントは詳細 API の `Link` ヘッダで files の切り詰めを判定して `truncatedShas` を渡す。`GhCommitDetail` は API の生 JSON をそのまま渡せる。
- **Step 6 完了**: `parseRepoInput`(https のみ)、`GitHubClient`(`fetchBranches` / `fetchHistory` / `fetchRateLimit` / `estimateCost` / `lastRateLimit`)、`GitHubError` 階層、セマフォ・LRU/TTL キャッシュ。architect の計画に従い、判断事項は推奨どおり(`ssh`/`git@`/`http` は不可に変更)。fake fetch(fixture 再生。残量を消費し、0 で 403)で N+1 / 同時 ≤4 / キャッシュ / 残量不足 / 中断 / 最初のエラー等を検証し、64 件の統合テストで `toGitLogData` の結果と一致を確認。詳細は DESIGN 4.5・7.7。
  - Step 7 への引き継ぎ: app は 1 ページにつき `GitHubClient` を 1 インスタンス作る。`timeZone` は `Intl.DateTimeFormat().resolvedOptions().timeZone`(または省略)を渡す。default ブランチは main → master → 先頭。`fetchBranches` の `hasMore` で「100 件超は表示されない」旨を出す。入力変更で前の取得を `AbortController` で中断(`aborted` は表示しない)。`apiMessage` は v-html 禁止。
  - **Step 7 の手動確認項目(ブラウザ)**: DevTools でプリフライト(OPTIONS)が出ないこと、未認証でも必要なフィールドが揃うこと、403/5xx 応答の CORS、300 ファイル超コミットの `Link`(DESIGN 7.7)。
- **Step 7 完了(実装)**: `app/` に Vite + Vue 3 + vue-tsc の SPA。`App.vue`、コンポーネント 8 つ(`WarningList` を追加)、`useHistoryLoader`、`describeError` ほか。architect の計画に従い、判断事項は推奨どおり(英語 UI、`vue-tsc -b`、`prebuild` で `style.css`、CI に `build`)。curl で確認できた GitHub の挙動は DESIGN 7.8。
  - 実装中に見つけて直したもの: 実行中にブランチを変えられない UI(select を無効化していた)、リアクティブな Proxy を core に渡すと `DataCloneError`(`toRaw` で解決)、テンプレート先頭のコメントでルートがフラグメントになり属性が落ちる。
  - 開発: `npm run dev -w @gh-file-grass/app`(`predev` が core の CSS を生成)、`npm run build && npm run preview -w @gh-file-grass/app` → http://localhost:4173/gh-file-grass-web/
  - **ブラウザでの確認(ユーザーに依頼)**: 1) DevTools の Network を開き `api.github.com` で絞り込む。公開リポジトリ(例 `corestate55/gh-file-grass`)を Load branches → Show して、**OPTIONS(preflight)が出ていない**こと。2) 表示されること(グラフ、ホバーのツールチップがスクロール時もずれない)。3) 実行中にブランチを変えると該当リクエストが canceled になり、エラーが出ないこと。4) 右上の残量バッジが減ること。5) 存在しないリポジトリ・ブランチでエラー文言が出ること。6) 大きなコミット(300 ファイル超)があるリポジトリで警告が出るか(任意)。結果によって直す場所は `describeError`(DESIGN 7.8)。
- **ツールチップの修正(ユーザー報告)**: 長いコミットメッセージで横長になり横スクロールが出る問題。`width: max-content` + `max-width: min(28rem, 90vw)` + 折り返し(`overflow-wrap: anywhere`)、メッセージは 8 行・400 文字で省略(`…`)、改行は保持(`li.message`)、コンテナの表示範囲からはみ出さないよう位置を補正(`_clampTooltipLeft`)。実ブラウザでの見た目は未確認。
- **ツールチップの縦方向(ユーザー報告)**: セルが下の方にあるとツールチップが縦スクロール領域を広げ、スクロールバーが出て隠れる問題。下に収まらなければセルの上に出し(クラス `above`、三角形を下向きに)、上にも収まらなければ表示範囲に収める(`_placeTooltipVertically`)。隠すときは位置を左上(0,0)に戻して内容も空にする(`visibility: hidden` でもスクロール領域には寄与するため。初期位置も 0,0)。実ブラウザでの確認は未実施。
- **Step 4 完了**(4a: XSS エスケープ・`-Infinity`/NaN 対策・`console.log` 削除・URL エンコード/http(s) 限定、4b: `draw(data,{container})`/`destroy()`・ID 接頭辞 `gfgN-`・入力複製・コンテナ内ツールチップ(位置はコンテナ相対)、4c: SCSS を `.gh-file-grass` 配下にスコープ化、`npm run build:css -w @gh-file-grass/core` で `dist/style.css`)。core の公開 API は `draw` / `FileGrassHandle` / `DrawOptions` / スキーマ型 / `assertInvariants`。

## 未確定

- 設計書 8 章の項目 3, 5〜9 は推奨案で進める想定。明示承認ではないが異論も出ていない。
- 進め方: ステップごとに報告して小単位で進める。

## 次にやること

1. ユーザーによるブラウザ確認(下記)→ Step 8(Pages デプロイ) を小さな単位で進める(DESIGN.md 5 章)。

## 参照資料(元リポジトリ。読み取り専用で扱うこと。書き換えない)

- `gh-file-grass/public/logs.json` — 期待スキーマ兼ゴールデンテストの基準(gitignore 済みだが作業ツリーには存在。64 コミット/stats 221 件)。**新リポジトリのテスト用フィクスチャにコピーする。**
- `gh-file-grass/src/js/gh_file_grass/*.js` — 移植元の描画コード(`base.js, builder.js, chart_builder.js, operator.js, files.js, commits.js, commit.js, stats.js, stat.js, info_base.js`)と `src/js/gh_file_grass.js`
- `gh-file-grass/src/css/file_grass.scss` — スタイル
- `gh-file-grass/lib/git_log.rb`, `git_log_entry.rb`, `git_log_entry_file.rb`, `git_show_parser.rb` — 変換規則の根拠(DESIGN.md 4.2 に整理済み)

## 作業ルール(ユーザーの CLAUDE.md より)

- 調査は `code-explorer`(Haiku)、設計は `architect`/Opus、実装は Sonnet、レビューは `code-reviewer`(Opus)。
- 実装計画が承認されるまでコードを変更しない。変更は小さな単位に分割し、各ステップ後に関連テストを実行。大規模変更を一度にしない。
- アーキテクチャに影響する変更は事前にユーザー承認。不必要なリファクタリングはしない。
- コミットは依頼があったときのみ。このディレクトリはまだ `git init` していない(必要ならユーザーに確認して実施)。

## 注意すべき既知の事項(詳細は DESIGN.md)

- 移植時に必ず直す: ツールチップの **XSS**、固定 DOM ID、入力データの破壊的変更、`console.log`、`-Infinity`。
- commits は index 1=最古、stats は index 1=最新という**非対称性**を保つ。
- files のソートはコード単位順(`localeCompare` 禁止)。
- 元実装のバグ(ルートコミットのメッセージが最後の 1 行のみ、`origin` 無しで nil 例外、等)は再現しない。
