# フィクスチャと Step 0 検証メモ

録画日: 2026-11-07 / 対象: `corestate55/gh-file-grass`(最新 `d64a81b`、64 コミット、ルート `266cba1`)
録画: `scripts/record-fixtures.ts`(`probe` → `record`)。期待値は元リポジトリの `public/logs.json`。

## ファイル
- `commits-list.json` — `GET /commits?sha=<d64a81b全長>&per_page=100`(64 件)
- `commits/{sha}.json` — `GET /commits/{sha}` 64 件
- `branches.json` — `GET /branches?per_page=100`
- `rate-limit.json` — `GET /rate_limit`
- 各ファイルは `{url, status, headers, body}`。headers は許可リスト方式(Authorization は保存しない)。

## 検証結果(DESIGN.md の【要検証】項目)

| # | 項目 | 結果 |
|---|---|---|
| ① | `d64a81b` がリモートにある | ある |
| ② | 一覧の並び = `git log` の並び | 64 件の sha 順が `logs.json` と完全一致。API 順のまま使う |
| ③ | マージの files = 第一親との差分 | マージ 6 件すべてでパス集合が Ruby と一致。`compare` 不要 |
| ④ | `removed` の `sha` の意味 | **削除前の blob**(`logo.png` は追加時と削除時で同じ `f3d2503`)。出力 dst は `0000000`。内部の `blobAfter` に使ってはならない |
| ⑤ | 純粋リネームの `changes` | 2 件とも `changes=0`・patch 無し。Ruby は `mode/src/dst=''` で一致。変更を伴うリネームは `changes=42` で dst blob が一致 |
| ⑥ | バイナリの手がかり | Ruby `bin=true` の 5 件はすべて patch 無し・`changes=0`・renamed 以外。偽陽性なし。`package-lock.json` 5 件は patch 無しだが `changes` が大きく除外される |
| ⑦ | CORS | `Allow-Origin: *`。`X-RateLimit-*`/`Link`/`Retry-After`/`ETag` が Expose されている |
| ⑧ | `/rate_limit` は非消費 | 連続 2 回で remaining 不変(4986→4986)。通常 API は 1 回で 1 減 |
| ⑨ | date は author/committer のどちらか | committer が 63/64 一致(author は 59/64)。不一致はルート(Ruby の書式が `Mon Nov 4 …` と異なる)。committer.date を使う |

## 付随して確認した事実
- 非ルート 63 コミットで、`files` のパス(`previous_filename ?? filename`)集合が Ruby の stats と一致。
- `stat_total` の insertions/deletions は 63 件すべて `commit.stats` と一致。
- git メタデータの author(name/email)は 64 件すべて一致。
- status の内訳: modified 180 / added 35 / removed 3 / renamed 3。`copied` は出現しなかった。
- 1 コミットの最大ファイル数は 12。**300 ファイル超の挙動は未検証**。
- 純粋リネームの patch は無い。リネーム 3 件の Ruby 側 `stat_path` は fixture の短縮表記 3 形式に対応。

## 未検証(このフィクスチャでは確かめられない)
- 300 ファイル超のページング
- `copied` status
- 空コミット(files が空)
- 1 リポジトリのみの観測なので、並び順(②)は他リポジトリでの保証にはならない
