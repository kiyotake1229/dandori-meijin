# ドキュメント管理・検査の規則（段取り名人）

## 開発完了後の自動ドキュメント作成（重要）

**コード変更を伴う開発タスクを完了したら、ユーザーの指示を待たずに自動的にドキュメント作成を開始すること。**

1. 変更の種類を判定する: NEW / BUG / ENH / SEC は必ず書く。FIX は簡潔に。誤字・コメントだけは書かない
2. `docs/manager/docs.json` の `next_no` を見て連番を取る
3. `YYYYMMDD_種類_連番_場所_内容.md` で `docs/` 直下に作る（必須項目は `docs/README.md` の6章）
4. `bash docs/manager/generate_docs_json.sh` を実行する

- 場所: ALL（全体）/ APP（画面）/ ENG（段取りエンジン・問題生成。`index.html` 内）/ PWA / IOS（`ios-app/`・`.github/workflows/ios-build.yml`）
- アプリ全体の現状は `docs/20261019_DOC_0001_ALL_現状の仕様と構成.md`。最初にこれを読む

## このアプリでの注意

- 本体は `index.html` の1ファイルだけ。エンジンは `// ==ENGINE START==`〜`// ==ENGINE END==` の間にある（別ファイルで作ったら、ここに入れ直す）
- エンジン（ENG）を変えたら、文書を書く前に `node tools/check-engine.mjs index.html` を実行し、PASS を確かめる。結果（項目数・秒数）を文書の「確認」に書く
- 日付・連続日数（`// ==DAYRULES START==`〜`END`）や保存（`// ==STORE START==`〜`END`）を変えたら、`node tools/check-app.mjs index.html` を実行し、PASS を確かめる
- 問題の作り方が変わる変更（部品表の作業名・資源・所要時間、献立・題材、★の形、良い問題の条件、生成の手順・回数）は、全員の日替わり・練習の問題を変える。エンジンの `VERSION` を上げ、`tools/check-engine.mjs` の `GOLDEN` に新しい版の値を足し、そのことを文書に必ず書く。回帰ハッシュ（日替わり365日・練習120問・はじめての段取りと例題）のどれかが FAIL したら、問題が変わったということ
- 「ここがコツ」の文（`explain`）だけの変更は問題を変えないので `VERSION` は上げなくてよい（`GOLDEN` も変わらない）
- ネイティブ連携（`// ==NATIVE START==`〜`END`・保存の二重化・通知・触覚・状態バー）や PWA の素材（`manifest.json`・`sw.js`・アイコン・`support.html`）を変えたら、`node tools/check-app.mjs index.html` を実行し、PASS を確かめる（偽の Capacitor・偽の Service Worker で動かして確かめる。#0006）
- `manifest.json`・アイコン・`sw.js` の先にキャッシュするファイルの一覧を変えたら、`sw.js` の `VERSION` を上げる。アイコンと OGP 画像は元データ（`icon.svg`・`tools/ogp.html`）を直して `python3 tools/make-images.py` で書き出す
- 遊びの決まり（曜日の★・★2 の幅など）を変えたら、`support.html` の説明も直す（曜日の表は `check-app` が `Engine.WEEK` と突き合わせる）
- ブラウザで確かめるときは、ページを開いたら何もクリックする前に `アプリ開発/_テンプレート/動作チェックのミュート手順.md` のスクリプトを流す（読み込み直すたびに流し直す）。確かめたあとは localStorage の記録を消す
- 作業用・実験用のファイルはこのフォルダに残さない（Dropbox で共有されている）。一時ファイルは作業用の場所に置く

## git

2026-10-20 から git で管理している（GitHub の公開リポジトリ `kiyotake1229/dandori-meijin`。push すると GitHub Pages に反映される。親の `思考力/` リポジトリでは `.gitignore` で外してある）。

- コミットメッセージ: `[#連番] 内容`（本文に変更ファイルの要約と `関連ドキュメント: docs/…`）。文書が要らない変更は `[no-doc] 内容`
- 手順: 実装 → 文書 → `bash docs/manager/generate_docs_json.sh` → ソースと文書を一緒に `git add` → コミット → push
- アプリに入るファイル（`index.html`・`manifest.json`・アイコン）や `ios-app/` を変えて push すると、GitHub Actions の「iOS build check」が動く。ログに `** BUILD SUCCEEDED **`（シミュレータ向け・実機向け）が出て成功することを確かめる
- iOS アプリ（`ios-app/`）を触ったあとは `rm -rf ios-app/node_modules ios-app/ios/App/Pods` で消す（Dropbox の同期が重くなるため）
