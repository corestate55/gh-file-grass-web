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

## 未確定
- 設計書 8 章の項目 3, 5〜9 は推奨案で進める想定。明示承認ではないが異論も出ていない。
- 進め方: ステップごとに報告して小単位で進める。

## 次にやること
1. Step 1(モノレポ雛形と CI)→ Step 2 → … → Step 8 を小さな単位で進める(DESIGN.md 5 章)。

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
