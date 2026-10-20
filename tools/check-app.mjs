#!/usr/bin/env node
// 段取り名人 — 画面の決まりの検査（日付と No.・連続日数・記録帳の並び・保存）
// 使い方: node tools/check-app.mjs [index.html]
// index.html の「// ==DAYRULES START==」〜「// ==DAYRULES END==」（日付・連続日数・記録帳の並び）と
// 「// ==STORE START==」〜「// ==STORE END==」（保存の読み書き）を取り出し、エンジン（ENGINE START〜END）と一緒に動かして確かめる。
//   - No.1 より前の時計（少し遅れた時計・時差・遠い過去）は、日付ごと No.1 の日に丸める（10-18 の別の問題を「No.1」として出さない）
//   - 0時をまたぐ・3時まで・日付が戻る・先へ進めて戻す、の連続日数
//   - 記録帳の全日の並び（新しい順・月の見出し・No.1 で止まる・もっと見る）
//   - 保存: 壊れた JSON・読めない1件・型違い・古い形・新しい版の保存・別のタブの記録・別のタブで記録を消した場合
// あわせて、画面の関数（途中の保存・完成の記録・結果のコピー文・はじめての段取りの入口）を取り出して動かし、
// 直したことが消えていないか（No. の丸め・生成前の読み込み表示・alert を使わない・color-mix を使わない・工程表の文字の大きさ）をソースで確かめる。
// エンジン VERSION 3 の API に合わせた所（予想のスライダーの範囲・結果の★・はじめての段取りの案内・曜日の表・★ごとの作業の数）も動かして確かめる（#0003）。
// #0005 で直した所（練習のもう一度の途中から戻れる・前の版の記録に新しい版の結果を混ぜない・遠い先の時計でも記録帳が軽い・
// 予想のつまみは下限から・「いい読み」は★2 と同じ幅）も動かして確かめる。
// #0006 で入れた仕組み（PWA とネイティブ連携）も、偽の window.Capacitor・偽のプラグイン・偽の Service Worker の環境で動かして確かめる:
//   iOS アプリかどうかの判定（NATIVE・FRAMED・plug）、Service Worker を登録する条件（registerSW）、
//   Preferences への二重の保存と起動時の戻し方・戻す順（nativeRestore・persistIfEmpty）、触覚（buzz → Haptics）、
//   状態バーの色（applyTheme → StatusBar）、毎朝の通知（morningList・syncNow・toggleNotify → LocalNotifications）、
//   設定の通知の行（Web では出さない）、結果のコピー文の公開 URL、<head> のタグ、
//   sw.js（消すキャッシュは dandori- だけ・ほかのアプリの場所には触らない・消された分の入れ直し）、manifest・画像の大きさ、
//   サポートページの曜日の表（Engine.WEEK と同じか）。
// 外部パッケージは使わない（Node.js だけで動く）。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(process.argv[2] || path.join(here, '..', 'index.html'));
if (!fs.existsSync(target)) {
  console.log('検査対象: ' + target + '\n\nFAIL  検査対象がありません（ファイルが無い）: ' + target);
  process.exit(1);
}
const SRC = fs.readFileSync(target, 'utf8');
const between = (a, b) => {
  const lines = SRC.split('\n');
  const s = lines.findIndex((l) => l.includes(a)), e = lines.findIndex((l) => l.includes(b));
  if (s < 0 || e < 0 || e <= s) throw new Error(a + ' 〜 ' + b + ' の目印が見つかりません: ' + target);
  return lines.slice(s + 1, e).join('\n');
};
const fnSrc = (name) => {
  const i = SRC.indexOf('function ' + name + '(');
  if (i >= 6 && SRC.slice(i - 6, i) === 'async ') return 'async ' + fnSrcAt(i, name);
  return fnSrcAt(i, name);
};
const fnSrcAt = (i, name) => {
  if (i < 0) throw new Error('function ' + name + ' が見つかりません');
  const e = SRC.indexOf('\n  }\n', i);
  return SRC.slice(i, e) + '\n  }';
};
const lineOf = (head) => { const l = SRC.split('\n').find((x) => x.trim().startsWith(head)); if (!l) throw new Error(head + ' が見つかりません'); return l; };

// localStorage の代わり（Map）。setItem を失敗させる切り替えつき
const LS = new Map();
let lsFail = false;
const ctx = { module: { exports: {} }, console };
// iOS アプリ（Capacitor）の代わり。プラグインは FAKE に入れたり消したりして切り替える（初めは何も無い = Web と同じ動き）
const FAKE = {};
const WIN = { Capacitor: { isNativePlatform: () => true, Plugins: FAKE }, origin: 'https://kiyotake1229.github.io', isSecureContext: true };
WIN.self = WIN; WIN.top = WIN;
ctx.window = WIN;
const VIB = [];   // navigator.vibrate に渡したもの
ctx.navigator = { vibrate: (p) => { VIB.push(p); return true; }, userActivation: { hasBeenActive: true } };
const HTML = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
ctx.document = { documentElement: HTML };
ctx.localStorage = {
  getItem: (k) => (LS.has(k) ? LS.get(k) : null),
  setItem: (k, v) => { if (lsFail) throw new Error('QuotaExceededError'); LS.set(k, String(v)); },
  removeItem: (k) => { LS.delete(k); },
};
vm.createContext(ctx);
try {
  vm.runInContext(between('// ==ENGINE START==', '// ==ENGINE END==') + '\n;this.Engine = (typeof Engine !== "undefined") ? Engine : module.exports;', ctx);
  // ネイティブ連携の判定（保存の persist が Preferences に書くのに使う）
  vm.runInContext(between('// ==NATIVE START==', '// ==NATIVE END==') + '\n;this.NV = { NATIVE, FRAMED, plug, quiet };', ctx);
  vm.runInContext(between('// ==DAYRULES START==', '// ==DAYRULES END==') +
    '\n;this.R = { DAY1, clampDay, clockBehind, dailyOf, TZ_SLACK, openedOnDayOf, countsOnDay, pendingDay, addStreak, shownStreak, bookCount, bookDayAt, bookDays, bookRows, monthOf };', ctx);
  // 保存の読み書き（起動時の let S = readStore() || defaults() も、この中で動く）
  vm.runInContext(between('// ==STORE START==', '// ==STORE END==') +
    '\n;this.ST = { KEY, defaults, sanitize, readStore, persist, update, cleanOrder, getS: () => S, setS: (v) => { S = v; }, newer: () => newerStore, ok: () => storeOK, reset: () => { newerStore = false; storeOK = true; } };', ctx);
  // 画面の関数: 途中の保存・完成の記録（P と today を外から与える）、結果のコピー文、はじめての段取りの入口、待つだけの段
  vm.runInContext('let P = null; let NOW = new Date(2026, 9, 19, 12, 0);\n' +
    'const rawToday = () => Engine.localDateStr(NOW);\nconst today = () => clampDay(rawToday());\n' +
    'const pendingNow = () => pendingDay(S.daily, today(), NOW.getHours());\nconst streakNow = () => shownStreak(S.stats, today(), !!pendingNow());\n' +
    lineOf('const THEME_NAME = ') + '\n' + lineOf('const starsOf = ') + '\n' + lineOf('const SITE_URL = ') + '\n' +
    'const esc = (s) => String(s == null ? \'\' : s);\nconst icon = () => \'\';\n' +
    [fnSrc('freshForVersion'), fnSrc('saveProgress'), fnSrc('onComplete'), fnSrc('copyText'), fnSrc('showTutCard'), fnSrc('waitSubs'), fnSrc('validOrder'), fnSrc('guessHTML'), fnSrc('practiceResume')].join('\n') +
    '\n;this.UI = { freshForVersion, saveProgress, onComplete, copyText, showTutCard, waitSubs, validOrder, guessHTML, practiceResume, starsOf, SITE_URL, setP: (p) => { P = p; }, getP: () => P, setNow: (d) => { NOW = d; } };', ctx);
  // ネイティブ連携の画面の関数: 触覚・状態バー・設定の画面・毎朝の通知（$・toast・cur を外から与える）
  vm.runInContext('const DOM = {};\nconst $ = (sel) => DOM[sel] || null;\nlet cur = \'home\'; let confirmOpen = false;\nconst TOASTS = [];\nconst toast = (m) => { TOASTS.push(m); };\n' +
    [lineOf('function parseD('), lineOf('const VIBE = '), lineOf('const HAPTIC = '), lineOf('const NOTI_BASE = '), lineOf('const NOTI_DAYS = '), lineOf('let notiDenied = '), lineOf('const isMine = ')].join('\n') + '\n' +
    [fnSrc('buzz'), fnSrc('applyTheme'), fnSrc('renderSettings'), fnSrc('morningList'), fnSrc('syncNotifications'), fnSrc('syncNow'), fnSrc('toggleNotify')].join('\n') +
    '\n;this.NU = { buzz, applyTheme, renderSettings, morningList, syncNotifications, toggleNotify, isMine, NOTI_BASE, NOTI_DAYS, DOM, TOASTS, chain: () => notiChain, denied: () => notiDenied, setDenied: (v) => { notiDenied = v; }, setCur: (v) => { cur = v; } };', ctx);
} catch (e) {
  console.log('検査対象: ' + target + '\n\nFAIL  読み込めません: ' + e.message);
  process.exit(1);
}
const { Engine, R, ST, UI, NU } = ctx;

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); };
const st = (o) => Object.assign({ streak: 0, bestStreak: 0, lastDailyDate: null, totalSolved: 0, perfect: 0 }, o);
const solve = (s, caseDate, openedOnDay, todayStr, hour) => { const on = R.countsOnDay(caseDate, openedOnDay, todayStr, hour); if (on) R.addStreak(s, caseDate); return on; };
const localDay = (y, m, d, h, mi) => Engine.localDateStr(new Date(y, m - 1, d, h, mi || 0));

/* ---------- No. と日付の丸め（#0002: 時計が遅れた端末で 10-18 の別の問題が No.1 として出る） ---------- */
{
  check('DAY1 はエンジンの No.1 の日（2026-10-19）', R.DAY1 === '2026-10-19' && Engine.dailyConfig(R.DAY1).no === 1, R.DAY1);
  const behind = ['2026-10-18', '2026-10-01', '2026-01-01', '1970-01-01', '2000-02-29'];
  const day1 = JSON.stringify(Engine.daily('2026-10-19'));
  const bad = behind.filter((d) => {
    const c = R.dailyOf(d);
    return R.clampDay(d) !== R.DAY1 || c.no !== 1 || c.date !== '2026-10-19' || c.seed !== 'dandori-20261019' || c.star !== 1 || c.theme !== 'kitchen' || JSON.stringify(Engine.daily(R.clampDay(d))) !== day1;
  });
  check('No.1 より前の日付は、日付ごと No.1 の日に丸める（★1・台所の No.1 と同じ問題。10-18 の★3・現場を出さない）', bad.length === 0, bad.join(' '));
  check('No.1 より前の日付のときは「日付を確かめて」を出す', behind.every((d) => R.clockBehind(d)) && !R.clockBehind('2026-10-19') && !R.clockBehind('2027-03-01'), '');
  // 時計が10分遅れた端末: 本当は 10-19 0:05、端末は 10-18 23:55
  const raw = localDay(2026, 10, 18, 23, 55);
  const c = R.dailyOf(R.clampDay(raw));
  check('時計が10分遅れた端末（10-18 23:55）でも、今日の段取りは No.1・2026-10-19 の問題', raw === '2026-10-18' && c.no === 1 && c.seed === 'dandori-20261019', raw + ' ' + JSON.stringify(c));
  // 0時の前後
  const edges = [[localDay(2026, 10, 19, 0, 0), 1], [localDay(2026, 10, 19, 23, 59), 1], [localDay(2026, 10, 20, 0, 0), 2], [localDay(2026, 10, 25, 12, 0), 7], [localDay(2027, 10, 19, 0, 0), 366]];
  const eb = edges.filter(([d, no]) => R.dailyOf(R.clampDay(d)).no !== no);
  check('0時の前後・1年後の No. が正しい', eb.length === 0, JSON.stringify(eb));
  // 形の違う日付でも例外を出さない
  let threw = '';
  for (const x of ['2026-10-19T00:00', '', null, undefined, 20261019, '2026-13-01', '2026-02-30']) {
    try { const k = R.dailyOf(x); if (!(k.no >= 1) || !k.seed) threw += String(x) + ' '; } catch (e) { threw += String(x) + '(例外) '; }
  }
  check('形の違う日付を渡しても例外を出さず、No.1 以降の設定を返す', threw === '', threw);
  // 365日分の No. と曜日の★
  let nb = 0;
  for (let i = 0; i < 365; i++) { const d = Engine.addDays('2026-10-19', i); const k = R.dailyOf(d); if (k.no !== i + 1 || k.date !== d) nb++; }
  check('2026-10-19 から365日分の No. が通し番号', nb === 0, nb + '日違う');
}

/* ---------- 連続日数（嘘つき村と同じ考え方） ---------- */
{
  const s = st({ streak: 4, bestStreak: 4, lastDailyDate: '2026-10-21' });
  const on = solve(s, '2026-10-22', true, '2026-10-23', 0);
  check('0時をまたいでも、開いた日の段取りを3時までに完成させれば連続に数える', on && s.streak === 5 && s.lastDailyDate === '2026-10-22' && s.bestStreak === 5, JSON.stringify(s));
  check('翌日のホームでも連続が続いている', R.shownStreak(s, '2026-10-23') === 5, '');
  const s2 = st({ streak: 4, bestStreak: 4, lastDailyDate: '2026-10-21' });
  check('3時を過ぎてから完成させたときは数えない', !solve(s2, '2026-10-22', true, '2026-10-23', 3) && s2.streak === 4, JSON.stringify(s2));
  const s3 = st({ streak: 4, bestStreak: 4, lastDailyDate: '2026-10-21' });
  check('前の日に開いていない段取りを、日付が変わってから完成させても数えない', !solve(s3, '2026-10-22', false, '2026-10-23', 0) && s3.streak === 4, '');
  const s4 = st({ streak: 2, bestStreak: 7, lastDailyDate: '2026-10-20' });
  solve(s4, '2026-10-22', true, '2026-10-22', 12);
  check('1日あくと連続は1から（最高は残る）', s4.streak === 1 && s4.bestStreak === 7, JSON.stringify(s4));
  check('最後に完成させた日が一昨日なら表示は0', R.shownStreak(st({ streak: 3, lastDailyDate: '2026-10-20' }), '2026-10-22') === 0, '');
  // 0〜3時の「まだ間に合う」
  const daily = { '2026-10-22': { state: 'playing', openedOnDay: true } };
  check('0〜3時のホームに、前の日に開いた段取りがまだ間に合うと出す', R.pendingDay(daily, '2026-10-23', 1) === '2026-10-22' && R.pendingDay(daily, '2026-10-23', 3) === null, '');
  check('0〜3時は、前の日の段取りが間に合ううちは連続を切らない', R.shownStreak(st({ streak: 2, lastDailyDate: '2026-10-21' }), '2026-10-23', true) === 2, '');
  check('完成済み・前の日に開いていない段取りはお知らせに出さない', R.pendingDay({ '2026-10-22': { state: 'done', openedOnDay: true } }, '2026-10-23', 1) === null && R.pendingDay({ '2026-10-22': { state: 'playing' } }, '2026-10-23', 1) === null, '');
  // 日付が戻る（時差の幅）
  const A = st({ streak: 13, bestStreak: 13, lastDailyDate: '2027-01-03' });
  check('日付が2日以内で戻っても連続をそのまま見せる', R.shownStreak(A, '2027-01-02') === 13 && R.shownStreak(A, '2027-01-01') === 13, '');
  solve(A, '2027-01-02', true, '2027-01-02', 12);
  check('日付が戻った日に完成させても、連続と最後の日を巻き戻さない', A.streak === 13 && A.lastDailyDate === '2027-01-03', JSON.stringify(A));
  const C = st({ streak: 13, bestStreak: 13, lastDailyDate: '2027-01-03' });
  check('時計を大きく戻したホームでは連続0、戻せば連続が残る', R.shownStreak(C, '2026-12-01') === 0 && R.shownStreak(C, '2027-01-04') === 13, '');
  // 先へ進めて完成させ、元に戻す
  const D = st({ streak: 5, bestStreak: 5, lastDailyDate: '2026-10-21' });
  solve(D, '2027-01-01', true, '2027-01-01', 12);
  let ok = R.shownStreak(D, '2026-10-22') === 0;
  for (let i = 0; i < 5; i++) { const d = Engine.addDays('2026-10-22', i); solve(D, d, true, d, 12); if (D.streak !== i + 1) ok = false; }
  check('先の日付で完成させてから時計を戻しても、毎日完成させれば連続が1からのびる', ok && D.streak === 5 && D.bestStreak === 5, JSON.stringify(D));
}

/* ---------- 記録帳の並び ---------- */
{
  check('記録帳: 初日は No.1 の1行', JSON.stringify(R.bookDays('2026-10-19')) === '["2026-10-19"]', '');
  check('記録帳: 時計が No.1 より前でも No.1 の1行（空にならない・No.0 を出さない）', JSON.stringify(R.bookDays('2026-10-01')) === '["2026-10-19"]', '');
  const L = R.bookDays('2026-12-01');
  check('記録帳: 今日から No.1 まで新しい順（12-01 は44行）', L.length === 44 && L[0] === '2026-12-01' && L[43] === '2026-10-19' && L.every((d, i) => i === 0 || d < L[i - 1]), L.length);
  const a = R.bookRows('2026-12-01', 0, 30, R.monthOf), b = R.bookRows('2026-12-01', 30, 60, R.monthOf);
  const heads = a.concat(b).filter((x) => x.head).map((x) => x.head);
  check('記録帳: 月の見出しは月ごとに1回（もっと見るで足しても重ならない）', JSON.stringify(heads) === '["2026-12","2026-11","2026-10"]' && a.concat(b).filter((x) => !x.head).length === 44, JSON.stringify(heads));
  check('記録帳: i 番目の日付と日数（一覧を作らずに出す）が一覧と同じ', R.bookCount('2026-12-01') === 44 && L.every((d, i) => R.bookDayAt('2026-12-01', i) === d) && JSON.stringify(R.bookDays('2026-12-01', 40, 99)) === JSON.stringify(L.slice(40)), '');
  // #0005: 端末の時計が 9999-12-31 だと、全部の日付（290万日）を毎回作って1秒以上止まっていた。表示する30行と残りの日数だけを出す
  const t0 = performance.now();
  const far = '9999-12-31', nFar = R.bookCount(far), rowsFar = R.bookRows(far, 0, 30, R.monthOf).filter((x) => !x.head);
  const msFar = performance.now() - t0;
  check('記録帳: 端末の時計が 9999-12-31 でも、最初の30行と残りの日数を100ms以内に出す', nFar === Engine.diffDays('2026-10-19', far) + 1 && rowsFar.length === 30 && rowsFar[0].item === far && msFar < 100, `${nFar}日 ${msFar.toFixed(1)}ms`);
  check('記録帳: ［もっと見る］はボタンを残して文言だけ変える（フォーカスが消えない）', /btn\.textContent = moreText\(total\)/.test(fnSrc('bookMore')) && /first\.focus/.test(fnSrc('bookMore')) && !/bookDays\(td\)/.test(SRC), '');
}

/* ---------- 保存 ---------- */
{
  const KEY = ST.KEY;
  const base = () => ({
    v: 1, t: 5, epoch: '', settings: { sound: false, haptics: true, theme: 'dark', pracTheme: 'site' },
    daily: { '2026-10-20': { state: 'done', order: [], tries: 2, bestMs: 21, lastMs: 21, lastOrder: [2, 0, 1, 3, 4], reachedAt: 2, best: 21, v: Engine.VERSION, openedOnDay: true, solvedOnDay: true, streak: 2, guess: 25, asked: true } },
    practice: { cur: { seed: 'p1', star: 2, theme: 'site', state: 'playing', order: [1, 0], v: Engine.VERSION }, solved: 3, perfect: 1, byStar: { 1: 1, 2: 2, 3: 0 } },
    tutorial: { done: 2, dismissed: false, cur: null },
    stats: { streak: 2, bestStreak: 5, lastDailyDate: '2026-10-20', totalSolved: 6, perfect: 4, guessN: 3, guessExact: 1, guessNear: 2, guessErr: 5 },
  });
  const kept = (r) => !!r && r.stats.totalSolved === 6 && r.stats.bestStreak === 5 && !!r.daily['2026-10-20'] && r.daily['2026-10-20'].reachedAt === 2 &&
    r.practice.cur && r.practice.cur.seed === 'p1' && r.tutorial.done === 2 && r.settings.sound === false && r.settings.theme === 'dark' && r.settings.pracTheme === 'site';
  // 1) 空の保存
  LS.clear(); ST.reset();
  const d0 = ST.readStore();
  check('保存: 何も無いときは既定の形（v:1）', d0 && d0.v === 1 && Object.keys(d0.daily).length === 0 && d0.tutorial.done === 0, '');
  // 2) 正しい保存はそのまま読める
  LS.set(KEY, JSON.stringify(base()));
  check('保存: 正しい保存はそのまま読める', kept(ST.readStore()), '');
  // 3) 読めない日付のキーがあっても、ほかは全部読める
  const badKeys = ['2026-10-32', '2026-13-01', '2026-02-30', '2026-10-18', '2026-1-05', 'abc', '__proto__', 'constructor'];
  const failed = [];
  badKeys.forEach((k) => {
    LS.set(KEY, JSON.stringify(base()).replace('"daily":{', '"daily":{' + JSON.stringify(k) + ':{"state":"playing","order":[1]},'));
    let r = null; try { r = ST.readStore(); } catch (e) { r = null; }
    if (!kept(r) || Object.prototype.hasOwnProperty.call(r.daily, k)) failed.push(k);
  });
  check('保存: 読めない日付のキー（10-32・13月・2-30・No.1 より前・形違い・__proto__）があっても、ほかの記録は全部読める', failed.length === 0, failed.join(' '));
  // 4) 型違い・壊れた中身
  const o4 = base();
  o4.daily['2026-10-21'] = { state: 'done', tries: 'abc', bestMs: 'NaN', order: 'x', lastOrder: [1, 1, 99, -1, 2.5, '3', 0], reachedAt: 7, guess: -3 };
  o4.daily['2026-10-22'] = 'broken';
  o4.daily['2026-10-23'] = { state: 'weird' };
  o4.stats.streak = 'x'; o4.stats.guessErr = -9; o4.stats.lastDailyDate = '2026-99-99';
  o4.practice.cur = { seed: { x: 1 }, star: 2, theme: 'site', state: 'playing' };
  o4.tutorial = { done: 99, dismissed: 'yes', cur: { ep: 7 } };
  o4.settings = { sound: 'no', theme: 'purple', pracTheme: 'moon' };
  LS.set(KEY, JSON.stringify(o4));
  const r4 = ST.readStore();
  const x21 = r4 && r4.daily['2026-10-21'];
  const noNaN = (o) => !/NaN|undefined/.test(JSON.stringify(o));
  check('保存: 型違い・壊れた中身でも例外を出さず、決まった形に収める（NaN を出さない）',
    !!r4 && noNaN(r4) && x21 && x21.tries === 1 && x21.bestMs === null && JSON.stringify(x21.order) === '[]' && JSON.stringify(x21.lastOrder) === '[1,0]' && x21.reachedAt === null && x21.guess === null &&
    !r4.daily['2026-10-22'] && !r4.daily['2026-10-23'] && r4.stats.streak === 0 && r4.stats.guessErr === 0 && r4.stats.lastDailyDate === null &&
    r4.practice.cur === null && r4.practice.solved === 3 && r4.tutorial.done === 3 && r4.tutorial.dismissed === false && r4.tutorial.cur === null &&
    r4.settings.sound === true && r4.settings.theme === 'auto' && r4.settings.pracTheme === 'kitchen' && !!r4.daily['2026-10-20'], JSON.stringify(x21));
  // 5) 壊れた JSON: 読まずに控えを取り、手元の記録で続ける（次の保存で控えは消えない）
  LS.clear(); ST.reset();
  LS.set(KEY, '{"v":1,"daily":{"2026-10-20"');
  const r5 = ST.readStore();
  check('保存: 壊れた JSON は null を返し、元の文字列を別のキー（.broken）に控える', r5 === null && LS.get(KEY + '.broken') === '{"v":1,"daily":{"2026-10-20"', String(LS.get(KEY + '.broken')));
  ST.setS(ST.defaults());
  ST.update((s) => { s.settings.sound = false; });
  const sv5 = JSON.parse(LS.get(KEY));
  check('保存: 壊れた保存のあとも遊べて、次の保存で正しい形になる（控えは残る）', sv5.v === 1 && sv5.settings.sound === false && LS.has(KEY + '.broken'), '');
  // 6) 古い形（項目が足りない保存）
  const r6 = ST.sanitize({ v: 1, stats: { totalSolved: 4 } });
  const r6b = ST.sanitize({ v: 1, practice: { solved: 2 }, daily: { '2026-10-20': { state: 'done' } } });
  check('保存: 古い形（daily・practice・tutorial・settings が無い、記録の項目が足りない）も読め、足りない所は既定の値',
    r6.v === 1 && r6.stats.totalSolved === 4 && r6.practice.cur === null && r6.tutorial.done === 0 && r6.settings.theme === 'auto' &&
    r6b.practice.solved === 2 && r6b.practice.byStar[1] === 0 && r6b.daily['2026-10-20'].tries === 1 && Array.isArray(r6b.daily['2026-10-20'].lastOrder), JSON.stringify(r6b.daily));
  // 7) 新しい版の保存（v:2）は読まず、上書きもしない
  LS.clear(); ST.reset();
  const newer = JSON.stringify({ v: 2, something: 'new', stats: { totalSolved: 40 } });
  LS.set(KEY, newer);
  const r7 = ST.readStore();
  ST.setS(ST.defaults());
  ST.update((s) => { s.settings.sound = false; });
  check('保存: 新しい版の保存（v:2）は読まず、上書きもしない', r7 === null && ST.newer() === true && LS.get(KEY) === newer, LS.get(KEY));
  ST.reset();
  // 8) 別のタブ: 読み直してから重ねる（ほかのタブが付けた記録を消さない）
  LS.clear();
  ST.setS(ST.sanitize(base()));            // このタブを開いたとき
  const other = base();                    // 別のタブが 10-21 を完成させて保存
  other.daily['2026-10-21'] = { state: 'done', tries: 1, bestMs: 30, lastMs: 30, lastOrder: [0, 1, 2, 3, 4], best: 28, v: Engine.VERSION, openedOnDay: true, solvedOnDay: true, streak: 3 };
  other.stats.totalSolved = 7; other.stats.streak = 3; other.stats.lastDailyDate = '2026-10-21';
  LS.set(KEY, JSON.stringify(other));
  ST.update((s) => { s.settings.haptics = false; });
  const sv8 = JSON.parse(LS.get(KEY));
  check('保存: 別のタブで付けた記録（完成・連続）を、このタブの保存で消さない', !!sv8.daily['2026-10-21'] && sv8.stats.totalSolved === 7 && sv8.stats.streak === 3 && sv8.settings.haptics === false, JSON.stringify(sv8.stats));
  // 9) 保存が丸ごと消えていた: 手元の記録に重ねて書き戻す
  ST.setS(ST.sanitize(base()));
  LS.delete(KEY);
  ST.update((s) => { s.settings.sound = true; });
  check('保存: 保存が丸ごと消えていたら、手元の記録を書き戻す（空で上書きしない）', kept(Object.assign(JSON.parse(LS.get(KEY)), { settings: { sound: false, haptics: true, theme: 'dark', pracTheme: 'site' } })) && JSON.parse(LS.get(KEY)).settings.sound === true, '');
  // 10) 保存できない環境でも例外を出さない
  lsFail = true;
  let ok10 = true;
  try { ST.update((s) => { s.settings.sound = false; }); } catch (e) { ok10 = false; }
  lsFail = false;
  check('保存: 書き込めない環境（容量・プライベート）でも例外を出さず、保存できないことを覚える', ok10 && ST.ok() === false, '');
  ST.reset();
}

/* ---------- 途中の保存・完成の記録（saveProgress / onComplete を動かす） ---------- */
{
  const KEY = ST.KEY;
  LS.clear(); ST.reset(); ST.setS(ST.defaults()); ST.persist();
  const pz = Engine.daily('2026-10-19');
  const best = pz.solution.best, bestO = pz.solution.bestOrder;
  const topO = Engine.solve(pz).orders.topDown;
  const mkP = (o) => Object.assign({ mode: 'daily', pz, date: '2026-10-19', no: 1, ep: null, star: 1, theme: pz.theme, seed: null, order: [], guess: null, asked: true, epoch: ST.getS().epoch || '', openedOnDay: true, finished: false, rec: null }, o);
  UI.setNow(new Date(2026, 9, 19, 21, 0));
  // 途中の保存
  UI.setP(mkP({ order: topO.slice(0, 2), guess: best + 2 }));
  UI.saveProgress();
  let s = JSON.parse(LS.get(KEY));
  check('途中: 並べ方・予想・その日のうちに開いた、を保存する', JSON.stringify(s.daily['2026-10-19'].order) === JSON.stringify(topO.slice(0, 2)) && s.daily['2026-10-19'].guess === best + 2 && s.daily['2026-10-19'].openedOnDay === true && s.daily['2026-10-19'].state === 'playing', JSON.stringify(s.daily));
  // 1回目: 上から順で完成（最短に届かない）
  UI.setP(mkP({ order: topO.slice(), guess: best + 2 }));
  UI.onComplete(Engine.schedule(pz, topO).makespan);
  s = JSON.parse(LS.get(KEY));
  let r = s.daily['2026-10-19'];
  // 予想の「近い」は★2 と同じ幅（最短の1割）。差2が近いかどうかは最短しだい
  check('完成1回目: 完成数1・連続1・最短はまだ・予想の記録1件（近いかは最短の1割で決める）', r.state === 'done' && r.tries === 1 && r.reachedAt === null && r.bestMs === Engine.schedule(pz, topO).makespan &&
    s.stats.totalSolved === 1 && s.stats.streak === 1 && s.stats.perfect === 0 && s.stats.guessN === 1 && s.stats.guessErr === 2 && s.stats.guessNear === (2 <= Engine.near(best) ? 1 : 0) && r.solvedOnDay === true, JSON.stringify({ r, st: s.stats, near: Engine.near(best) }));
  // 2回目: 最短
  UI.setP(mkP({ order: bestO.slice(), guess: best + 2 }));
  UI.onComplete(best);
  s = JSON.parse(LS.get(KEY)); r = s.daily['2026-10-19'];
  check('完成2回目で最短: 「2回目で最短」・最短数1・完成数と連続と予想の記録は増えない', r.tries === 2 && r.reachedAt === 2 && r.bestMs === best && s.stats.totalSolved === 1 && s.stats.streak === 1 && s.stats.perfect === 1 && s.stats.guessN === 1, JSON.stringify({ r, st: s.stats }));
  // コピー文
  UI.setP(mkP({ order: bestO.slice(), guess: best + 2, rec: r }));
  const txt = UI.copyText();
  const want = '段取り名人 No.1（★☆☆・台所）\n最短 ' + best + '分 → 2回目で最短\n予想 ' + (best + 2) + '分（2分の差）\n連続1日\nhttps://kiyotake1229.github.io/dandori-meijin/';
  check('結果のコピー文が決まった形（No.・★・テーマ・何回目で最短・予想・連続・最後に公開の URL）', txt === want, JSON.stringify(txt));
  UI.setP(mkP({ order: topO.slice(), guess: null, rec: { tries: 3, bestMs: best + 4, reachedAt: null } }));
  check('最短に届いていないときのコピー文（何回で何分・あと何分。予想なしなら予想の行は出さない）', UI.copyText() === '段取り名人 No.1（★☆☆・台所）\n最短 ' + best + '分 → 3回で ' + (best + 4) + '分（あと4分）\n連続1日\n' + UI.SITE_URL, JSON.stringify(UI.copyText()));
  // 過去の段取り（No.1 の日を、日付が変わってから開いて完成）: 連続に数えない
  UI.setNow(new Date(2026, 9, 21, 12, 0));
  const pz2 = Engine.daily('2026-10-20');
  UI.setP(mkP({ pz: pz2, date: '2026-10-20', no: 2, order: pz2.solution.bestOrder.slice(), openedOnDay: false }));
  UI.onComplete(pz2.solution.best);
  s = JSON.parse(LS.get(KEY));
  check('過去の日の段取りを後から完成させても、連続には数えない（完成数・最短数には数える）', s.stats.streak === 1 && s.stats.lastDailyDate === '2026-10-19' && s.stats.totalSolved === 2 && s.stats.perfect === 2 && !s.daily['2026-10-20'].solvedOnDay, JSON.stringify(s.stats));
  // 別のタブで記録を消した（epoch が変わった）あと: 途中は書き戻さず、完成は新しい記録として数える
  UI.setNow(new Date(2026, 9, 22, 9, 0));
  const pz3 = Engine.daily('2026-10-22');
  const P3 = mkP({ pz: pz3, date: '2026-10-22', no: 4, order: [pz3.solution.bestOrder[0]], epoch: '' });
  const wiped = ST.defaults(); wiped.epoch = 'k2x9'; wiped.t = 99;
  LS.set(KEY, JSON.stringify(wiped));
  UI.setP(P3);
  UI.saveProgress();
  s = JSON.parse(LS.get(KEY));
  check('別のタブで記録を消したあとは、開いていた段取りの途中を書き戻さない', s.epoch === 'k2x9' && Object.keys(s.daily).length === 0 && s.stats.totalSolved === 0, JSON.stringify(s.daily));
  P3.order = pz3.solution.bestOrder.slice();
  UI.onComplete(pz3.solution.best);
  s = JSON.parse(LS.get(KEY));
  check('別のタブで記録を消したあとに完成させると、新しい記録として数える', s.epoch === 'k2x9' && s.stats.totalSolved === 1 && s.stats.streak === 1 && UI.getP().epoch === 'k2x9' && !!s.daily['2026-10-22'], JSON.stringify(s.stats));
  // 練習: 1回目の完成で練習の数、最短で最短の数
  LS.clear(); ST.setS(ST.defaults()); ST.persist();
  const pp = Engine.generate({ seed: 'app-check', star: 2, theme: 'site' });
  UI.setP(mkP({ mode: 'practice', pz: pp, date: null, no: null, star: 2, theme: 'site', seed: 'app-check', order: pp.solution.bestOrder.slice() }));
  UI.onComplete(pp.solution.best);
  UI.onComplete(pp.solution.best);
  s = JSON.parse(LS.get(KEY));
  check('練習: 同じ問題を何度完成させても、練習の数・最短の数は1問として数える（連続・完成数は変えない）', s.practice.solved === 1 && s.practice.perfect === 1 && s.practice.byStar[2] === 1 && s.practice.cur.tries === 2 && s.stats.totalSolved === 0 && s.stats.streak === 0, JSON.stringify(s.practice));
  // #0005: 練習で［もう一度］の途中に画面を離れても、同じ★を押せば同じ問題の続きから開く（完成のあとは state 'done' のまま並べ方が残る）
  {
    const c0 = JSON.parse(LS.get(KEY)).practice.cur;
    UI.setP(mkP({ mode: 'practice', pz: pp, date: null, no: null, star: 2, theme: 'site', seed: 'app-check', order: pp.solution.bestOrder.slice(0, 2) }));
    UI.saveProgress();   // ［もう一度］のあと2枚置いて、戻るで離れた
    const c1 = JSON.parse(LS.get(KEY)).practice.cur;
    const with_ = (o) => Object.assign({}, c1, o);
    const ok = c0.state === 'done' && c1.state === 'done' && c1.seed === 'app-check' && c1.order.length === 2 && c1.tries === 2 &&
      UI.practiceResume(c1, 2, 'site') && !UI.practiceResume(c1, 3, 'site') && !UI.practiceResume(c1, 2, 'kitchen') &&
      !UI.practiceResume(with_({ order: [] }), 2, 'site') && UI.practiceResume(with_({ state: 'playing', order: [] }), 2, 'site') && !UI.practiceResume(with_({ v: Engine.VERSION - 1 }), 2, 'site');
    check('練習: ［もう一度］の途中で離れても、同じ★・テーマを押すと同じ問題の続きから開く（完成して並べ方が無ければ新しい問題）', ok &&
      /practiceResume\(c, star, th\)/.test(fnSrc('openPractice')) && /practiceResume\(c, k, th\)/.test(fnSrc('renderPractice')), JSON.stringify(c1));
  }
  // はじめての段取り: 最短で進む・届かなければ途中のまま。記録には数えない
  const t2 = Engine.tutorial(2);
  UI.setP(mkP({ mode: 'tutorial', pz: t2, date: null, no: null, ep: 2, order: [0, 1, 2, 3, 4] }));
  UI.onComplete(Engine.schedule(t2, [0, 1, 2, 3, 4]).makespan);
  s = JSON.parse(LS.get(KEY));
  const midOK = s.tutorial.done === 0 && s.tutorial.cur && s.tutorial.cur.ep === 2;
  UI.setP(mkP({ mode: 'tutorial', pz: t2, date: null, no: null, ep: 2, order: t2.solution.bestOrder.slice() }));
  UI.onComplete(t2.solution.best);
  s = JSON.parse(LS.get(KEY));
  check('はじめての段取り: 最短に届いたら次の話へ進み、届かなければ途中のまま。完成数・練習の数には数えない', midOK && s.tutorial.done === 2 && s.tutorial.cur === null && s.stats.totalSolved === 0 && s.practice.solved === 1, JSON.stringify(s.tutorial));
  // 保存していた並べ方は、前提を満たす頭の部分だけ使う
  const vo = UI.validOrder(pz, [bestO[0], 99, bestO[1]]);
  check('途中の並べ方を読み直すとき、置けない番号から先は使わない', JSON.stringify(vo) === JSON.stringify([bestO[0]]), JSON.stringify(vo));
  // #0005: 前の版（VERSION）の日替わりの記録に、新しい版の問題の結果を重ねない（届いていないのに「1回目で最短」・記録帳★3 になった）
  {
    const topMs = Engine.schedule(pz, topO).makespan;
    const oldRec = () => ({ state: 'done', order: [], tries: 1, bestMs: 9, lastMs: 9, lastOrder: [0, 1, 2, 3], reachedAt: 1, best: 9, v: Engine.VERSION - 1, openedOnDay: true, solvedOnDay: true, streak: 1, guess: 9, asked: true });
    const setOld = () => {
      LS.clear(); ST.reset();
      const o = ST.defaults();
      o.daily['2026-10-19'] = oldRec();
      Object.assign(o.stats, { streak: 1, bestStreak: 1, lastDailyDate: '2026-10-19', totalSolved: 1, perfect: 1, guessN: 1, guessExact: 1, guessNear: 1, guessErr: 0 });
      LS.set(KEY, JSON.stringify(o)); ST.setS(ST.readStore());
    };
    UI.setNow(new Date(2026, 9, 19, 12, 0));
    // (a) 開いて（startCase の saveProgress）から、上から順で完成 → 最短で完成
    setOld();
    UI.setP(mkP({ order: [], guess: null, asked: false }));
    UI.saveProgress();
    let s1 = JSON.parse(LS.get(KEY)), r1 = s1.daily['2026-10-19'];
    const okOpen = r1.v === Engine.VERSION && r1.tries === 0 && r1.bestMs === null && r1.reachedAt === null && r1.best === best && r1.asked === false &&
      r1.state === 'done' && r1.everBest === true && r1.solvedOnDay === true && r1.openedOnDay === true && r1.streak === 1 && ST.readStore().daily['2026-10-19'].everBest === true;
    UI.setP(mkP({ order: topO.slice(), guess: best + 1 }));
    UI.onComplete(topMs);
    s1 = JSON.parse(LS.get(KEY)); r1 = s1.daily['2026-10-19'];
    const ok1 = r1.tries === 1 && r1.bestMs === topMs && r1.reachedAt === null && r1.best === best && s1.stats.totalSolved === 1 && s1.stats.perfect === 1 && s1.stats.streak === 1 && s1.stats.guessN === 2;
    UI.setP(mkP({ order: bestO.slice(), guess: best + 1 }));
    UI.onComplete(best);
    s1 = JSON.parse(LS.get(KEY)); r1 = s1.daily['2026-10-19'];
    const ok2 = r1.tries === 2 && r1.reachedAt === 2 && r1.bestMs === best && s1.stats.perfect === 1 && s1.stats.totalSolved === 1 && UI.starsOf(r1.bestMs, r1.best) === 3;
    // (b) 保存を通らずにいきなり完成させても同じ（onComplete でも空に戻す）
    setOld();
    UI.setP(mkP({ order: topO.slice(), guess: null }));
    UI.onComplete(topMs);
    const s2 = JSON.parse(LS.get(KEY)), r2 = s2.daily['2026-10-19'];
    const okB = r2.tries === 1 && r2.bestMs === topMs && r2.reachedAt === null && r2.best === best && UI.starsOf(r2.bestMs, r2.best) !== 3 && s2.stats.totalSolved === 1 && s2.stats.perfect === 1;
    check('前の版の記録: 新しい版で開く・完成させると、問題ごとの項目を空に戻して今回の値だけで数える（その日の印・完成の日数・最短の日数は数え直さない）', okOpen && ok1 && ok2 && okB,
      JSON.stringify({ okOpen, ok1, ok2, okB, r1, r2 }));
    check('前の版の記録: 予想は新しい問題でもう一度聞く（この版で完成させた問題だけ聞かない）', /same && \(rec\.asked \|\| \(done && rec\.tries > 0\)\)/.test(fnSrc('startCase')), '');
  }
}

/* ---------- ホームの「はじめての方へ」・待つだけの段 ---------- */
{
  const at = (f) => { const s = ST.defaults(); f(s); ST.setS(s); return UI.showTutCard(); };
  const cases = [
    ['記録が何も無い（初回）', () => {}, true],
    ['日替わりを1つ完成させた', (s) => { s.stats.totalSolved = 1; }, false],
    ['練習を1問完成させた', (s) => { s.practice.solved = 1; }, false],
    ['日替わりを完成させたが、はじめての段取りを進めている', (s) => { s.stats.totalSolved = 1; s.tutorial.done = 1; }, true],
    ['×で閉じた', (s) => { s.tutorial.dismissed = true; }, false],
    ['3話とも済んだ', (s) => { s.tutorial.done = 3; }, false],
  ];
  const bad = cases.filter((c) => at(c[1]) !== c[2]).map((c) => c[0]);
  check('ホーム: はじめての段取りの入口は、初回と進めている人に出し、閉じた・3話済んだ・ほかを完成させた人には出さない', bad.length === 0, bad.join(' / '));
  ST.setS(ST.defaults());
  // 待つだけの作業が重なると段を分ける
  const pzW = { tasks: [{ needs: [] }, { needs: [] }, { needs: ['hand'] }, { needs: [] }] };
  const w = UI.waitSubs(pzW, { tasks: [{ i: 0, start: 0, end: 10 }, { i: 1, start: 2, end: 6 }, { i: 2, start: 0, end: 3 }, { i: 3, start: 10, end: 12 }] });
  check('工程表: 同時に待つ作業は「待つだけ」のレーンで段を分ける', w.rows === 2 && w.sub[0] === 0 && w.sub[1] === 1 && w.sub[3] === 0, JSON.stringify(w));
}

/* ---------- エンジン VERSION 3 の API に合わせた画面（#0003） ---------- */
{
  // 予想のスライダー: 範囲はエンジンの stats.guessLo〜guessHi（下限0は1から）。最短は範囲の中で、下限・上限・真ん中のどれにも近くない。
  // つまみは下限から（#0005: 真ん中から始めると、動かして戻すだけで当たった）
  const pzs = [];
  for (const star of [1, 2, 3]) for (const theme of ['kitchen', 'site']) for (let i = 0; i < 12; i++) pzs.push(Engine.generate({ seed: 'app-g' + i, star, theme }));
  for (let i = 0; i < 14; i++) pzs.push(Engine.daily(Engine.addDays('2026-10-19', i)));
  const badG = [];
  for (const pz of pzs) {
    UI.setP({ pz, guess: null });
    const h = UI.guessHTML();
    const m = /id="guessIn" min="(\d+)" max="(\d+)" step="1" value="(\d+)"/.exec(h);
    if (!m) { badG.push(pz.title + ' スライダーが無い'); continue; }
    const lo = +m[1], hi = +m[2], v = +m[3], best = pz.solution.best, st = pz.stats, nr = pz.solution.near;
    const mids = [Math.floor((lo + hi) / 2), Math.ceil((lo + hi) / 2), Math.round((lo + hi) / 2)];
    if (lo !== Math.max(1, st.guessLo) || hi !== st.guessHi || !(best - lo >= 2 && hi - best >= 2) || v !== lo || mids.some((x) => Math.abs(x - best) <= nr)) badG.push(`${pz.title} ★${pz.star} ${lo}〜${hi} 初期${v} 最短${best}`);
  }
  check('予想: 範囲は stats.guessLo〜guessHi。最短は下限・上限から2以上離れ、範囲の真ん中が最短±1割に入らない。つまみは下限から（72問＋日替わり14日）', badG.length === 0, badG.slice(0, 3).join(' / '));
  UI.setP({ pz: pzs[0], guess: null });
  const g0 = UI.guessHTML();
  check('予想: つまみに触れるまでは数字を「？」・読み上げは「まだ選んでいません」で、［予想して始める］を押せない', /id="guessVal">？</.test(g0) && /id="guessGo" aria-describedby="guessHelp" disabled>/.test(g0) && /aria-valuetext="まだ選んでいません"/.test(g0) &&
    /go\.disabled = false/.test(fnSrc('markGuess')) && /removeAttribute\('aria-valuetext'\)/.test(fnSrc('markGuess')) && /go\.disabled\) return/.test(fnSrc('startGuess')) && /'pointerup'/.test(SRC), '');
  check('予想: つまみに触れてからカードを押すと、その数を予想として始める（触れていなければ予想なし）', /startGuess\(!!\(go && !go\.disabled\)\)/.test(fnSrc('place')), '');
  check('予想: 「いい読み」と記録帳の「近い」は★2 と同じ幅（最短の1割）', /gd <= pz\.solution\.near/.test(fnSrc('renderResult')) && /e <= Engine\.near\(best\)/.test(fnSrc('onComplete')) && !/e <= 2\)/.test(SRC), '');
  UI.setP({ pz: pzs[0], guess: 9999 });
  const mv = /value="(\d+)"/.exec(UI.guessHTML());
  check('予想: 保存していた予想は範囲の中に収めて出す', mv && +mv[1] === pzs[0].stats.guessHi, mv && mv[1]);
  // 結果の★: Engine.grade と同じ（★2 は最短の1割（四捨五入・少なくとも1）以内）。記録帳は保存した最短だけから同じ★を出す
  const badS = [];
  for (const pz of pzs) {
    const b = pz.solution.best, nr = pz.solution.near;
    for (const ms of [b, b + 1, b + nr, b + nr + 1, b + 9]) if (UI.starsOf(ms, b) !== Engine.grade(pz, ms)) badS.push(`${pz.title} 最短${b} ${ms} 画面★${UI.starsOf(ms, b)} エンジン★${Engine.grade(pz, ms)}`);
  }
  check('結果の★: 記録帳の★（保存した最短から）が Engine.grade と同じ（★2 = 最短の1割以内）', badS.length === 0, badS.slice(0, 3).join(' / '));
  const rr = fnSrc('renderResult');
  check('結果の★: 結果の画面は Engine.grade(pz, ms)、「おしい！」の境目は solution.near', /Engine\.grade\(pz, ms\)/.test(rr) && /diff <= pz\.solution\.near/.test(rr) && !/diff <= 2 \?/.test(rr), '');
  // はじめての段取りの案内: 置いている途中は lesson.on / lesson.hint だけを出す（explain の文は答えの作業名を言うので出さない）
  const tg = fnSrc('tutGuide');
  check('はじめての段取り: 置いている途中の案内は lesson.on・lesson.hint（explain の答えの文を出さない）', /L\.on\b/.test(tg) && /L\.hint\b/.test(tg) && /L\.tip\b/.test(tg) && !/ex\.tips/.test(tg) && !/TUT_ON/.test(SRC), '');
  const lessonOK = [1, 2, 3].every((k) => { const L = Engine.tutorial(k).lesson; return L && ['intro', 'tip', 'on', 'hint', 'done'].every((f) => typeof L[f] === 'string' && L[f].length > 0); });
  check('はじめての段取り: 3話とも lesson に intro・tip・on・hint・done がある', lessonOK, '');
  // 遊び方の曜日の表は Engine.WEEK から、ホームの作業の数は Engine.SHAPE から作る
  const ht = fnSrc('renderHowto');
  check('遊び方: 曜日の表は Engine.WEEK から作る（月〜日の7曜日）', /Engine\.WEEK\[wd\]/.test(ht) && /\[1, 2, 3, 4, 5, 6, 0\]/.test(ht) && Object.keys(Engine.WEEK).length === 7, '');
  check('ホーム: ★ごとの作業の数は Engine.SHAPE から作る（決め打ちの「作業4〜5個」を使わない）', /Engine\.SHAPE\[star\]/.test(SRC) && !/'★1・作業4〜5個'/.test(SRC) && !/\['やさしい', '作業4〜5個'\]/.test(SRC), '');
}

/* ---------- ネイティブ連携と PWA（#0006）: 偽の window.Capacitor・偽のプラグインで動かす ---------- */
// 別の環境（vm の文脈）を作る。ls: 開いたときの localStorage、win: window の代わり、extra: そのほかの大域（location・navigator・document）
const SRC_ENGINE = between('// ==ENGINE START==', '// ==ENGINE END==') + '\n;this.Engine = (typeof Engine !== "undefined") ? Engine : module.exports;';
const SRC_NATIVE = between('// ==NATIVE START==', '// ==NATIVE END==');
const winOf = (o) => { const w = Object.assign({ origin: 'https://kiyotake1229.github.io', isSecureContext: true }, o || {}); if (!('self' in w)) w.self = w; if (!('top' in w)) w.top = w; return w; };
function makeCtx({ ls, win, extra, store }) {
  const L = new Map(ls ? Object.entries(ls) : []);
  const c = { module: { exports: {} }, console };
  c.localStorage = { getItem: (k) => (L.has(k) ? L.get(k) : null), setItem: (k, v) => { L.set(k, String(v)); }, removeItem: (k) => { L.delete(k); } };
  c.window = win || winOf();
  Object.assign(c, extra || {});
  vm.createContext(c);
  vm.runInContext(SRC_ENGINE, c);
  vm.runInContext(SRC_NATIVE + '\n;this.NV = { NATIVE, FRAMED, plug, CAP };', c);
  if (store) {
    vm.runInContext(between('// ==DAYRULES START==', '// ==DAYRULES END==') + '\n' + between('// ==STORE START==', '// ==STORE END==') + '\n' + fnSrc('persistIfEmpty') +
      '\n;this.SX = { getS: () => S, nativeRestore, persist, persistIfEmpty, update, restoring: () => restoring, newer: () => newerStore, blank: () => blankAtStart };', c);
  }
  return { c, L };
}
const capWin = (plugins, o) => winOf(Object.assign({ Capacitor: { isNativePlatform: () => true, Plugins: plugins || {} } }, o || {}));

// iOS アプリかどうか・iframe の中か・プラグインの取り出し
{
  const web = makeCtx({}).c.NV;
  const capWeb = makeCtx({ win: winOf({ Capacitor: { isNativePlatform: () => false, Plugins: { Haptics: {} } } }) }).c.NV;
  const broken = makeCtx({ win: winOf({ Capacitor: { isNativePlatform: () => { throw new Error('x'); }, Plugins: { Haptics: {} } } }) }).c.NV;
  const nat = makeCtx({ win: capWin({ Haptics: { impact() {} } }) }).c.NV;
  check('ネイティブ: Web（Capacitor が無い・Web 版の Capacitor・判定が例外）では NATIVE が false で、plug はどのプラグインも返さない',
    web.NATIVE === false && web.plug('Haptics') === null && capWeb.NATIVE === false && capWeb.plug('Haptics') === null && broken.NATIVE === false && broken.plug('Haptics') === null, '');
  check('ネイティブ: iOS アプリ（isNativePlatform() が true）では window.Capacitor.Plugins のプラグインを返し、無いプラグインは null', nat.NATIVE === true && typeof nat.plug('Haptics').impact === 'function' && nat.plug('Preferences') === null, '');
  const top = {};
  const framed = makeCtx({ win: winOf({ top }) }).c.NV.FRAMED;
  const sandbox = makeCtx({ win: winOf({ origin: 'null' }) }).c.NV.FRAMED;
  const thrower = winOf(); Object.defineProperty(thrower, 'top', { get() { throw new Error('SecurityError'); } });
  const cross = makeCtx({ win: thrower }).c.NV.FRAMED;
  check('ネイティブ: FRAMED は iframe の中・origin の無い sandbox・親を読めない iframe で true、ふつうに開いたときは false', framed === true && sandbox === true && cross === true && web.FRAMED === false, '');
}

// Service Worker を登録する条件（registerSW）
{
  const swCase = (o) => {
    const regs = [], loads = [];
    const win = o.win || winOf(o.native ? { Capacitor: { isNativePlatform: () => true, Plugins: {} } } : {});
    if (o.secure === false) win.isSecureContext = false;
    win.addEventListener = (type, fn) => { if (type === 'load') loads.push(fn); };
    const nav = o.noSW ? {} : { serviceWorker: { register: (u) => { regs.push(u); return Promise.resolve(); } } };
    const { c } = makeCtx({ win, extra: { location: { protocol: o.protocol || 'https:' }, navigator: nav, document: { readyState: o.ready || 'complete' } } });
    let threw = false;
    try { vm.runInContext(fnSrc('registerSW') + '\n;registerSW();', c); } catch (e) { threw = true; }
    const before = regs.length;
    loads.forEach((f) => f());
    return { regs, before, threw };
  };
  const pub = swCase({});
  const local = swCase({ protocol: 'http:' });
  const late = swCase({ ready: 'loading' });
  check('Service Worker: https の公開の場所・ローカル（http://127.0.0.1）で開いたときは sw.js を登録する。読み込みの途中なら load のあとに登録する',
    pub.regs.join() === 'sw.js' && local.regs.join() === 'sw.js' && late.before === 0 && late.regs.join() === 'sw.js', JSON.stringify([pub.regs, local.regs, late]));
  const no = {
    'iOS アプリ': swCase({ native: true }), 'iframe（Artifact）': swCase({ win: winOf({ top: {} }) }), 'sandbox（origin が null）': swCase({ win: winOf({ origin: 'null' }) }),
    'file:': swCase({ protocol: 'file:' }), '安全でない接続': swCase({ protocol: 'http:', secure: false }), 'Service Worker の無いブラウザ': swCase({ noSW: true }),
  };
  const bad = Object.keys(no).filter((k) => no[k].regs.length || no[k].threw);
  check('Service Worker: iOS アプリ・iframe・sandbox・file:・安全でない接続では登録しない。Service Worker の無いブラウザでも例外を出さない', bad.length === 0, bad.join(' / '));
  check('Service Worker: 登録は起動（boot）の最後に1回', /registerSW\(\);/.test(fnSrc('boot')) && (SRC.match(/registerSW\(\)/g) || []).length === 2, '');
}

// 保存の二重化（iOS アプリでは localStorage と Preferences の両方に書く）と、起動時の戻し方・戻す順
{
  const KEY = ST.KEY;
  const prefs = (initial) => {
    const store = new Map(), log = [];
    if (initial != null) store.set(KEY, initial);
    return { store, log, fail: false,
      async get({ key }) { log.push('get'); if (this.fail) throw new Error('x'); return { value: store.has(key) ? store.get(key) : null }; },
      async set({ key, value }) { log.push('set'); store.set(key, value); } };
  };
  const rec = (t, extra) => JSON.stringify(Object.assign({ v: 1, t, epoch: '', settings: { sound: true, haptics: true, theme: 'dark', pracTheme: 'site', notifyMorning: true, notifyTime: '06:30' },
    daily: { '2026-10-20': { state: 'done', order: [], tries: 2, bestMs: 21, lastMs: 21, lastOrder: [0, 1, 2, 3, 4], reachedAt: 2, best: 21, v: Engine.VERSION, solvedOnDay: true, streak: 1 } },
    stats: { streak: 1, bestStreak: 4, lastDailyDate: '2026-10-20', totalSolved: 9, perfect: 5 } }, extra || {}));
  const tick = () => new Promise((r) => setTimeout(r, 0));

  // persist は Preferences にも同じ JSON を書く（Web では何もしない）
  LS.clear(); ST.reset();
  const pf0 = prefs(null);
  FAKE.Preferences = pf0;
  ST.setS(ST.defaults());
  ST.update((s) => { s.settings.sound = false; });
  await tick();
  const same = pf0.store.get(KEY) === LS.get(KEY) && JSON.parse(pf0.store.get(KEY)).settings.sound === false;
  delete FAKE.Preferences;
  LS.clear(); ST.reset(); ST.setS(ST.defaults());
  check('二重の保存: iOS アプリでは、保存のたびに localStorage と Preferences（キー dandori.v1）に同じ JSON を書く', same && pf0.log.join() === 'set', pf0.log.join());

  // 1) 開いたとき localStorage が空（OS が WebView の保存を消した）・Preferences に記録 → Preferences から戻す
  {
    const pf = prefs(rec(500));
    const { c, L } = makeCtx({ win: capWin({ Preferences: pf }), store: true });
    const changed = await c.SX.nativeRestore();
    const S1 = c.SX.getS();
    check('二重の保存: localStorage が空なら Preferences から戻す（記録・設定がそのまま。localStorage にも書き戻す）',
      changed === true && S1.stats.totalSolved === 9 && S1.daily['2026-10-20'].reachedAt === 2 && S1.settings.notifyTime === '06:30' && S1.settings.notifyMorning === true &&
      JSON.parse(L.get(KEY)).stats.totalSolved === 9 && c.SX.restoring() === false && pf.log.join() === 'get', pf.log.join());
  }
  // 2) localStorage のほうが新しい → localStorage のまま、Preferences を追いつかせる
  {
    const pf = prefs(rec(100, { stats: { totalSolved: 3 } }));
    const { c } = makeCtx({ ls: { [KEY]: rec(900) }, win: capWin({ Preferences: pf }), store: true });
    const changed = await c.SX.nativeRestore();
    await tick();
    check('二重の保存: localStorage のほうが新しい（t が大きい）ときは localStorage のまま、Preferences に書いて追いつかせる',
      changed === false && c.SX.getS().stats.totalSolved === 9 && JSON.parse(pf.store.get(KEY)).t === 900 && pf.log.join() === 'get,set', pf.log.join());
  }
  // 3) Preferences のほうが新しい → Preferences から戻す
  {
    const pf = prefs(rec(900, { stats: { totalSolved: 12 } }));
    const { c, L } = makeCtx({ ls: { [KEY]: rec(100) }, win: capWin({ Preferences: pf }), store: true });
    const changed = await c.SX.nativeRestore();
    check('二重の保存: Preferences のほうが新しいときは Preferences から戻す', changed === true && c.SX.getS().stats.totalSolved === 12 && JSON.parse(L.get(KEY)).stats.totalSolved === 12, '');
  }
  // 4) Preferences が空・localStorage に記録 → Preferences に書く（アプリを新しく入れた直後など）
  {
    const pf = prefs(null);
    const { c } = makeCtx({ ls: { [KEY]: rec(300) }, win: capWin({ Preferences: pf }), store: true });
    const changed = await c.SX.nativeRestore();
    await tick();
    check('二重の保存: Preferences が空なら localStorage の記録を Preferences に書く', changed === false && !!pf.store.get(KEY) && JSON.parse(pf.store.get(KEY)).t === 300, pf.log.join());
  }
  // 5) 起動の順: Preferences を読み終える前（restoring）は、空の記録を保存しようとしても Preferences に書かない。
  //    開いたとき localStorage が空だったら、待つ間に localStorage へ書かれた（t が新しい）空の記録より Preferences を優先する
  {
    let release;
    const pf = prefs(rec(500));
    const realGet = pf.get.bind(pf);
    pf.get = (a) => new Promise((r) => { release = () => r(realGet(a)); });
    const { c, L } = makeCtx({ win: capWin({ Preferences: pf }), store: true });
    const p = c.SX.nativeRestore();
    const during = c.SX.restoring();
    c.SX.persistIfEmpty();                         // 起動が先に来た（1.2秒たった）ときの「空なら保存」
    const lsDuring = L.get(KEY);
    c.SX.update((s) => { s.settings.sound = false; });   // 待つ間の操作（localStorage にだけ書く）
    await tick();
    const pfUntouched = pf.log.join() === '' && pf.store.get(KEY) === rec(500);
    release();
    const changed = await p;
    c.SX.persistIfEmpty();
    await tick();
    check('二重の保存（起動の順）: Preferences を読み終えるまでは「空なら保存」をせず、Preferences にも書かない',
      during === true && lsDuring == null && pfUntouched, JSON.stringify({ during, lsDuring, log: pf.log }));
    check('二重の保存（起動の順）: 開いたとき localStorage が空なら、待つ間に書かれた新しい空の記録より Preferences の記録を戻す。読み終えたら次の保存から Preferences にも書く',
      changed === true && c.SX.getS().stats.totalSolved === 9 && JSON.parse(L.get(KEY)).stats.totalSolved === 9 && c.SX.restoring() === false &&
      (c.SX.update((s) => { s.settings.haptics = false; }), true) && JSON.parse(pf.store.get(KEY)).settings.haptics === false, pf.log.join());
  }
  // 6) 新しい版の記録（v:2）が Preferences にある → どちらにも書かない
  {
    const newer = JSON.stringify({ v: 2, t: 999, stats: { totalSolved: 40 } });
    const pf = prefs(newer);
    const { c, L } = makeCtx({ ls: { [KEY]: rec(100) }, win: capWin({ Preferences: pf }), store: true });
    const changed = await c.SX.nativeRestore();
    c.SX.update((s) => { s.settings.sound = false; });
    await tick();
    check('二重の保存: Preferences に新しい版の記録（v:2）があれば読まず、localStorage にも Preferences にも書かない',
      changed === true && c.SX.newer() === true && pf.store.get(KEY) === newer && JSON.parse(L.get(KEY)).t === 100, pf.log.join());
  }
  // 7) Preferences が読めない → localStorage のまま。そのあとの保存は Preferences にも書く
  {
    const pf = prefs(rec(500)); pf.fail = true;
    const { c } = makeCtx({ ls: { [KEY]: rec(100) }, win: capWin({ Preferences: pf }), store: true });
    const changed = await c.SX.nativeRestore();
    c.SX.update((s) => { s.settings.sound = false; });
    await tick();
    check('二重の保存: Preferences が読めないときは localStorage のまま遊べ、次の保存から Preferences にも書く', changed === false && c.SX.restoring() === false && JSON.parse(pf.store.get(KEY)).settings.sound === false, pf.log.join());
  }
  // 8) Web（Preferences が無い）: 何もしない
  {
    const { c } = makeCtx({ ls: { [KEY]: rec(100) }, store: true });
    const changed = await c.SX.nativeRestore();
    check('二重の保存: Web（Preferences が無い）では戻す処理をせず、localStorage だけで動く', changed === false && c.SX.getS().stats.totalSolved === 9, '');
  }
  // 起動の決まり（ソース）: Preferences があるときは nativeRestore を待ってから boot（最長1.2秒）。persistIfEmpty は restoring の間は書かない
  const tail = SRC.slice(SRC.indexOf('/* ---------- 起動 ---------- */'));
  check('起動: iOS アプリでは Preferences から戻してから起動する（最長1.2秒）。Web はすぐ起動する。戻している間は押せない',
    /if \(plug\('Preferences'\)\) \{[\s\S]*setTimeout\(boot, 1200\)[\s\S]*nativeRestore\(\)\.then[\s\S]*\} else boot\(\);/.test(tail) &&
    /if \(restoring\) return;/.test(fnSrc('persistIfEmpty')) && !/\n  persistIfEmpty\(\);\n/.test(tail) && /if \(!booted\) return;/.test(SRC), '');
}

// 触覚（Haptics）・状態バー（StatusBar）
{
  const hc = [];
  FAKE.Haptics = { impact: (o) => { hc.push('impact:' + o.style); return Promise.resolve(); }, notification: (o) => { hc.push('notification:' + o.type); return Promise.resolve(); } };
  ST.setS(ST.defaults());
  VIB.length = 0;
  ['place', 'done', 'best', 'lock', 'toggle'].forEach((k) => NU.buzz(k));
  const native = hc.join() === 'impact:LIGHT,impact:MEDIUM,notification:SUCCESS,notification:WARNING,impact:LIGHT' && VIB.length === 0;
  hc.length = 0;
  ST.getS().settings.haptics = false;
  NU.buzz('place'); NU.buzz('best');
  const off = hc.length === 0 && VIB.length === 0;
  ST.getS().settings.haptics = true;
  delete FAKE.Haptics;
  NU.buzz('place'); NU.buzz('best');
  const web = JSON.stringify(VIB) === JSON.stringify([8, [20, 50, 30, 50, 70]]);
  ctx.navigator.userActivation.hasBeenActive = false; VIB.length = 0;
  NU.buzz('place');
  const quietBefore = VIB.length === 0;
  ctx.navigator.userActivation.hasBeenActive = true;
  check('触覚: iOS アプリでは Haptics（置く・切り替え = 軽い impact、完成 = 中くらいの impact、最短 = success、まだ置けない = warning）。navigator.vibrate は使わない', native, hc.join());
  check('触覚: 設定の「振動」が OFF なら Haptics も vibrate も呼ばない。Web は vibrate のパターン（画面に触れる前は呼ばない）', off && web && quietBefore, JSON.stringify(VIB));
  check('触覚: 完成は最短なら best、それ以外は done', /buzz\(isBest \? 'best' : 'done'\)/.test(SRC.slice(SRC.indexOf('function finish(ms)'), SRC.indexOf('function toResult('))) && !/buzz\('done'\)/.test(SRC) && /buzz\('place'\)/.test(fnSrc('place')), '');
  // 状態バー
  const sb = [];
  FAKE.StatusBar = { setStyle: (o) => { sb.push(o.style); return Promise.resolve(); } };
  const meta = () => ({ setAttribute(k, v) { this[k] = v; } });
  NU.DOM['#metaTheme'] = meta(); NU.DOM['#metaThemeDark'] = meta();
  const s = ST.getS();
  s.settings.theme = 'dark'; NU.applyTheme(); const d = HTML.attrs['data-theme'] === 'dark' && NU.DOM['#metaTheme'].content === '#0A2240' && NU.DOM['#metaThemeDark'].content === '#0A2240';
  s.settings.theme = 'light'; NU.applyTheme(); const l = HTML.attrs['data-theme'] === 'light' && NU.DOM['#metaThemeDark'].content === '#EDF2F4';
  s.settings.theme = 'auto'; NU.applyTheme(); const a = !('data-theme' in HTML.attrs) && NU.DOM['#metaTheme'].content === '#EDF2F4' && NU.DOM['#metaThemeDark'].content === '#0A2240';
  delete FAKE.StatusBar;
  NU.applyTheme();
  check('状態バー: 画面の色に合わせて StatusBar.setStyle（ダーク = DARK・ライト = LIGHT・自動 = DEFAULT）。StatusBar が無ければ呼ばない。theme-color も合わせる', sb.join() === 'DARK,LIGHT,DEFAULT' && d && l && a, sb.join());
  check('状態バー: 起動の0.9秒後とアプリに戻ったときにも当て直す', /setTimeout\(applyTheme, 900\)/.test(fnSrc('boot')) && /resumeAll\(\);\s*applyTheme\(\);\s*syncNotifications\(\);/.test(SRC), '');
  ST.setS(ST.defaults());
}

// 毎朝の通知（LocalNotifications）
{
  // 予約する一覧
  const at7 = new Date(2026, 9, 19, 8, 0).getTime();
  const L1 = NU.morningList('2026-10-19', '07:00', at7);
  const c2 = Engine.dailyConfig('2026-10-20');
  const first = L1[0];
  const okFirst = first && first.id === NU.NOTI_BASE + 2 && first.title === '今日の段取りが届きました' && first.body.startsWith('No.2「' + c2.title + '」（★☆☆・現場）') &&
    first.schedule.at.getTime() === new Date(2026, 9, 20, 7, 0).getTime() && first.schedule.allowWhileIdle === true && first.extra.date === '2026-10-20';
  const L2 = NU.morningList('2026-10-19', '23:30', at7);
  const ids = new Set(L2.map((x) => x.id));
  const allOK = L2.length === NU.NOTI_DAYS && ids.size === L2.length && L2.every((x, i) => NU.isMine(x.id) && x.id === NU.NOTI_BASE + i + 1 && x.body.includes('「' + Engine.dailyConfig(x.extra.date).title + '」'));
  check('通知: 毎朝の通知は「今日の段取りが届きました」。本文に No.・題名・★・台所／現場。今日から28日分を1日ずつ、時刻を過ぎた分は入れない', okFirst && L1.length === NU.NOTI_DAYS - 1 && allOK, JSON.stringify(first));
  // 予約し直し（syncNow）: 前の予約（このアプリの番号だけ）を取り消してから入れ直す。許可は求めない
  const ln = (granted, allow) => {
    const log = [];
    return { log, granted, allow,
      async getPending() { log.push('getPending'); return { notifications: [{ id: NU.NOTI_BASE + 5 }, { id: 5 }, { id: NU.NOTI_BASE + 12 }] }; },
      async cancel(o) { log.push('cancel:' + o.notifications.map((n) => n.id).join('/')); },
      async checkPermissions() { log.push('check'); return { display: this.granted ? 'granted' : 'prompt' }; },
      async requestPermissions() { log.push('request'); if (this.allow) this.granted = true; return { display: this.allow ? 'granted' : 'denied' }; },
      async schedule(o) { log.push('schedule:' + o.notifications.length); this.list = o.notifications; } };
  };
  UI.setNow(new Date());
  const s = ST.getS();
  s.settings.notifyMorning = true; s.settings.notifyTime = '07:00';
  let N = ln(true, true); FAKE.LocalNotifications = N;
  await NU.syncNotifications();
  const want = NU.morningList(Engine.localDateStr(new Date()), '07:00', Date.now()).map((x) => x.id).join();
  check('通知: 予約し直すときは、このアプリの予約だけを取り消して（ほかの番号は残す）、ON なら入れ直す。許可は求めない',
    N.log[0] === 'getPending' && N.log[1] === 'cancel:' + (NU.NOTI_BASE + 5) + '/' + (NU.NOTI_BASE + 12) && N.log.includes('check') && !N.log.includes('request') && N.list && N.list.map((x) => x.id).join() === want, N.log.join(' '));
  s.settings.notifyMorning = false;
  N = ln(true, true); FAKE.LocalNotifications = N;
  await NU.syncNotifications();
  const offOK = N.log.some((x) => x.startsWith('cancel')) && !N.log.some((x) => x.startsWith('schedule')) && !N.log.includes('request');
  s.settings.notifyMorning = true;
  N = ln(false, true); FAKE.LocalNotifications = N;
  await NU.syncNotifications();
  const noPerm = !N.log.some((x) => x.startsWith('schedule')) && !N.log.includes('request') && NU.denied() === true;
  check('通知: OFF なら取り消すだけ。ON でも許可が無ければ予約せず「許可されていません」を出す（ここでも許可は求めない）', offOK && noPerm, N.log.join(' '));
  // 設定で ON にしたときだけ許可を求める
  s.settings.notifyMorning = false; NU.setDenied(false); NU.TOASTS.length = 0;
  N = ln(false, true); FAKE.LocalNotifications = N;
  await NU.toggleNotify(); await NU.chain();
  const onOK = N.log.includes('request') && ST.getS().settings.notifyMorning === true && N.log.some((x) => x.startsWith('schedule')) && NU.TOASTS.some((t) => /毎朝 07:00 に知らせます/.test(t));
  ST.getS().settings.notifyMorning = false;
  N = ln(false, false); FAKE.LocalNotifications = N;
  await NU.toggleNotify(); await NU.chain();
  const denyOK = N.log.includes('request') && ST.getS().settings.notifyMorning === false && NU.denied() === true && NU.TOASTS.includes('通知が許可されていません') && !N.log.some((x) => x.startsWith('schedule'));
  ST.getS().settings.notifyMorning = true;
  N = ln(true, true); FAKE.LocalNotifications = N;
  await NU.toggleNotify(); await NU.chain();
  const offT = !N.log.includes('request') && ST.getS().settings.notifyMorning === false && !N.log.some((x) => x.startsWith('schedule'));
  check('通知: 設定で ON にしたときだけ許可を求める。断られたら OFF のまま「通知が許可されていません」。OFF にするときは求めない', onOK && denyOK && offT, N.log.join(' '));
  // 設定の画面: 通知の行は LocalNotifications があるときだけ
  NU.DOM['#settingsBody'] = { innerHTML: '' };
  delete FAKE.LocalNotifications;
  NU.renderSettings();
  const webRow = NU.DOM['#settingsBody'].innerHTML;
  FAKE.LocalNotifications = ln(true, true); FAKE.Haptics = { impact() {}, notification() {} };
  ST.getS().settings.notifyMorning = false; NU.renderSettings();
  const offRow = NU.DOM['#settingsBody'].innerHTML;
  ST.getS().settings.notifyMorning = true; ST.getS().settings.notifyTime = '06:30'; NU.setDenied(true); NU.renderSettings();
  const onRow = NU.DOM['#settingsBody'].innerHTML;
  check('設定: 毎朝の通知の行は iOS アプリ（LocalNotifications があるとき）だけ。ON のときは時刻の欄、許可が無ければ注記', !/notifyMorning/.test(webRow) && /data-set="notifyMorning"/.test(offRow) && !/id="notifyTime"/.test(offRow) &&
    /id="notifyTime" value="06:30"/.test(onRow) && /通知が許可されていません/.test(onRow), '');
  check('設定: iOS アプリでは振動の説明と「アプリの中に保存」を出し、サポート・プライバシーポリシーへのリンク（公開の場所の support.html）を置く',
    /カードを置く・完成・最短で軽く震える/.test(onRow) && /アプリの中/.test(onRow) && onRow.includes('href="' + UI.SITE_URL + 'support.html"') && /対応している端末だけ/.test(webRow) && !/軽く震える/.test(webRow), '');
  check('通知: 通知を押したら今日の段取りを開く（このアプリの番号の通知だけ。起動前なら起動のあと）。時刻を変えたら予約し直す',
    /addListener\('localNotificationActionPerformed'/.test(SRC) && /if \(isMine\(id\)\) openFromNotice\(\)/.test(SRC) && /pendingOpen = true/.test(fnSrc('openFromNotice')) &&
    /e\.target\.id !== 'notifyTime'/.test(SRC) && /TIME_RE\.test\(v\)/.test(SRC), '');
  delete FAKE.LocalNotifications; delete FAKE.Haptics; NU.setDenied(false);
  UI.setNow(new Date(2026, 9, 19, 12, 0));
  ST.setS(ST.defaults());
  // 保存: 通知の設定の読み込み
  const sn = ST.sanitize({ v: 1, settings: { notifyMorning: true, notifyTime: '06:45' } });
  const sb = ST.sanitize({ v: 1, settings: { notifyMorning: 'yes', notifyTime: '25:00' } });
  check('保存: 通知の設定（notifyMorning・notifyTime）を読み、形の違う値は既定（OFF・07:00）に戻す', sn.settings.notifyMorning === true && sn.settings.notifyTime === '06:45' && sb.settings.notifyMorning === false && sb.settings.notifyTime === '07:00' &&
    ST.defaults().settings.notifyMorning === false && ST.defaults().settings.notifyTime === '07:00', '');
}

// アプリが裏に回ったとき（ソース）
{
  const pa = fnSrc('pauseAll'), ra = fnSrc('resumeAll');
  check('裏に回ったら: 途中を保存し、段取りの再生・完成の演出・音を止める。戻ったら日付を確かめ、演出の途中だったら結果へ',
    /saveProgress\(\)/.test(pa) && /stopReplay\(\)/.test(pa) && /replayEnd/.test(pa) && /clearTimeout\(finishT\)/.test(pa) && /AC\.suspend/.test(pa) && /checkDay\(\)/.test(ra) && /toResult\(\)/.test(ra), '');
  check('裏に回ったら: ブラウザは visibilitychange、iOS アプリは App の appStateChange（isActive が false で止め、true で戻す）',
    /addEventListener\('visibilitychange', \(\) => \{ if \(document\.hidden\) pauseAll\(\); else resumeAll\(\); \}\)/.test(SRC) &&
    /addListener\('appStateChange'[\s\S]{0,80}isActive === false\) \{ pauseAll\(\); return; \}/.test(SRC), '');
}

// <head> のタグ・PWA の素材（manifest・アイコン・OGP・sw.js・サポートページ）
{
  const SITE = 'https://kiyotake1229.github.io/dandori-meijin/';
  const head = SRC.slice(0, SRC.indexOf('</head>'));
  const has = (re) => re.test(head);
  // manifest と apple-touch-icon は <head> の小さなスクリプトが置く。iframe・sandbox（Claude Artifact）の中では置かない（読みに行って CSP のエラーになるため）
  const headJs = (/<script>([\s\S]*?apple-touch-icon[\s\S]*?)<\/script>/.exec(head) || [])[1] || '';
  const headLinks = (win) => {
    const added = [];
    const c = { window: win, document: { createElement: () => ({}), head: { appendChild: (l) => { added.push(l.rel + ' ' + l.href); } } } };
    vm.createContext(c);
    try { vm.runInContext(headJs, c); } catch (e) { added.push('例外 ' + e.message); }
    return added.join(',');
  };
  const thrower = winOf(); Object.defineProperty(thrower, 'top', { get() { throw new Error('SecurityError'); } });
  check('<head>: manifest と apple-touch-icon は、直接開いたときだけ置く（iframe・sandbox・親を読めない iframe では置かない）',
    headLinks(winOf()) === 'apple-touch-icon apple-touch-icon.png,manifest manifest.json' && headLinks(winOf({ top: {} })) === '' && headLinks(winOf({ origin: 'null' })) === '' && headLinks(thrower) === '', headLinks(winOf()));
  check('<head>: ホーム画面のアプリ名・状態バー・theme-color のライト／ダーク・canonical',
    has(/name="apple-mobile-web-app-capable" content="yes"/) && has(/name="mobile-web-app-capable" content="yes"/) &&
    has(/name="apple-mobile-web-app-title" content="段取り名人"/) && has(/name="apple-mobile-web-app-status-bar-style" content="default"/) &&
    has(/name="theme-color" content="#EDF2F4" media="\(prefers-color-scheme: light\)" id="metaTheme"/) && has(/name="theme-color" content="#0A2240" media="\(prefers-color-scheme: dark\)" id="metaThemeDark"/) &&
    head.includes('<link rel="canonical" href="' + SITE + '">'), '');
  check('<head>: 説明文・OGP（og:url・og:image は公開の場所の絶対 URL、1200×630）・Twitter カード', has(/<meta name="description" content="[^"]{30,}">/) && head.includes('property="og:url" content="' + SITE + '"') &&
    head.includes('property="og:image" content="' + SITE + 'ogp.png"') && has(/og:image:width" content="1200"/) && has(/og:image:height" content="630"/) && has(/name="twitter:card" content="summary_large_image"/) &&
    head.includes('name="twitter:image" content="' + SITE + 'ogp.png"') && has(/property="og:site_name" content="段取り名人"/), '');
  const dir = path.dirname(target);
  const file = (f) => path.join(dir, f);
  const png = (f) => { try { const b = fs.readFileSync(file(f)); return b.toString('ascii', 1, 4) === 'PNG' ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha: b[25] === 4 || b[25] === 6 } : null; } catch (e) { return null; } };
  let man = null; try { man = JSON.parse(fs.readFileSync(file('manifest.json'), 'utf8')); } catch (e) { man = null; }
  const icons = man && Array.isArray(man.icons) ? man.icons : [];
  const iconOK = icons.length === 4 && icons.every((x) => { const p = png(x.src); return p && x.sizes === p.w + 'x' + p.h && x.type === 'image/png'; }) &&
    ['any', 'maskable'].every((pu) => ['192x192', '512x512'].every((sz) => icons.some((x) => x.purpose === pu && x.sizes === sz)));
  check('manifest.json: 名前・start_url と scope は ./・縦向き・地の色はライトの --bg（#EDF2F4）・アイコン 192／512 を any と maskable で（ファイルの大きさも合う）',
    !!man && man.name === '段取り名人' && man.short_name === '段取り名人' && man.start_url === './' && man.scope === './' && man.id === './' && man.display === 'standalone' && man.orientation === 'portrait' &&
    man.theme_color === '#EDF2F4' && man.background_color === '#EDF2F4' && man.lang === 'ja' && iconOK, man ? JSON.stringify(icons) : 'manifest.json が読めない');
  const a = png('apple-touch-icon.png'), ios = png('ios-app/assets/icon.png'), og = png('ogp.png');
  check('画像: apple-touch-icon 180×180・iOS アプリのアイコンの元 1024×1024（透明なし）・OGP 1200×630・icon.svg がある',
    !!a && a.w === 180 && a.h === 180 && !!ios && ios.w === 1024 && ios.h === 1024 && !ios.alpha && !!og && og.w === 1200 && og.h === 630 && fs.existsSync(file('icon.svg')), JSON.stringify({ a, ios, og }));

  // sw.js を偽の Service Worker の環境で動かす
  let swSrc = null; try { swSrc = fs.readFileSync(file('sw.js'), 'utf8'); } catch (e) { swSrc = null; }
  if (!swSrc) check('sw.js: ファイルがある', false, 'sw.js が無い');
  else {
    const H = {}, caches = new Map(), deleted = [], fetched = [];
    const mkCache = () => { const m = new Map(); return { m, async match(r) { return m.get(typeof r === 'string' ? r : r.url); }, async put(r, res) { m.set(typeof r === 'string' ? r : r.url, res); }, async addAll(list) { list.forEach((r) => m.set(r.url, { ok: true })); }, async keys() { return [...m.keys()]; }, async delete(k) { return m.delete(k); } }; };
    const scope = 'https://kiyotake1229.github.io/dandori-meijin/';
    const sw = {
      module: { exports: {} }, console, URL, Promise, setTimeout,
      self: { addEventListener: (t, f) => { H[t] = f; }, registration: { scope, navigationPreload: null }, clients: { claim: async () => {} }, skipWaiting: async () => {}, location: { origin: 'https://kiyotake1229.github.io' } },
      caches: { open: async (n) => { if (!caches.has(n)) caches.set(n, mkCache()); return caches.get(n); }, keys: async () => [...caches.keys()], delete: async (n) => { deleted.push(n); return caches.delete(n); } },
      Request: function (u) { this.url = u; },
      Response: function () {},
      fetch: async (r) => { fetched.push(typeof r === 'string' ? r : r.url); return { ok: true, type: 'basic', status: 200, clone() { return this; } }; },
    };
    vm.createContext(sw);
    let swOK = true;
    try { vm.runInContext(swSrc + '\n;this.SWX = { PREFIX, APP_CACHE, FONT_CACHE, PRECACHE, refill };', sw); } catch (e) { swOK = false; }
    if (!swOK) check('sw.js: 読み込める', false, '');
    else {
      ['dandori-app-v0', 'dandori-old', 'usotsuki-app-v2', 'usotsuki-fonts-v1', 'senda-v2', 'kotsu-v3', sw.SWX.FONT_CACHE].forEach((n) => caches.set(n, mkCache()));
      const waits = [];
      H.activate({ waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
      check('sw.js: 古いキャッシュを消すのは「dandori-」で始まるものだけ（嘘つき村などほかのアプリのキャッシュ・書体のキャッシュは残す）',
        sw.SWX.PREFIX === 'dandori-' && sw.SWX.APP_CACHE.startsWith('dandori-app-') && deleted.sort().join() === 'dandori-app-v0,dandori-old' && caches.has('usotsuki-app-v2') && caches.has('senda-v2') && caches.has(sw.SWX.FONT_CACHE), deleted.join());
      const pre = sw.SWX.PRECACHE.map((u) => u.replace(/^\.\//, ''));
      check('sw.js: 先にキャッシュするファイル（./・index.html・manifest・アイコン3つ・support.html）がこのフォルダにある', ['', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'support.html'].every((f) => pre.includes(f)) &&
        pre.filter((f) => f).every((f) => fs.existsSync(file(f))), pre.join(' '));
      // 消された分だけ取り直す（refill）
      const app = await sw.caches.open(sw.SWX.APP_CACHE);
      app.m.clear(); app.m.set('./index.html', { ok: true }); fetched.length = 0;
      await sw.SWX.refill();
      check('sw.js: ほかのアプリにキャッシュを消されたら、無くなったファイルだけを取り直す（refill）', fetched.length === sw.SWX.PRECACHE.length - 1 && !fetched.includes('./index.html') && sw.SWX.PRECACHE.every((u) => app.m.has(u)), fetched.join(' '));
      // ほかのアプリの場所・ほかのサイトには触らない。書体は書体の決まりで
      const resp = (url, mode) => { let r = false; H.fetch({ request: { method: 'GET', url, mode: mode || 'no-cors' }, respondWith: (p) => { r = true; Promise.resolve(p).catch(() => {}); }, waitUntil: (p) => { Promise.resolve(p).catch(() => {}); }, preloadResponse: Promise.resolve(undefined) }); return r; };
      check('sw.js: 同じドメインのほかのアプリ（/usotsuki-mura/）・ほかのサイトの読み込みには触らない。このアプリのページと Google Fonts は受け持つ',
        !resp('https://kiyotake1229.github.io/usotsuki-mura/', 'navigate') && !resp('https://example.com/x.js') && resp(scope, 'navigate') && resp(scope + 'icon-192.png') &&
        resp('https://fonts.googleapis.com/css2?family=x') && resp('https://fonts.gstatic.com/s/x.woff2') && /cache: 'reload'/.test(swSrc) && /PAGE_TIMEOUT = 4000/.test(swSrc), '');
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // サポートページ: 曜日の表がエンジンの決まり（Engine.WEEK）と同じか・お問い合わせ先・canonical
  let sup = null; try { sup = fs.readFileSync(file('support.html'), 'utf8'); } catch (e) { sup = null; }
  if (!sup) check('support.html: ファイルがある', false, '');
  else {
    const stars = {}, themes = {};
    for (const m of sup.matchAll(/data-wd="(\d)" data-star="(\d)"/g)) stars[m[1]] = +m[2];
    for (const m of sup.matchAll(/data-wd="(\d)" data-theme="(\w+)"/g)) themes[m[1]] = m[2];
    const wbad = [0, 1, 2, 3, 4, 5, 6].filter((wd) => stars[wd] !== Engine.WEEK[wd][0] || themes[wd] !== Engine.WEEK[wd][1]);
    check('support.html: 曜日の表（★と台所／現場）がエンジンの決まり（Engine.WEEK）と同じ', Object.keys(stars).length === 7 && Object.keys(themes).length === 7 && wbad.length === 0, wbad.join(' '));
    check('support.html: canonical・お問い合わせ（GitHub の Issues）・プライバシーポリシー・通知・★2 の幅の説明がある',
      sup.includes('<link rel="canonical" href="' + SITE + 'support.html">') && sup.includes('https://github.com/kiyotake1229/dandori-meijin/issues') && /id="privacy"/.test(sup) && /id="notice"/.test(sup) &&
      /個人情報を集めません/.test(sup) && /最短の1割（四捨五入。少なくとも1分・1日）/.test(sup) && /今日の段取りが届きました/.test(sup), '');
  }
}

/* ---------- 直したことが消えていないか（ソースで確かめる） ---------- */
{
  const has = (re) => re.test(SRC);
  const ui = SRC.slice(SRC.indexOf('// ==ENGINE END=='));
  const css = SRC.slice(SRC.indexOf('<style>'), SRC.indexOf('</style>'));
  check('画面: 今日は clampDay を通す（No.1 より前は日付ごと丸める）', has(/const today = \(\) => clampDay\(rawToday\(\)\);/) && has(/const cfg = dailyOf\(td\);/), '');
  check('画面: 問題は読み込み中の表示を出してから、次のフレームで作る', /loadingHTML\(\)/.test(fnSrc('openCase')) && /setTimeout\(\(\) => \{[\s\S]*makePuzzle\(spec\)/.test(fnSrc('openCase')) && /token !== loadToken/.test(fnSrc('openCase')), '');
  check('画面: 画面を離れたら、作りかけの問題と完成の演出のタイマーを捨てる', /loadToken\+\+/.test(fnSrc('leavePlay')) && /clearTimeout\(finishT\)/.test(fnSrc('leavePlay')) && /stopReplay\(\)/.test(fnSrc('show')), '');
  check('画面: alert・confirm・prompt を使わない', !/\b(alert|confirm|prompt)\s*\(/.test(ui.replace(/\/\/.*$/gm, '')), '');
  check('画面: 記録を消すと目印（epoch）を新しくし、途中の保存は目印が違えば書き戻さない', /epoch = Date\.now\(\)\.toString\(36\)/.test(fnSrc('wipe')) && /s\.epoch \|\| ''\) !== \(P\.epoch/.test(fnSrc('saveProgress')), '');
  check('画面: 保存の読み書きは try で囲む（localStorage を直接読む所は STORE の中と起動時の確認だけ）', (ui.match(/localStorage\./g) || []).length === (between('// ==STORE START==', '// ==STORE END==').match(/localStorage\./g) || []).length + 1, (ui.match(/localStorage\./g) || []).length);
  check('CSS: color-mix() を使わない（iOS Safari 16.1 以前で帯の背景が消える）', !/color-mix\(/.test(css), '');
  // 工程表（.gt・.gb・軸・目盛り）の文字は 11px 以上
  const small = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (!/\.g[tb]\b|\.gt-/.test(sel)) continue;
    for (const f of m[2].matchAll(/font-size:\s*([\d.]+)px/g)) if (+f[1] < 11) small.push(sel + ' ' + f[1] + 'px');
  }
  check('CSS: 工程表の文字（レーン名・帯・番号・目盛り）は11px以上', small.length === 0, small.join(' / '));
  // #0005 の画面の直し: 狭い帯でも番号を出す・今日のカードの表の二重線・記録帳の結果の★・320px で飾りを出さない・1文字だけ落ちる折り返し
  check('CSS: 狭い帯（xs）でも番号を出し、名前だけを隠す', /\.gb\.xs \.t\{display:none\}/.test(css) && !/\.gb\.xs \.n\{display:none/.test(css) && !/\.gb\.xs \.t,\.gb\.xs \.n\{display:none\}/.test(css) && /\.gb\.xs \.n\{position:absolute/.test(css), '');
  check('CSS: 今日のカードの表は、3つ目のマス（難しさ）の右の線を消す（外枠と二重にしない）', /\.tblock>div:nth-child\(3\)\{border-right:0\}/.test(css) && !/\.tblock>div:last-child\{border-right:0\}/.test(css), '');
  check('記録帳: 結果の★は「結果」と添えて難しさの★と見分ける（読み上げも「結果」「難しさ」）。前の版の問題の記録は★を出さない', /lg-res/.test(fnSrc('dayRowHTML')) && /'結果 ★' \+ st/.test(fnSrc('dayRowHTML')) && /'難しさ ★' \+ c\.star/.test(fnSrc('dayRowHTML')) && /r\.bestMs != null && r\.v === Engine\.VERSION/.test(fnSrc('dayRowHTML')), '');
  check('CSS: 360px 未満では今日のカードの飾りを出さない・並べ方の表と注意文は「を」の後や区切りで折り返す', /@media \(max-width:359px\)\{[\s\S]*\.today-deco\{display:none\}/.test(css) && /を<wbr>/.test(fnSrc('orderTableHTML')) && /日付が<wbr>2026年10月19日より<wbr>前です/.test(SRC), '');
  check('遊び方: ★2 の幅は四捨五入と書く・2つある道具の決まりを書く', /最短の1割（四捨五入/.test(fnSrc('renderHowto')) && /コンロや職人が2つあるときは/.test(fnSrc('renderHowto')), '');
  check('文書: <!doctype html> と <title>段取り名人</title>', /^<!doctype html>/i.test(SRC) && SRC.includes('<title>段取り名人</title>'), '');
  // 読み込むもの（src・<link> の href（canonical を除く）・書体の読み込み）は Google Fonts だけ。
  // 移動するだけのリンク（canonical・<a href>）は公開の場所（GitHub Pages）だけ（#0006 で canonical とサポートのリンクを足した）
  const SITE = 'https://kiyotake1229.github.io/dandori-meijin/';
  const google = (u) => /^https:\/\/fonts\.(googleapis|gstatic)\.com(\/|$)/.test(u);
  const loads = [...SRC.matchAll(/\bsrc\s*=\s*["'](https?:[^"']+)/g)].map((m) => m[1])
    .concat([...SRC.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]).filter((t) => !/rel="canonical"/.test(t)).map((t) => (/href\s*=\s*["'](https?:[^"']+)/.exec(t) || [])[1]).filter(Boolean))
    .concat([...SRC.matchAll(/l\.href = '(https?:[^']+)'/g)].map((m) => m[1]));
  const links = [...SRC.matchAll(/<link\b[^>]*rel="canonical"[^>]*>/g)].map((m) => (/href="([^"]+)"/.exec(m[0]) || [])[1])
    .concat([...SRC.matchAll(/<a\b[^>]*href\s*=\s*["'](https?:[^"']+)/g)].map((m) => m[1]));
  check('外部から読み込むのは Google Fonts だけ（canonical・リンクは公開の場所だけ）', loads.length > 0 && loads.every(google) && links.every((u) => u.startsWith(SITE)) && lineOf('const SITE_URL = ').includes("'" + SITE + "'"), loads.concat(links).join(' '));
  check('画面: download のリンクは出さない（Artifact の iframe・iOS アプリでは効かない。出すなら NATIVE・FRAMED で外す）',
    ui.split('\n').filter((l) => /\bdownload\s*=/.test(l)).every((l) => /FRAMED/.test(l) && /NATIVE/.test(l)), '');
  const eng = between('// ==ENGINE START==', '// ==ENGINE END==');
  check('エンジン: 生成に Math.random を使わない', !/Math\.random/.test(eng.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), '');
  check('目印（NATIVE・DAYRULES・STORE）は1回ずつ', ['NATIVE START', 'NATIVE END', 'DAYRULES START', 'DAYRULES END', 'STORE START', 'STORE END'].every((k) => SRC.split('// ==' + k + '==').length === 2), '');
}

let fail = 0;
console.log('検査対象: ' + target + '\n');
for (const r of results) {
  if (!r.ok) fail++;
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}` + (r.ok || r.detail === '' || r.detail == null ? '' : '\n        ' + r.detail));
}
console.log(`\n${fail ? 'FAIL' : 'PASS'}  ${results.length}項目`);
process.exit(fail ? 1 : 0);
