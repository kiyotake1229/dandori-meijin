# GitHub Pages で公開とビルド確認

- 管理番号: #0008
- 種類: DPL（デプロイ）
- 対象: ALL（全体）
- 作成日: 2026-10-20
- 関連: #0006（PWA化と公開用の素材）、#0007（iOSアプリ化・`_config.yml`・ビルド確認のワークフロー）、#0009（エンジン検査の性能の合否の線）。手本は嘘つき村の #0008（GitHub Pages で公開）

## 概要

このフォルダを git リポジトリにして GitHub の公開リポジトリ `kiyotake1229/dandori-meijin` に push し、main ブランチのルートを GitHub Pages で公開した（清武さんの依頼）。あわせて GitHub Actions の「iOS build check」で、iOS アプリがシミュレータ向け・実機向け（署名なし）ともにビルドできることを確かめた。

## 対象ファイル

- フォルダ全体（`.gitignore` の対象を除く）。公開サイトに出すのは `index.html`・`manifest.json`・`sw.js`・`icon.svg`・`icon-192.png`・`icon-512.png`・`apple-touch-icon.png`・`ogp.png`・`support.html`
- `_config.yml`（#0007）で `README.md`・`docs/`・`ios-app/`・`tools/`・`.claude/` を公開サイトから外している（`.github/` と `.gitignore` などの点で始まるものは Jekyll がもともと出さない）

## 変更内容

### 1. リポジトリ

- `git init -b main` で始め、最初のコミット「[#0007] 初版を GitHub Pages で公開（#0001〜#0006 を含む）」（`4602a55`。78ファイル）を push した
- リポジトリ: https://github.com/kiyotake1229/dandori-meijin （public。説明「段取り名人 — 料理や工事の作業を並べて最短で仕上げる、毎日1問の段取りパズル」。兄弟アプリ usotsuki-mura・goi-dojo などと同じ形）
- App Store 用スクリーンショット（約6MB）があるので、push の前にこのリポジトリだけ `git config http.postBuffer 524288000` を設定した（嘘つき村では設定する前の push が途中で切れた）。1回で push できた
- 親フォルダ `思考力/` のリポジトリ（嘘つき村）には触れていない（このフォルダは親の `.gitignore` で外してあり、親の `git status` も変わらない）
- push の前に、秘密の情報（トークン・鍵・パスワード）、メールアドレス、手元の絶対パス、作業用のファイル（`node_modules`・`www`・`Pods`・ログ）が入っていないことを確かめた

### 2. GitHub Pages

- 設定: ブランチ `main`・フォルダ `/`（`gh api -X POST repos/kiyotake1229/dandori-meijin/pages`）。https は強制
- `.nojekyll` は置かない（置くと `_config.yml` の `exclude` が効かず、`docs/` なども公開サイトで開けてしまう）
- 「pages build and deployment」: 成功 https://github.com/kiyotake1229/dandori-meijin/actions/runs/39438860873

### 3. iOS ビルド確認（GitHub Actions）

- ワークフロー: `.github/workflows/ios-build.yml`（#0007）
- 結果: **1回目で成功**。https://github.com/kiyotake1229/dandori-meijin/actions/runs/39438858818
  - ランナー `macos-26-arm64`（イメージ 20261013.0424）。「Select Xcode 26」は「既定の Xcode 26.6 を使う」（Build version 17F113）
  - `npm ci` → `npm run sync-web` → `npx cap sync ios`（pod install）→ 構成の確認 → シミュレータ向け Debug ビルド `** BUILD SUCCEEDED **` → 実機向け Release ビルド（署名なし）`** BUILD SUCCEEDED **` → アプリの中身の確認（表示名「段取り名人」・iPhone 専用・`index.html` など6つの Web 資産・`sw.js` なし・`PrivacyInfo.xcprivacy`・Capacitor と5プラグインの6つのフレームワーク）
  - ビルドの警告は2種類だけ（AppIntents が無いので抜き出しを飛ばした、Pods の「Embed Pods Frameworks」が毎回動く）。どちらも Capacitor の雛形で出るもので、動作には関係ない
- 注意（動作には影響なし）: 「pages build and deployment」に「ubuntu-latest は 2026-10-19 から Ubuntu 26 に移る」という知らせが出ている（GitHub が用意するワークフローなので、こちらで直すものはない）

## 確認

- 公開サイト（curl）: `/`・`index.html`・`manifest.json`・`sw.js`・`icon.svg`・`icon-192.png`・`icon-512.png`・`apple-touch-icon.png`・`ogp.png`・`support.html` が 200。`README.md`・`docs/README.md`・`docs/manager/docs.json`・`tools/check-engine.mjs`・`tools/make-images.py`・`ios-app/README.md`・`ios-app/package.json`・`.claude/launch.json`・`_config.yml`・`.github/workflows/ios-build.yml` は 404（公開サイトに出ていない）
- 公開サイトの `index.html`・`sw.js`・`support.html`・`manifest.json`・`icon.svg`・PNG 4つは、手元のファイルと同じ中身（SHA-256 が一致。Jekyll で書き換わっていない）
- 画面なしの Chrome を DevTools Protocol で動かし、公開 URL をスマホの幅（375×812・拡大率3倍）で開いた（ページを開くたびに、操作の前にミュートのスクリプトを流した。`mute-armed`）
  - ホームに今日の段取り No.2「家の外まわりを整える」（10月20日（火）・★1 現場）と、あらすじが出る。横スクロールなし
  - Service Worker が `https://kiyotake1229.github.io/dandori-meijin/` の範囲で activated・ページを受け持つ。キャッシュ `dandori-app-v1` に先にキャッシュする7件（`./`・`index.html`・`manifest.json`・アイコン3つ・`support.html`）
  - manifest を読める（`Page.getAppManifest` のエラー0・名前「段取り名人」）
  - ［今日の段取りを始める］で段取りの画面が開き、予想と作業カード5枚が出る
  - サポートページ（`support.html`）が開き、プライバシーポリシーの見出し（`#privacy`）がある。横スクロールなし
  - コンソールのエラー・警告 0件
  - 確かめたあと、Service Worker の登録・キャッシュ・記録を消し、作業用の Chrome のプロファイルも消した
- `node tools/check-app.mjs index.html`: PASS 126項目。`node tools/check-engine.mjs index.html`: PASS 110項目（#0009 の直しのあと。マシンがとても混んでいた1回だけ性能の項目が FAIL。回帰ハッシュはどの回も PASS で、問題は変わっていない。#0009 の確認）

**まだ確かめていないこと**: スマホ実機（iPhone Safari・Android Chrome でのホーム画面に追加・オフライン）、SNS に URL を貼ったときのプレビュー画像、iOS のシミュレータ・実機での動作と App Store 申請

## 確認URL

| 環境 | URL |
|------|-----|
| ローカル | http://127.0.0.1:8794/ （このフォルダで `python3 -m http.server 8794 --bind 127.0.0.1`） |
| 開発確認用（Claude Artifact） | https://claude.ai/artifact/7Cag9aMWazbhRpMicw3xmq （#0005 の版） |
| 本番（GitHub Pages） | https://kiyotake1229.github.io/dandori-meijin/ |
| サポート（App Store 用） | https://kiyotake1229.github.io/dandori-meijin/support.html |
| リポジトリ | https://github.com/kiyotake1229/dandori-meijin |
| Pages の公開 | https://github.com/kiyotake1229/dandori-meijin/actions/runs/39438860873 |
| iOS ビルド確認 | https://github.com/kiyotake1229/dandori-meijin/actions/runs/39438858818 |

## 作業概要と概算費用

| 項目 | 内容 | 工数 |
|------|------|------|
| 準備 | 公開してよい中身の確認（秘密情報・作業用ファイル・`.gitignore`・`_config.yml`） | 0.2h |
| 公開 | リポジトリ作成・push・Pages の設定 | 0.2h |
| 確認 | 公開サイトの応答と中身、画面なしの Chrome での表示・Service Worker、iOS ビルドの結果とログ | 0.6h |
| 文書 | この文書、README・#0001・#0007・docs/README.md の更新 | 0.5h |
| 合計 | | 1.5h（約0.2人日） |

人日単価が未設定のため金額は書かない。外部費用なし（GitHub の無料の範囲）。
