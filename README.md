# 段取り名人

料理や工事の作業を、手・コンロ・炊飯器・クレーンなどの空き具合を読みながら並べ、全部が終わる時刻を最短にする「段取り」パズル。毎日1問の「今日の段取り」（全員同じ問題）、何問でも遊べる練習（★1〜★3・台所／現場）、初めての人向けの「はじめての段取り」（案内つき3問）。スマホ縦持ち・片手・1回1〜3分の単一HTMLアプリ。
問題はすべてプログラムがその場で作り、全部の並べ方を試して本当の最短を確かめてから出している。

| 項目 | 内容 |
|------|------|
| 状態 | **作成中。Web 版はローカルで一通り遊べる。2026-10-20 に PWA 化（オフラインで開ける）・公開用の素材（アイコン・OGP・サポートページ）・iOS アプリ用のネイティブ連携を入れた（#0006）。GitHub Pages での公開と iOS のプロジェクトはまだ** |
| 本体 | `index.html`（約300KB・4,300行。画面・段取りエンジン・SVG アイコン・ネイティブ連携まで1ファイル） |
| ローカル確認 | http://127.0.0.1:8794/ （`思考力/.claude/launch.json` の `dandori`。このフォルダで `python3 -m http.server 8794 --bind 127.0.0.1` でもよい） |
| 開発確認用（Claude Artifact） | https://claude.ai/artifact/7Cag9aMWazbhRpMicw3xmq （2026-10-19 公開。#0005 まで反映。#0006 はまだ） |
| 一般公開（GitHub Pages） | 未公開（予定: https://kiyotake1229.github.io/dandori-meijin/ 、サポート https://kiyotake1229.github.io/dandori-meijin/support.html 、リポジトリ `kiyotake1229/dandori-meijin`） |
| 通信 | 記録や操作の内容は外に送らない。外から読むのは Google Fonts の文字だけ（読めなくても端末の文字で表示される） |
| データ | 端末内のみ（localStorage のキー `dandori.v1`。iOS アプリでは Preferences にも同じキーで二重に保存） |
| Bundle ID（予定） | `work.ltv.dandori` |
| iOS アプリで使うプラグイン | App・Haptics・LocalNotifications・Preferences・StatusBar（`window.Capacitor.Plugins` から使う。詳しくは #0006） |
| エンジンの版 | VERSION 4（版が変わると全員の問題が変わる。前の版で遊んだ日の記録は、問題ごとの項目だけ空に戻して新しい問題で遊べる） |
| git | まだ管理していない（親の `思考力/` のリポジトリでは `.gitignore` で外してある） |

## フォルダの中身

| パス | 中身 |
|---|---|
| `index.html` | アプリ本体 |
| `manifest.json` / `sw.js` | PWA の設定 / Service Worker（オフライン用。キャッシュの名前は `dandori-` で始まる。manifest・アイコン・先にキャッシュするファイルを変えたら `sw.js` の `VERSION` を上げる） |
| `icon.svg` → `icon-192.png` `icon-512.png` `apple-touch-icon.png` `ios-app/assets/icon.png` | アイコンの元データと書き出したもの（`python3 tools/make-images.py icons`） |
| `ogp.png`（元は `tools/ogp.html`） | リンクを貼ったときのプレビュー画像 1200×630（`python3 tools/make-images.py ogp`） |
| `support.html` | サポートページ兼プライバシーポリシー（App Store のサポートURL） |
| `ios-app/` | iOS アプリ用。いまはアイコンの元（`assets/icon.png`）だけ。Capacitor のプロジェクトはこれから |
| `tools/make-images.py` | アイコンと OGP 画像の書き出し（Chrome の画面なしモード＋Pillow） |
| `tools/check-engine.mjs` | エンジンの検査（`node tools/check-engine.mjs index.html`。110項目。約30秒） |
| `tools/check-app.mjs` | 日付・連続日数・保存・画面の関数・ネイティブ連携・PWA の素材の検査（`node tools/check-app.mjs index.html`。126項目） |
| `docs/` | 開発ドキュメント（ルールは [docs/README.md](docs/README.md)、一覧は `docs/manager/docs.json`） |
| `.claude/` | ローカル確認のサーバ設定・文書と検査の決まり（`rules/documentation.md`） |

## 開発ドキュメント

| 番号 | 文書 |
|---|---|
| #0001 | [現状の仕様と構成](docs/20261019_DOC_0001_ALL_現状の仕様と構成.md)（遊びの決まり・エンジン・画面・保存・検査。#0005 まで反映） |
| #0002 | [初回点検で見つかった不具合の修正](docs/20261019_BUG_0002_ALL_初回点検で見つかった不具合の修正.md)（本体と check-app を仕上げ、日付の丸め・解説の文・部品表の名前を直した。エンジン VERSION 2） |
| #0003 | [エンジンの見直し](docs/20261019_ENH_0003_ENG_エンジンの見直し.md)（★の難しさ・同点の扱い・できたて・結果の★の幅・曜日・はじめての段取り・ここがコツの文。エンジン VERSION 3） |
| #0004 | [画面の見直し](docs/20261019_ENH_0004_APP_画面の見直し.md)（カードの「いま置くと」・工程表の動き・VERSION 3 の API への対応） |
| #0005 | [点検で見つかった不具合の修正](docs/20261019_BUG_0005_ALL_点検で見つかった不具合の修正.md)（練習のもう一度の続き・予想のつまみ・決め手の文・前の版の記録・2つある道具の続き・★の難しさ。エンジン VERSION 4） |
| #0006 | [PWA化と公開用の素材・ネイティブ連携](docs/20261020_NEW_0006_ALL_PWA化と公開用の素材とネイティブ連携.md)（manifest・Service Worker・アイコン・OGP・サポートページ、触覚・記録の二重保存・毎朝の通知・状態バー。問題は変わらない） |

機能追加・バグ修正・改善をしたら、1件ごとに文書を足して `bash docs/manager/generate_docs_json.sh` を実行する。

## 残作業

1. git のリポジトリ（`kiyotake1229/dandori-meijin`）を作り、GitHub Pages で公開する（`_config.yml` で `README.md`・`docs/`・`tools/`・`ios-app/`・`.claude/` を公開サイトから外す。嘘つき村と同じ）
2. iOS アプリ化（Capacitor。`ios-app/` に嘘つき村の `ios-app/` を雛形に作る。プラグインは #0006 の5つ）と「岩崎さんへの引き渡し手順.md」
3. スマホ実機で確認する（ホーム画面に追加・オフライン・Artifact の iframe の中でのコピーと戻る・iOS アプリの通知と触覚）
4. Artifact を #0006 の版で公開し直す
