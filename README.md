# 段取り名人

料理や工事の作業を、手・コンロ・炊飯器・クレーンなどの空き具合を読みながら並べ、全部が終わる時刻を最短にする「段取り」パズル。毎日1問の「今日の段取り」（全員同じ問題）、何問でも遊べる練習（★1〜★3・台所／現場）、初めての人向けの「はじめての段取り」（案内つき3問）。スマホ縦持ち・片手・1回1〜3分の単一HTMLアプリ。
問題はすべてプログラムがその場で作り、全部の並べ方を試して本当の最短を確かめてから出している。

| 項目 | 内容 |
|------|------|
| 状態 | **Web 版を GitHub Pages で一般公開中（2026-10-20。#0008）。PWA（ホーム画面に追加・一度開けばオフラインで開ける）。iOS アプリのプロジェクト（`ios-app/`）は GitHub Actions でビルド確認済み（シミュレータ向け・実機向け（署名なし）とも BUILD SUCCEEDED。#0007・#0008）。App Store 申請は、清武さんが問い合わせ用のメールアドレスなどを決めたあと、岩崎さんが `ios-app/岩崎さんへの引き渡し手順.md` に沿って行う** |
| 一般公開（GitHub Pages） | https://kiyotake1229.github.io/dandori-meijin/ |
| サポート・プライバシーポリシー | https://kiyotake1229.github.io/dandori-meijin/support.html （App Store のサポートURL。プライバシーポリシーは `#privacy`） |
| リポジトリ | https://github.com/kiyotake1229/dandori-meijin （public。main に push すると数十秒で公開サイトに反映） |
| iOS ビルド確認 | https://github.com/kiyotake1229/dandori-meijin/actions/workflows/ios-build.yml （初回 2026-10-20 成功: https://github.com/kiyotake1229/dandori-meijin/actions/runs/39438858818 ） |
| 本体 | `index.html`（約300KB・4,300行。画面・段取りエンジン・SVG アイコン・ネイティブ連携まで1ファイル） |
| ローカル確認 | http://127.0.0.1:8794/ （`思考力/.claude/launch.json` の `dandori`。このフォルダで `python3 -m http.server 8794 --bind 127.0.0.1` でもよい） |
| 開発確認用（Claude Artifact） | https://claude.ai/artifact/7Cag9aMWazbhRpMicw3xmq （2026-10-19 公開。#0005 まで反映。#0006 以降はまだ） |
| 通信 | 記録や操作の内容は外に送らない。外から読むのは Google Fonts の文字だけ（読めなくても端末の文字で表示される） |
| データ | 端末内のみ（localStorage のキー `dandori.v1`。iOS アプリでは Preferences にも同じキーで二重に保存） |
| Bundle ID / 表示名 | `work.ltv.dandori` / 段取り名人（iPhone 専用・縦向き・iOS 14 以上） |
| iOS アプリで使うプラグイン | App・Haptics・LocalNotifications・Preferences・StatusBar（Capacitor 7。`window.Capacitor.Plugins` から使う。詳しくは #0006・#0007） |
| エンジンの版 | VERSION 4（版が変わると全員の問題が変わる。前の版で遊んだ日の記録は、問題ごとの項目だけ空に戻して新しい問題で遊べる） |
| git | 2026-10-20 から（上のリポジトリ）。コミットは `[#連番] 内容` / `[no-doc] 内容`。親の `思考力/` のリポジトリでは `.gitignore` で外してある |

## フォルダの中身

公開サイトに出るのは `index.html`・`manifest.json`・`sw.js`・アイコン・`ogp.png`・`support.html` だけ（`_config.yml` の `exclude` で `README.md`・`docs/`・`tools/`・`ios-app/`・`.claude/` を外している。`.nojekyll` は置かない）。

| パス | 中身 |
|---|---|
| `index.html` | アプリ本体 |
| `manifest.json` / `sw.js` | PWA の設定 / Service Worker（オフライン用。キャッシュの名前は `dandori-` で始まる。manifest・アイコン・先にキャッシュするファイルを変えたら `sw.js` の `VERSION` を上げる） |
| `icon.svg` → `icon-192.png` `icon-512.png` `apple-touch-icon.png` `ios-app/assets/icon.png`・`splash*.png` | アイコンの元データと書き出したもの（`python3 tools/make-images.py icons`。iOS の起動画面の元も作り直す） |
| `ogp.png`（元は `tools/ogp.html`） | リンクを貼ったときのプレビュー画像 1200×630（`python3 tools/make-images.py ogp`） |
| `support.html` | サポートページ兼プライバシーポリシー（App Store のサポートURL） |
| `ios-app/` | iOS アプリ（Capacitor 7）。`npm run sync` で `index.html` を取り込む。App Store 用スクリーンショット（`screenshots/`）、岩崎さんへの引き渡し手順。中身は [ios-app/README.md](ios-app/README.md) |
| `.github/workflows/ios-build.yml` | iOS のビルド確認（GitHub Actions。macos-26・Xcode 26。アプリに入るファイルか `ios-app/` を変えて push すると動く） |
| `_config.yml` / `.gitignore` | 公開サイトに出さないもの / git に入れないもの（`ios-app/node_modules/`・`www/`・`Pods/` など） |
| `tools/make-images.py` | アイコン・iOS の起動画面の元・OGP 画像の書き出し（Chrome の画面なしモード＋Pillow） |
| `tools/check-engine.mjs` | エンジンの検査（`node tools/check-engine.mjs index.html`。110項目。約30秒、マシンが混んでいると2分ほど） |
| `tools/check-app.mjs` | 日付・連続日数・保存・画面の関数・ネイティブ連携・PWA の素材の検査（`node tools/check-app.mjs index.html`。126項目） |
| `docs/` | 開発ドキュメント（ルールは [docs/README.md](docs/README.md)、一覧は `docs/manager/docs.json`） |
| `.claude/` | ローカル確認のサーバ設定・文書と検査の決まり（`rules/documentation.md`） |

## 開発ドキュメント

| 番号 | 文書 |
|---|---|
| #0001 | [現状の仕様と構成](docs/20261019_DOC_0001_ALL_現状の仕様と構成.md)（遊びの決まり・エンジン・画面・保存・検査・公開と iOS。#0009 まで反映） |
| #0002 | [初回点検で見つかった不具合の修正](docs/20261019_BUG_0002_ALL_初回点検で見つかった不具合の修正.md)（本体と check-app を仕上げ、日付の丸め・解説の文・部品表の名前を直した。エンジン VERSION 2） |
| #0003 | [エンジンの見直し](docs/20261019_ENH_0003_ENG_エンジンの見直し.md)（★の難しさ・同点の扱い・できたて・結果の★の幅・曜日・はじめての段取り・ここがコツの文。エンジン VERSION 3） |
| #0004 | [画面の見直し](docs/20261019_ENH_0004_APP_画面の見直し.md)（カードの「いま置くと」・工程表の動き・VERSION 3 の API への対応） |
| #0005 | [点検で見つかった不具合の修正](docs/20261019_BUG_0005_ALL_点検で見つかった不具合の修正.md)（練習のもう一度の続き・予想のつまみ・決め手の文・前の版の記録・2つある道具の続き・★の難しさ。エンジン VERSION 4） |
| #0006 | [PWA化と公開用の素材・ネイティブ連携](docs/20261020_NEW_0006_ALL_PWA化と公開用の素材とネイティブ連携.md)（manifest・Service Worker・アイコン・OGP・サポートページ、触覚・記録の二重保存・毎朝の通知・状態バー。問題は変わらない） |
| #0007 | [iOSアプリ化](docs/20261020_NEW_0007_IOS_iOSアプリ化.md)（Capacitor 7 のプロジェクト・Info.plist・プライバシーマニフェスト・起動画面・CI・スクリーンショット・引き渡し手順） |
| #0008 | [GitHub Pages で公開とビルド確認](docs/20261020_DPL_0008_ALL_GitHubPagesで公開とビルド確認.md)（リポジトリ・Pages の設定・公開サイトの確認・iOS のビルド結果） |
| #0009 | [エンジン検査の性能の合否の線](docs/20261020_FIX_0009_ENG_エンジン検査の性能の合否の線.md)（最大 300ms を合否に、100ms は目安として表示） |

機能追加・バグ修正・改善をしたら、1件ごとに文書を足して `bash docs/manager/generate_docs_json.sh` を実行し、`[#連番] 内容` でコミットして push する。

## 残作業

申請の前に清武さんが決めること（嘘つき村の #0016 と同じ項目）:

1. **問い合わせ用のメールアドレス**（App Store の審査ガイドライン 1.5）。決まったら `support.html` の「お問い合わせ」とプライバシーポリシー7章に足す。それまで申請しない
2. **岩崎さんの Mac の macOS**（Xcode 26 が動くか。macOS 27 なら、引き渡しの前に UIScene への対応を行い Xcode 27 でビルドできるようにする）
3. EU の trader の申告・App Review の連絡先に入れる会社の情報と担当者（嘘つき村で済ませていればそのまま）
4. 公開リポジトリに `docs/`（工数）・引き渡し手順が見えてよいか（公開サイトでは隠している。嘘つき村の #0016 の「決めてほしいこと 2」と同じ）

そのほか:

5. App Store 申請（岩崎さん。`ios-app/岩崎さんへの引き渡し手順.md`）。出たら `support.html` の「iOS アプリ版は準備中です」を直す
6. スマホ実機で確認する（ホーム画面に追加・オフライン・SNS に URL を貼ったときのプレビュー・Artifact の iframe の中でのコピーと戻る・iOS アプリの通知・触覚・起動画面・状態バー）
7. Artifact を最新の版で公開し直す
8. UIScene への対応（Capacitor 7 の雛形のまま。2027年4月ごろまで。嘘つき村と一緒に）
