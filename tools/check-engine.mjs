#!/usr/bin/env node
// 段取り名人 — エンジン検査
// 使い方: node tools/check-engine.mjs [index.html | engine.js] [--count 120] [--days 365] [--perf-seeds 300]
// .html なら「// ==ENGINE START==」〜「// ==ENGINE END==」の間を取り出して評価する。
// 検算はエンジンの関数を使わず、ここで独立に書く（並べ替えの総当たり・時刻の決め方（2つある道具は前の作業の続きを同じレーンで）・
// よく知られたコツ（同点の選び方は全部ためす）・賢い置き方で最短に届く確率・予想の範囲・1枚だけ動かす直し方・解説の文の中身（決め手の一手は総当たりで確かめる））。
// --count = ★×テーマごとの練習の問題数、--days = 日替わりの日数（2026-10-19 から）、--perf-seeds = 生成時間の最悪値を探す数（表示だけ）
// 外部パッケージは使わない（Node.js だけで動く）。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : def;
};
const here = path.dirname(fileURLToPath(import.meta.url));
const OPT_NAMES = ['--count', '--days', '--perf-seeds'];
const optIdx = new Set(OPT_NAMES.map((n) => argv.indexOf(n)).filter((i) => i >= 0).map((i) => i + 1));
const target = path.resolve(argv.find((a, i) => !a.startsWith('--') && !optIdx.has(i)) || path.join(here, '..', 'index.html'));
const COUNT = parseInt(opt('--count', '120'), 10);
const DAYS = parseInt(opt('--days', '365'), 10);
const PERF_SEEDS = parseInt(opt('--perf-seeds', '300'), 10);

/* ---------- 回帰テストの基準（問題が変わっていないか） ----------
 * VERSION ごとに、次の3つの SHA-256（先頭32文字）を持つ。
 *   daily365    = 2026-10-19 から365日分の JSON.stringify(Engine.daily(日付)) + '\n' をつないだもの
 *   practice120 = ★1〜3 × 台所・現場 × seed 'r0'〜'r19' の JSON.stringify(Engine.generate(...)) + '\n' をつないだもの
 *   fixed4      = はじめての段取り 1〜3 と例題の JSON.stringify(...) + '\n' をつないだもの
 * 値が変わったら、全員の日替わり・練習・はじめての段取りの問題が変わったということ。
 * 意図した変更なら、エンジンの VERSION を上げて docs に書き、ここに新しい VERSION の値を足す。 */
const GOLDEN = {
  1: { daily365: '3157995e075e605a7294da5087103ef2', practice120: '0a612a8218a991885abbea9165e47d09', fixed4: 'f8bbe8876159e929dcd2d7aa555e97d1' },
  // 2: #0002 クレーンだけの作業を「吊り込む」に・和の朝ごはんの目玉焼きを焼き魚に（日替わり・練習の問題が変わる）
  2: { daily365: 'bb115a31049e2311663bf71de26f20e7', practice120: 'd79c68e10db331d8a4507a797049a782', fixed4: '74334e8db2d5e03cb3bc51165e8ec3d5' },
  // 3: #0003 監査の反映（★の難しさ・同点・予想の範囲・できたて・部品表・日替わりの曜日・はじめての段取り。全部の問題が変わる）
  3: { daily365: '5cc9efb3e1780f10a4b160489f31608f', practice120: '33ad478aa0f5d027aaa2fd5a25b21211', fixed4: '1df920dc1ea5df5021e1a9841afe6272' },
  // 4: #0005 点検の反映（2つある道具は前の作業の続きを同じレーンで・★2/★3 の smart の上限と目安・予想の範囲・おにぎり/炊き込みご飯/ピザ・
  //    花壇の街灯を立てる・公園/キャンプ場を★3 から外す・お弁当は日替わりに出さない・rare の目安・はじめての段取りの案内。全部の問題が変わる）
  4: { daily365: '25579dacc929a8086ada06d44ebc2aa3', practice120: '242193c8de73b90c101992f3a6221329', fixed4: '4962f2a3566c2bb0549d4f4b4d0c4a5f' },
};

/* ---------- 決まり（エンジンとは別にここで持つ。仕様書の値） ---------- */
const DAY1 = Date.UTC(2026, 9, 19);
// 曜日（0 = 日曜）→ [★, テーマ]。月・火 ★1、水・木・金 ★2、土・日 ★3。台所と現場を交互に（#0003。どちらのテーマにも★1〜★3が出る）
const WEEK = { 0: [3, 'site'], 1: [1, 'kitchen'], 2: [1, 'site'], 3: [2, 'kitchen'], 4: [2, 'site'], 5: [2, 'kitchen'], 6: [3, 'kitchen'] };
const SHAPE = {
  1: { n: [4, 5], types: [2, 3], dual: [0, 0] },
  2: { n: [6, 7], types: [3, 4], dual: [0, 1] },
  3: { n: [7, 8], types: [4, 5], dual: [0, 2] },
};
// 良い問題の条件。ratio = 最短の並べ方 / 並べ方の総数 の上限。
// 仕様書の条件は 0.2。★1 だけは 0.4 まで（作業4〜5個では並べ方が数通り〜数十通りしかなく、0.2 では作れないため。#0002 の 0.5 から #0003 で下げた）。
// エンジンは目安 0.34 以下の問題を優先して探す（台所★1は8割以上が目安以下。下の集計で確かめる）
const RATIO = { 1: 0.4, 2: 0.2, 3: 0.2 };
const RATIO_GOAL = { 1: 0.34 };
const RATIO_GOAL_SHARE = { kitchen: 0.8, site: 0.3 };   // ★1 で目安以下になる問題の割合の下限
const TOP_GAP = 3;
// よく知られたコツ（同点の選び方を全部ためして、どれでも届かないこと）。★2 は長い順・放置できる順、★3 はさらに後に続く流れが長い順
const TRICKS = { 1: [], 2: ['lpt', 'idle'], 3: ['lpt', 'idle', 'cp'] };
const PERSON = { kitchen: 'hand', site: 'worker' };
const UNIT = { kitchen: '分', site: '日' };
const RES_TYPES = { kitchen: ['hand', 'stove', 'rice', 'oven', 'micro'], site: ['worker', 'digger', 'truck', 'mixer', 'crane'] };
const ICONS = new Set(['hand', 'stove', 'rice', 'oven', 'micro', 'worker', 'digger', 'truck', 'mixer', 'crane', 'wait']);
const NAME_MAX = 9;        // カード2列に収まる作業名の長さ
const TIP_MAX = 90;        // 「ここがコツ」1文の長さの上限
// できたてで出したい作業（#0003）。冷めてもよい献立（お弁当・作り置き）以外では、見せる最短の段取りで完成の少し前に仕上がる
const HOT_RE = /^(目玉焼きを焼く|パンを焼く|餃子を焼く|炒飯を炒める|天ぷらを揚げる|唐揚げを揚げる|グラタンを焼く|ピザを焼く|ハンバーグを焼く|ホイル焼きを焼く|コーヒーをいれる)$/;
const COLD_MENUS = new Set(['bento', 'undokai', 'tsukurioki']);
const HOT_SLACK = (best) => Math.max(2, Math.floor(best * 0.25));
// 結果の★: 最短なら★3、最短 + near 以内なら★2（near = 最短の1割を四捨五入。少なくとも1）
const NEAR = (best) => Math.max(1, Math.round(best * 0.1));
// ★の難しさの物差し（smart = いちばん早く始められる作業から1つを同じ確率で選んでいく人が最短に届く確率）の平均が、★1 > ★2 > ★3 で、差がこれ以上
const SMART_GAP = 0.02;
// 予想のスライダー（VERSION 4）: 最短は下限・上限から2以上離れ、範囲の真ん中（切り捨て・切り上げ）が最短 ± near に入らない。
// 台所・現場★3 では、最短が範囲の左寄り・右寄りのどちらにも GUESS_SIDE 以上ある（範囲から答えの位置が読めない）。
// 現場★1・★2 は最短が小さく（4〜8日）、下限が1を割るので右寄りにできないことが多い（左寄りが多くてよい）
const GUESS_SIDE = 0.2;
// ★の難しさ（VERSION 4）: smart の上限（★2 は 0.5 未満、★3 は 0.3 未満。日替わりに出さないお弁当の★3 だけ 0.5 未満）
const SMART_MAX = { 2: 0.5, 3: 0.3 };
const SMART_MAX_LOOSE = { bento: 0.5, undokai: 0.5 };
// 日替わりで、同じ週のどの★2 よりも smart が大きい（やさしい）★3 がある週の上限（52週のうち）
const WEEK_INVERT_MAX = 12;
// 現場★2・★3で「塗る→乾かす」が出る問題の割合の上限（#0003: 4〜5割に出ていて、どの題材も似て見えた）
const PAINT_SHARE = 0.35;
// 生成時間の目標（ms。Node。スマホは4〜6倍遅いと考える）。max は測り直した値（下の SLOW を参照）で見る。
// 画面は「読み込み中」を出してから次のフレームで作るので、スマホで 0.5 秒前後までなら固まって見えない
// 合否の線は仕様の目標（最大 300ms 以下）。100ms は目安（aim）で、超えた数と最大を表示するだけ（#0009）。
// 100ms を合否にしていたときは、ふだんでも最大が 100ms ぎりぎりで、マシンが混んでいると 119〜214ms で FAIL していた
const PERF = { avg: 50, max: 300, aim: 100 };
const BAD = /undefined|NaN|null|\[object|Infinity/;

/* ---------- 読み込み ---------- */
if (!fs.existsSync(target)) {
  console.log('検査対象: ' + target + '\n\nFAIL  検査対象がありません（ファイルが無い）: ' + target);
  process.exit(1);
}
const SRC = fs.readFileSync(target, 'utf8');
function extractCode(file) {
  if (!file.endsWith('.html')) return SRC;
  const lines = SRC.split('\n');
  const s = lines.findIndex((l) => l.includes('// ==ENGINE START=='));
  const e = lines.findIndex((l) => l.includes('// ==ENGINE END=='));
  if (s < 0 || e < 0 || e <= s) throw new Error('ENGINE START/END の目印が見つかりません: ' + file);
  return lines.slice(s + 1, e).join('\n');
}
function loadEngine(code) {
  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(code + '\n;module.exports = (typeof Engine !== "undefined") ? Engine : module.exports;', sandbox, { filename: path.basename(target) });
  const E = sandbox.module.exports;
  for (const fn of ['generate', 'daily', 'dailyConfig', 'schedule', 'canPlace', 'solve', 'explain', 'tutorial', 'example']) {
    if (typeof E[fn] !== 'function') throw new Error('Engine.' + fn + ' がありません');
  }
  return E;
}
// Web Worker と同じ条件で読む: window・document・module が無く、self（= グローバル）だけがある
function loadAsWorker(code) {
  const sandbox = {};
  sandbox.self = sandbox;
  sandbox.postMessage = () => {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: path.basename(target) + ' (worker)' });
  return sandbox.self.Engine;
}
const code = extractCode(target);
const E = loadEngine(code);
const E2 = loadEngine(code); // 再現性の確認用（キャッシュを共有しない別インスタンス）
const fresh = () => loadEngine(code);

/* ---------- 結果の記録 ---------- */
// 検査の途中でエンジンが例外を出しても、黙って止まらずに FAIL と分かるようにする
process.on('uncaughtException', (e) => {
  console.log('\nFAIL  検査の途中でエンジンが例外を出しました: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' / ') : e));
  process.exit(1);
});
const results = [];
const failures = {};
function record(name, ok, detail) {
  let r = results.find((x) => x.name === name);
  if (!r) { r = { name, pass: 0, fail: 0 }; results.push(r); }
  if (ok) r.pass++;
  else {
    r.fail++;
    failures[name] = failures[name] || [];
    if (failures[name].length < 5) failures[name].push(detail);
  }
  return ok;
}

/* ---------- 独立した時刻の決め方 ----------
 * 置いた順に、開始 = max(前提の作業の終わり, 使う資源の種類ごとに「いちばん早く空くレーン」の空く時刻)。
 * レーンの末尾に積む（前に割り込まない）。order に前提を満たさない作業があれば ok=false。
 * 同じ種類の道具が2つあるとき（VERSION 4）のレーンは、開始時刻を変えずに次の順で選ぶ:
 *  1) 前の作業がまだ最後にいるレーン（同じ鍋・同じ職人で続ける。前の作業が2つなら遅く終わったほう、同じなら番号の小さいほう）
 *  2) 開始までに空いているレーンのうち、続きを待っていない（最後の作業の後に、同じ種類の道具を使う作業がまだ置かれていない）ものの、早く空いたほう（同じなら前）
 *  3) どれも続きを待っているなら、早く空いたほう（同じなら、最後の作業の番号が小さいほう） */
function lanesByType(pz) {
  const m = {};
  pz.lanes.forEach((l, li) => { if (l.type !== 'wait') (m[l.type] = m[l.type] || []).push(li); });
  return m;
}
function indepDecode(pz, order) {
  const n = pz.tasks.length;
  const byType = lanesByType(pz);
  const free = pz.lanes.map(() => 0);
  const lastOn = pz.lanes.map(() => -1);
  const start = Array(n).fill(null), end = Array(n).fill(null), lanesOf = Array(n).fill(null);
  let ms = 0;
  for (const i of order) {
    const t = pz.tasks[i];
    if (start[i] != null) return { ok: false, why: '同じ作業を2回' };
    for (const p of t.after) if (end[p] == null) return { ok: false, why: '前提が先に無い ' + i + '<' + p };
    let s = 0;
    for (const p of t.after) s = Math.max(s, end[p]);
    for (const ty of t.needs) {
      const ls = byType[ty];
      if (!ls) return { ok: false, why: '資源が無い ' + ty };
      s = Math.max(s, Math.min(...ls.map((l) => free[l])));
    }
    const used = [];
    for (const ty of t.needs) {
      const ls = byType[ty];
      let pick;
      if (ls.length === 1) pick = ls[0];
      else {
        // 続きを待っている = そのレーンの最後の作業の後に、同じ種類の道具を使う作業でまだ置いていないものがある
        const waiting = (l) => lastOn[l] >= 0 && pz.tasks.some((y, j) => start[j] == null && j !== i && y.after.includes(lastOn[l]) && y.needs.includes(ty));
        const mine = ls.filter((l) => lastOn[l] >= 0 && t.after.includes(lastOn[l]));
        if (mine.length) pick = mine.sort((a, b) => end[lastOn[b]] - end[lastOn[a]] || lastOn[a] - lastOn[b])[0];
        else {
          const ok = ls.filter((l) => free[l] <= s);
          const un = ok.filter((l) => !waiting(l));
          pick = un.length ? un.sort((a, b) => free[a] - free[b] || a - b)[0] : ok.sort((a, b) => free[a] - free[b] || lastOn[a] - lastOn[b])[0];
        }
      }
      used.push(pick);
    }
    const e = s + t.dur;
    for (const l of used) { free[l] = e; lastOn[l] = i; }
    start[i] = s; end[i] = e; lanesOf[i] = used;
    ms = Math.max(ms, e);
  }
  return { ok: true, start, end, lanesOf, ms, lanesFree: free, lastOn };
}
// 並べ替えを全部（n! 通り）作り、前提を満たすものだけを数える。最短・最短の数・総数・最短の並べ方の一覧
const bruteCache = new Map();
function brute(pz) {
  const key = JSON.stringify([pz.lanes, pz.tasks]);
  if (bruteCache.has(key)) return bruteCache.get(key);
  const n = pz.tasks.length;
  const a = [...Array(n).keys()];
  let best = Infinity, countBest = 0, countAll = 0;
  let optimal = [];
  const pos = Array(n).fill(0);
  const visit = () => {
    for (let k = 0; k < n; k++) pos[a[k]] = k;
    for (let i = 0; i < n; i++) for (const p of pz.tasks[i].after) if (pos[p] > pos[i]) return;
    countAll++;
    const d = indepDecode(pz, a);
    if (d.ms < best) { best = d.ms; countBest = 1; optimal = [a.slice()]; } else if (d.ms === best) { countBest++; optimal.push(a.slice()); }
  };
  // Heap の方法（並べ替えを1つずつ）
  const c = Array(n).fill(0);
  visit();
  let i = 0;
  while (i < n) {
    if (c[i] < i) {
      if (i % 2 === 0) { const t = a[0]; a[0] = a[i]; a[i] = t; } else { const t = a[c[i]]; a[c[i]] = a[i]; a[i] = t; }
      visit();
      c[i]++;
      i = 0;
    } else { c[i] = 0; i++; }
  }
  const r = { best, countBest, countAll, optimal };
  if (bruteCache.size > 50) bruteCache.delete(bruteCache.keys().next().value);
  bruteCache.set(key, r);
  return r;
}
// 上から順（独立に書く）。置ける作業（前提がそろったもの）のうち、画面でいちばん上のカード
function indepTop(pz) {
  const n = pz.tasks.length;
  const placed = new Set();
  const order = [];
  while (order.length < n) {
    let pick = -1;
    for (let i = 0; i < n && pick < 0; i++) if (!placed.has(i) && pz.tasks[i].after.every((p) => placed.has(p))) pick = i;
    order.push(pick);
    placed.add(pick);
  }
  return { order, ms: indepDecode(pz, order).ms };
}
// 後に続く流れの長さ（自分を含む）
function tailOf(pz) {
  const n = pz.tasks.length;
  const succ = pz.tasks.map(() => []);
  pz.tasks.forEach((t, i) => t.after.forEach((p) => succ[p].push(i)));
  const memo = {};
  const f = (i) => (memo[i] != null ? memo[i] : (memo[i] = pz.tasks[i].dur + Math.max(0, ...succ[i].map(f))));
  return [...Array(n).keys()].map(f);
}
// よく知られたコツ（独立に書く）。置ける作業から、決まりでいちばん上のものを選ぶ。同点（決まりの上で区別がつかない作業）は全部の選び方をたどる。
//  lpt = 長い作業から、idle = 自分（手・職人）を使わない作業から・その中で長い作業から、cp = 後に続く流れが長い作業から・同じなら長い作業から、
//  est = いちばん早く始められる作業から・同じなら後に続く流れが長い作業から。戻り値 { min, max }（完成時刻の最小・最大）
function indepTrick(pz, mode) {
  const n = pz.tasks.length;
  const person = PERSON[pz.theme];
  const tail = tailOf(pz);
  const memo = new Map();
  const score = (i, order) => {
    const t = pz.tasks[i];
    if (mode === 'lpt') return [t.dur];
    if (mode === 'idle') return [t.needs.includes(person) ? 0 : 1, t.dur];
    if (mode === 'cp') return [tail[i], t.dur];
    return [-indepDecode(pz, order.concat([i])).start[i], tail[i]];
  };
  const cmp = (a, b) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] - b[k]; return 0; };
  const rec = (order) => {
    if (order.length === n) { const ms = indepDecode(pz, order).ms; return [ms, ms]; }
    const d = indepDecode(pz, order);
    const placed = new Set(order);
    const key = [...placed].sort((x, y) => x - y).join(',') + '|' + d.end.map((e, i) => (placed.has(i) ? e : '')).join(',') + '|' + JSON.stringify(d.lanesFree) + '|' + JSON.stringify(d.lastOn) + '|' + d.ms;   // レーンごとの空く時刻と最後の作業（続きの決まりに要る）
    if (memo.has(key)) return memo.get(key);
    const av = [];
    for (let i = 0; i < n; i++) if (!placed.has(i) && pz.tasks[i].after.every((p) => placed.has(p))) av.push([i, score(i, order)]);
    let top = null;
    for (const [, k] of av) if (!top || cmp(k, top) > 0) top = k;
    let mn = Infinity, mx = -Infinity;
    for (const [i, k] of av) if (cmp(k, top) === 0) { const r = rec(order.concat([i])); mn = Math.min(mn, r[0]); mx = Math.max(mx, r[1]); }
    memo.set(key, [mn, mx]);
    return [mn, mx];
  };
  const r = rec([]);
  return { min: r[0], max: r[1] };
}
// 「賢い置き方」で最短に届く確率（独立に書く）: いちばん早く始められる作業の中から1つを同じ確率で選んでいく
function indepSmart(pz, best) {
  const n = pz.tasks.length;
  const memo = new Map();
  const rec = (order) => {
    const d = indepDecode(pz, order);
    if (d.ms > best) return 0;
    if (order.length === n) return d.ms === best ? 1 : 0;
    const placed = new Set(order);
    const key = [...placed].sort((x, y) => x - y).join(',') + '|' + d.end.map((e, i) => (placed.has(i) ? e : '')).join(',') + '|' + JSON.stringify(d.lanesFree) + '|' + JSON.stringify(d.lastOn) + '|' + d.ms;   // レーンごとの空く時刻と最後の作業（続きの決まりに要る）
    if (memo.has(key)) return memo.get(key);
    const av = [];
    for (let i = 0; i < n; i++) if (!placed.has(i) && pz.tasks[i].after.every((p) => placed.has(p))) av.push([i, indepDecode(pz, order.concat([i])).start[i]]);
    const m = Math.min(...av.map((x) => x[1]));
    const c = av.filter((x) => x[1] === m);
    let p = 0;
    for (const [i] of c) p += rec(order.concat([i]));
    p /= c.length;
    memo.set(key, p);
    return p;
  };
  return rec([]);
}
// 前提だけで見た最も長い流れ・全作業の合計
function longestChain(pz) {
  const memo = {};
  const f = (i) => (memo[i] != null ? memo[i] : (memo[i] = pz.tasks[i].dur + Math.max(0, ...pz.tasks[i].after.map(f))));
  return Math.max(...pz.tasks.map((_, i) => f(i)));
}
// どんな並べ方でもこれより早くは終わらない時刻（最も長い流れ・資源の種類ごとの作業の合計 ÷ 台数）
function lowerBoundOf(pz) {
  let lb = longestChain(pz);
  for (const [ty, ls] of Object.entries(lanesByType(pz))) {
    const sum = pz.tasks.filter((t) => t.needs.includes(ty)).reduce((x, t) => x + t.dur, 0);
    lb = Math.max(lb, Math.ceil(sum / ls.length));
  }
  return lb;
}
function hasUndefined(o) {
  if (o === undefined) return true;
  if (typeof o === 'number' && !Number.isFinite(o)) return true;
  if (o && typeof o === 'object') return Object.values(o).some(hasUndefined);
  return false;
}
// 前提を満たすランダムな順番（検査用の乱数。エンジンの乱数は使わない）
let lcg = 20261019;
const rnd = () => { lcg = (Math.imul(lcg, 1103515245) + 12345) >>> 0; return lcg / 4294967296; };
function randomOrder(pz, len) {
  const n = pz.tasks.length;
  const placed = new Set(), order = [];
  while (order.length < (len == null ? n : len)) {
    const avail = [];
    for (let i = 0; i < n; i++) if (!placed.has(i) && pz.tasks[i].after.every((p) => placed.has(p))) avail.push(i);
    if (!avail.length) break;
    const x = avail[Math.floor(rnd() * avail.length)];
    order.push(x); placed.add(x);
  }
  return order;
}
const qn = (s) => '「' + s + '」';
function rangeText(a, b, u) { return a === 0 ? '最初の' + b + u : a + '〜' + b + u + 'の' + (b - a) + u; }

/* ---------- 問題そのものの検査 ---------- */
// 作業名 → 使う資源（テーマごと）。同じ名前の作業が、問題によって違う資源を使っていないか（#0002: 「すべり台を据える」が★で職人の有無が変わった）
const nameNeeds = { kitchen: new Map(), site: new Map() };
const CRANE_VERB = /(据える|立てる|架ける|載せる)$/;   // クレーンだけの作業には使わない（職人＋クレーンの作業の名前）
function inspectShape(pz, tag, opts) {
  const n = pz.tasks.length;
  if (nameNeeds[pz.theme] && pz.menu !== 'example' && pz.menu !== 'tutorial') {
    for (const t of pz.tasks) {
      const k = t.needs.slice().sort().join('+') || 'wait';
      const m = nameNeeds[pz.theme];
      if (!m.has(t.name)) m.set(t.name, new Map());
      if (!m.get(t.name).has(k)) m.get(t.name).set(k, tag);
    }
  }
  if (pz.theme === 'site') record('現場: クレーンだけの作業に「据える・立てる・架ける・載せる」を使わない（吊り込む）', pz.tasks.every((t) => !(t.needs.length === 1 && t.needs[0] === 'crane' && CRANE_VERB.test(t.name))), tag + ' ' + pz.tasks.filter((t) => t.needs.join() === 'crane').map((t) => t.name).join(','));
  const names0 = pz.tasks.map((t) => t.name);
  const has = (nm) => names0.includes(nm);
  const made = pz.menu !== 'example' && pz.menu !== 'tutorial';
  if (pz.theme === 'kitchen') {
    const eggs = pz.tasks.filter((t) => /目玉焼き|卵焼き/.test(t.name)).map((t) => t.name.replace(/を.*$/, ''));
    record('台所: 1つの献立に卵料理（目玉焼き・卵焼き）を2品入れない', new Set(eggs).size <= 1, tag + ' ' + eggs.join(','));
    // #0003: 料理として不自然な組み合わせ・所要時間（煮卵なのに漬けない・サラダがちぎるだけ・ゼリーやプリンを10〜20分で冷やし固める）
    const odd = [];
    if (made && has('殻をむく') && !has('たれに漬ける')) odd.push('煮卵なのにたれに漬けない');
    if (has('レタスをちぎる') && !has('サラダを和える')) odd.push('サラダがちぎるだけ');
    for (const bad of ['冷やし固める', 'プリンを冷やす']) if (has(bad)) odd.push(bad);
    // #0005: おにぎりなのに握らない・具だくさんの炊き込みご飯に具が無い・「生地から作る」なのに生地をのばすだけ
    if (made && (pz.parts || []).includes('おにぎり') && !has('おにぎりを握る')) odd.push('おにぎりを握らない');
    if (has('ご飯を炊き込む') && !has('具を刻む')) odd.push('炊き込みご飯に具が無い');
    if (/生地から/.test(pz.story) && !has('ピザ生地をこねる')) odd.push('生地から作ると書いて生地をこねない');
    record('台所: 料理として不自然な作業がない（煮卵は漬ける・サラダは和える・冷やし固めるは氷水で・おにぎりは握る・炊き込みご飯は具を刻む）', odd.length === 0, tag + ' ' + odd.join(','));
    // できたての作業の印（hot）は、決まった作業名だけ。冷めてもよい献立（お弁当・作り置き）には付けない
    if (made) {
      const bad = pz.tasks.filter((t) => !!t.hot !== (HOT_RE.test(t.name) && !COLD_MENUS.has(pz.menu))).map((t) => t.name);
      record('台所: できたての作業に印（hot）が付いている', bad.length === 0, tag + ' ' + pz.menu + ' ' + bad.join(','));
    }
  }
  if (made) record('題名・あらすじに季節の言葉を入れない（日替わりは一年中出る）', !/クリスマス|秋の|冬の|寒い日|春の|夏休み/.test(pz.title + pz.story), tag + ' ' + pz.title + ' ' + pz.story);
  if (pz.theme === 'site' && made) {
    // #0003: 職人が何日も積み込みをする・測るのに2〜3日・白線に2〜3日・運ぶのに3日は不自然
    const odd = pz.tasks.filter((t) => /積み込む$/.test(t.name) || (/測る$|白線を引く/.test(t.name) && t.dur > 1) || (/運ぶ$/.test(t.name) && t.dur > 2)).map((t) => t.name + t.dur);
    record('現場: 作業名と日数が自然（積み込みに職人を使わない・測る・白線は1日・運ぶは2日まで）', odd.length === 0, tag + ' ' + odd.join(','));
  }
  record('JSON化できる・undefined が無い', !hasUndefined(pz) && JSON.stringify(JSON.parse(JSON.stringify(pz))) === JSON.stringify(pz), tag);
  record('テーマと単位', (pz.theme === 'kitchen' || pz.theme === 'site') && pz.unit === UNIT[pz.theme], tag + ' ' + pz.theme + ' ' + pz.unit);
  record('題名・あらすじ', typeof pz.title === 'string' && pz.title.length > 0 && typeof pz.story === 'string' && pz.story.length > 0 && !BAD.test(pz.title + pz.story), tag);
  // レーン
  const ids = pz.lanes.map((l) => l.id);
  const real = pz.lanes.filter((l) => l.type !== 'wait');
  const laneOk = new Set(ids).size === ids.length && pz.lanes.every((l) => typeof l.name === 'string' && l.name && ICONS.has(l.icon)) &&
    real.every((l) => RES_TYPES[pz.theme].includes(l.type));
  record('レーン（id が重ならない・名前・アイコン・テーマの資源）', laneOk, tag + ' ' + JSON.stringify(pz.lanes));
  const hasWait = pz.tasks.some((t) => t.needs.length === 0);
  const waitLanes = pz.lanes.filter((l) => l.type === 'wait').length;
  record('待つだけの作業があるときだけ「待つだけ」のレーン', waitLanes === (hasWait ? 1 : 0), tag);
  // 作業
  const names = pz.tasks.map((t) => t.name);
  const tasksOk = pz.tasks.every((t) => Number.isInteger(t.dur) && t.dur >= 1 && Array.isArray(t.needs) && new Set(t.needs).size === t.needs.length &&
    t.needs.every((ty) => real.some((l) => l.type === ty)) && Array.isArray(t.after) && t.after.every((p) => Number.isInteger(p) && p >= 0 && p < n) &&
    ICONS.has(t.icon));
  record('作業（所要時間・資源・前提の番号・アイコン）', tasksOk, tag);
  record('作業名が重ならない・短い（' + NAME_MAX + '文字まで）', new Set(names).size === n && names.every((s) => s.length >= 2 && s.length <= NAME_MAX && !BAD.test(s)),
    tag + ' ' + names.filter((s) => s.length > NAME_MAX).join(','));
  // 前提は循環しない・重複や推移的に余分なものが無い
  const order = randomOrder(pz);
  const anc = pz.tasks.map(() => new Set());
  const topo = order.length === n;
  if (topo) for (const i of order) for (const p of pz.tasks[i].after) { anc[i].add(p); anc[p].forEach((x) => anc[i].add(x)); }
  const reduced = topo && pz.tasks.every((t) => new Set(t.after).size === t.after.length && t.after.every((p) => !t.after.some((q) => q !== p && anc[q].has(p))));
  record('前提は循環せず、余分なもの（推移的に重なるもの）が無い', reduced, tag);
  // ★の形
  if (opts && opts.shape) {
    const S = SHAPE[pz.target];
    const types = new Set(pz.tasks.flatMap((t) => t.needs)).size;
    const dual = pz.tasks.filter((t) => t.needs.length >= 2).length;
    const dupType = Object.values(lanesByType(pz)).some((ls) => ls.length >= 2);
    let ok = n >= S.n[0] && n <= S.n[1] && types >= S.types[0] && types <= S.types[1] && dual >= S.dual[0] && dual <= S.dual[1];
    if (pz.target === 3) ok = ok && (dupType || dual >= 1);
    else ok = ok && !dupType;
    // 使われないレーンは出さない
    ok = ok && real.every((l) => pz.tasks.some((t) => t.needs.includes(l.type)));
    record('★の形（作業の数・資源の種類・2資源同時・同じ種類2つ）', ok, tag + ` n=${n} types=${types} dual=${dual} dup=${dupType}`);
    record('自分（手・職人）を使う作業が2つ以上', pz.tasks.filter((t) => t.needs.includes(PERSON[pz.theme])).length >= 2, tag);
  }
}
// 最短・条件の検算。戻り値に総当たりの結果を返す
function inspectSolution(pz, tag, opts) {
  const B = brute(pz);
  const sol = pz.solution;
  record('最短が総当たりと一致（最短・最短の数・総数）', sol.best === B.best && sol.countBest === B.countBest && sol.countAll === B.countAll,
    tag + ` engine=${sol.best}/${sol.countBest}/${sol.countAll} brute=${B.best}/${B.countBest}/${B.countAll}`);
  const bo = indepDecode(pz, sol.bestOrder);
  record('solution.bestOrder は前提を満たし、最短になる', sol.bestOrder.length === pz.tasks.length && bo.ok && bo.ms === B.best, tag + ' ' + JSON.stringify(sol.bestOrder));
  const top = indepTop(pz);
  const tr = {};
  for (const m of ['lpt', 'idle', 'cp', 'est']) tr[m] = indepTrick(pz, m);
  const st = pz.stats;
  record('stats（上から順・コツの完成時刻＝同点の選び方の最小・最も長い流れ・合計）が検算と一致',
    st.topDown === top.ms && st.lpt === tr.lpt.min && st.idleFirst === tr.idle.min && st.cp === tr.cp.min && st.est === tr.est.min &&
    st.longest === longestChain(pz) && st.total === pz.tasks.reduce((x, t) => x + t.dur, 0),
    tag + ` top=${st.topDown}/${top.ms} lpt=${st.lpt}/${tr.lpt.min} idle=${st.idleFirst}/${tr.idle.min} cp=${st.cp}/${tr.cp.min} est=${st.est}/${tr.est.min} longest=${st.longest}/${longestChain(pz)}`);
  // 予想のスライダー（VERSION 4）: 下限は1以上。最短は下限・上限から2以上離れ、範囲の真ん中が最短 ± near に入らない（真ん中に置くだけで当たらない）
  const lb = lowerBoundOf(pz);
  const lo = st.guessLo, hi = st.guessHi;
  const nr = NEAR(B.best);
  const midFar = [Math.floor((lo + hi) / 2), Math.ceil((lo + hi) / 2)].every((m) => Math.abs(m - B.best) > nr);
  record('予想の範囲: 下限1以上・最短は両端から2以上離れる・範囲の真ん中が最短±1割に入らない',
    Number.isInteger(lo) && Number.isInteger(hi) && lo >= 1 && B.best - lo >= 2 && hi - B.best >= 2 && hi - lo >= 8 && midFar,
    tag + ` lo=${lo} hi=${hi} best=${B.best} near=${nr}`);
  record('最短に届かない時刻の下限（stats.lb）が検算と一致', st.lb === lb && lb <= B.best, tag + ` lb=${st.lb}/${lb}`);
  // ★の難しさの物差し
  const smart = indepSmart(pz, B.best);
  record('stats.smart（賢い置き方で最短に届く確率）が検算と一致', st.smart != null && Math.abs(st.smart - smart) < 0.0006, tag + ` smart=${st.smart}/${smart.toFixed(3)}`);
  // #0005: ★2 が「空いたらすぐ置く」だけで半分以上解けない・★3 は 1/3 以上で解けない（同じ週の★2 よりやさしくしない）
  if (opts && opts.shape && SMART_MAX[pz.target] != null) {
    const mx = pz.target === 3 && SMART_MAX_LOOSE[pz.menu] != null ? SMART_MAX_LOOSE[pz.menu] : SMART_MAX[pz.target];
    record('★の難しさ: smart（空いたらすぐ置くだけで最短に届く確率）が★2 は0.5未満・★3 は0.3未満（お弁当の★3 は0.5未満）', smart < mx, tag + ` ${pz.menu} ★${pz.target} smart=${smart.toFixed(3)} 上限${mx}`);
  }
  // 結果の★の差
  record('solution.near（★2 になる差）= 最短の1割（四捨五入・少なくとも1）', sol.near === NEAR(B.best), tag + ` near=${sol.near} best=${B.best}`);
  // できたて: 見せる最短の段取りで、できたての作業が完成の少し前に仕上がる（冷めた朝ごはんが正解にならない）
  if (pz.theme === 'kitchen' && !COLD_MENUS.has(pz.menu) && pz.menu !== 'tutorial' && pz.menu !== 'example') {
    const late = pz.tasks.every((t, i) => !HOT_RE.test(t.name) || bo.end[i] >= B.best - HOT_SLACK(B.best));
    record('台所: できたての作業は、見せる最短の段取りで完成の少し前に仕上がる', late, tag + ' ' + pz.menu + ' ' + pz.tasks.map((t, i) => (HOT_RE.test(t.name) ? t.name + ' ' + bo.end[i] : '')).filter(Boolean).join(',') + ' / 最短 ' + B.best);
  }
  // #0005: 2つある道具（コンロ1・2、職人A・B）で、前の作業の続きは、そのレーンがまだ前の作業のままなら同じレーンで続ける
  //（温めた油を別のコンロで揚げない）。見せる最短の段取りと上から順で、エンジンの schedule の結果を直接見る
  const dupTypes = [...new Set(pz.lanes.filter((l) => l.type !== 'wait').map((l) => l.type))].filter((ty) => pz.lanes.filter((l) => l.type === ty).length >= 2);
  if (dupTypes.length) {
    const bad = [];
    for (const o of [sol.bestOrder, indepTop(pz).order]) {
      const sc = E.schedule(pz, o);
      const at = {};
      sc.tasks.forEach((x, k) => { at[x.i] = k; });
      sc.tasks.forEach((y, ky) => {
        for (const ty of dupTypes) {
          if (!pz.tasks[y.i].needs.includes(ty)) continue;
          const ids = pz.lanes.filter((l) => l.type === ty).map((l) => l.id);
          // 前の作業が使ったこの種類のレーンのうち、その後 y を置くまでほかの作業に使われていないもの
          const keep = [];
          for (const x of pz.tasks[y.i].after) {
            const X = sc.tasks[at[x]];
            for (const lid of X.lanes) if (ids.includes(lid) && !sc.tasks.slice(at[x] + 1, ky).some((z) => z.lanes.includes(lid))) keep.push(lid);
          }
          const mine = y.lanes.find((lid) => ids.includes(lid));
          if (keep.length && !keep.includes(mine)) bad.push(`「${pz.tasks[y.i].name}」が ${mine}（前の作業は ${keep.join('/')}）`);
        }
      });
    }
    record('2つある道具: 前の作業の続きは、そのレーンが前の作業のままなら同じレーンで続ける', bad.length === 0, tag + ' ' + bad.slice(0, 2).join(' / '));
  }
  const ratio = B.countBest / B.countAll;
  const target = pz.target;
  const conds = {
    ratio: ratio <= RATIO[target],
    top: top.ms >= B.best + TOP_GAP,
    tips: TRICKS[target].every((m) => tr[m].min > B.best),
  };
  const good = conds.ratio && conds.top && conds.tips;
  record('stats.good が検算した条件と一致', st.good === good && Math.abs(st.ratio - ratio) < 0.0006, tag + ` good=${st.good}/${good} ratio=${st.ratio}/${ratio.toFixed(3)}`);
  // 実測の★: 形とコツの効き方で決まる。長い順・放置できる順で届けば★1、後に続く流れが長い順で届けば★2まで
  const n = pz.tasks.length, types = new Set(pz.tasks.flatMap((t) => t.needs)).size, dual = pz.tasks.filter((t) => t.needs.length >= 2).length;
  const dupType = Object.values(lanesByType(pz)).some((ls) => ls.length >= 2);
  const struct = n >= 7 && types >= 4 && (dupType || dual >= 1) ? 3 : n >= 6 && types >= 3 ? 2 : 1;
  const level = tr.lpt.min <= B.best || tr.idle.min <= B.best ? 1 : tr.cp.min <= B.best ? 2 : 3;
  if (opts && opts.shape) record('★の実測（形とコツの効き方。条件を満たせば目標どおり）', pz.star === Math.min(target, struct, level), tag + ` star=${pz.star} target=${target} struct=${struct} level=${level}`);
  return { B, ratio, conds, good, top, tr, smart, pos: (B.best - lo) / Math.max(1, hi - lo), atLo: B.best === lo };
}

/* ---------- schedule() と canPlace() ---------- */
function inspectSchedule(pz, tag) {
  const n = pz.tasks.length;
  const orders = [pz.solution.bestOrder, indepTop(pz).order];
  for (let k = 0; k < 6; k++) orders.push(randomOrder(pz));
  for (let k = 0; k < 3; k++) orders.push(randomOrder(pz, Math.floor(rnd() * n)));
  const errs = [];
  for (const o of orders) {
    let r;
    try { r = E.schedule(pz, o); } catch (e) { errs.push('例外 ' + e.message); continue; }
    const d = indepDecode(pz, o);
    if (!d.ok) { errs.push('検査側の順番が不正'); continue; }
    if (r.makespan !== d.ms) errs.push(`完成 ${r.makespan}≠${d.ms}`);
    if (r.tasks.length !== o.length || r.tasks.some((x, k) => x.i !== o[k])) { errs.push('tasks の並びが置いた順と違う'); continue; }
    for (const x of r.tasks) {
      if (x.start !== d.start[x.i] || x.end !== d.end[x.i]) errs.push(`時刻 ${x.i}: ${x.start}-${x.end} ≠ ${d.start[x.i]}-${d.end[x.i]}`);
      const t = pz.tasks[x.i];
      if (t.after.some((p) => d.end[p] > x.start)) errs.push('前提より先に始まっている ' + x.i);
      // レーン: 使う資源の種類ごとに1本ずつ（待つだけは「待つだけ」のレーン）
      const want = t.needs.length ? t.needs.slice().sort() : ['wait'];
      const got = x.lanes.map((id) => (pz.lanes.find((l) => l.id === id) || {}).type).sort();
      if (JSON.stringify(want) !== JSON.stringify(got) || new Set(x.lanes).size !== x.lanes.length) errs.push('レーンが資源と合わない ' + x.i + ' ' + JSON.stringify(x.lanes));
      const wantIds = t.needs.length ? d.lanesOf[x.i].map((li) => pz.lanes[li].id).sort() : null;
      if (wantIds && JSON.stringify(wantIds) !== JSON.stringify(x.lanes.slice().sort())) errs.push('決まりのレーン（早く空くほう・続きは同じレーン）を選んでいない ' + x.i + ' ' + JSON.stringify(x.lanes) + ' / ' + JSON.stringify(wantIds));
    }
    // 同じレーン（待つだけ以外）で重ならない。idle は使っていない時間（0〜完成）と一致
    for (const l of pz.lanes) {
      if (l.type === 'wait') continue;
      const busy = r.tasks.filter((x) => x.lanes.includes(l.id)).map((x) => [x.start, x.end]).sort((a, b) => a[0] - b[0]);
      for (let k = 1; k < busy.length; k++) if (busy[k][0] < busy[k - 1][1]) errs.push('レーンで重なる ' + l.id);
      const gaps = [];
      let t0 = 0;
      for (const [s, e] of busy) { if (s > t0) gaps.push([t0, s]); t0 = Math.max(t0, e); }
      if (d.ms > t0) gaps.push([t0, d.ms]);
      if (JSON.stringify(gaps) !== JSON.stringify(r.idle[l.id] || null)) errs.push('idle が違う ' + l.id + ' ' + JSON.stringify(r.idle[l.id]) + ' / ' + JSON.stringify(gaps));
    }
  }
  record('schedule: 時刻・レーン・重なり・空き時間が検算と一致', errs.length === 0, tag + ' ' + errs.slice(0, 3).join(' / '));
  // 壊れた順番（範囲外・重複・前提より先）は飛ばして、残りで計算する
  let junkOk = true;
  try {
    const o = pz.solution.bestOrder;
    const junk = [99, -1, 'x', o[0], o[0], 1.5, null].concat(o.slice(1));
    const r = E.schedule(pz, junk);
    junkOk = r.makespan === pz.solution.best && r.tasks.length === n;
    const r2 = E.schedule(pz, null);
    junkOk = junkOk && r2.tasks.length === 0 && r2.makespan === 0;
  } catch (e) { junkOk = false; }
  record('schedule: 壊れた順番でも例外を出さず、正しいものだけで計算する', junkOk, tag);
  // canPlace
  const cerr = [];
  for (let k = 0; k < 4; k++) {
    const pre = randomOrder(pz, Math.floor(rnd() * (n + 1)));
    const placed = new Set(pre);
    for (let i = 0; i < n; i++) {
      const r = E.canPlace(pz, pre, i);
      const wait = pz.tasks[i].after.filter((p) => !placed.has(p));
      const ok = !placed.has(i) && wait.length === 0;
      if (r.ok !== ok || (!placed.has(i) && JSON.stringify(r.waitingFor.slice().sort()) !== JSON.stringify(wait.slice().sort()))) cerr.push(`${i} ok=${r.ok}/${ok} wait=${JSON.stringify(r.waitingFor)}/${JSON.stringify(wait)}`);
    }
  }
  for (const bad of [-1, n, 'x', null, 1.5]) { const r = E.canPlace(pz, [], bad); if (r.ok !== false || !Array.isArray(r.waitingFor)) cerr.push('範囲外 ' + bad); }
  record('canPlace: 置けるか・待っている前提が正しい', cerr.length === 0, tag + ' ' + cerr.slice(0, 3).join(' / '));
}

/* ---------- explain() ----------
 * 文に出てくる作業名は本物か、diffAt は総当たりの最短の並べ方との一致で正しいか、勧めた直し方で本当に完成が早まるか、
 * 「〜から始められたのに」「ふさがっていた」は本当か、「完成を決める流れ」は本当にすき間なくつながっているか、を確かめる。 */
function commonPrefix(a, b) { let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++; return k; }
// 「完成を決める流れ」の文（独立に書く）。前提でつながる所は「→」、同じ資源が空くのを待ってつながる所は「→（〇〇が空いてから）」。
// 88文字を超えるとき・5つ以上のときは、頭と終わりだけの形
function chainWant(pz, ch, bo, best) {
  const u = pz.unit, names = pz.tasks.map((t) => t.name);
  if (ch.length === 1) return '完成を決めるのは' + qn(names[ch[0]]) + 'の' + best + u + '。';
  const longForm = '完成を決めるのは' + qn(names[ch[0]]) + 'から' + qn(names[ch[ch.length - 1]]) + 'まで、' + ch.length + 'つの作業がすき間なくつながる流れ（' + best + u + '）。';
  if (ch.length > 4) return longForm;
  let s = '完成を決めるのは' + qn(names[ch[0]]);
  for (let k = 1; k < ch.length; k++) {
    const a = ch[k - 1], b = ch[k];
    if (pz.tasks[b].after.includes(a)) s += '→';
    else {
      const shared = bo.lanesOf[a].filter((l) => bo.lanesOf[b].includes(l));
      s += shared.length ? '→（' + pz.lanes[Math.min(...shared)].name + 'が空いてから）' : '→';
    }
    s += qn(names[b]);
  }
  s += 'の流れ（' + best + u + '）。';
  return s.length > 88 ? longForm : s;
}
// 1枚だけ動かした順番を全部（独立に書く）。分かれ目 ext より前は変えない。
//  earlier = 後ろのカード c を ext の位置へ（c があなたの段取りより早く始まるものだけ）
//  later   = ext のカードを、後ろのカードの後へ
// 動かしたあと ext に来るカードは、最短に届く並べ方（総当たりの一覧）にあるものだけ
function singleMoves(pz, o, ext, B, pd) {
  const n = o.length;
  const prefix = o.slice(0, ext);
  const inPre = new Set(prefix);
  const reach = (head) => B.optimal.some((x) => commonPrefix(x, o) >= ext && x[ext] === head);
  const out = [];
  for (let j = ext + 1; j < n; j++) {
    const c = o[j];
    if (!pz.tasks[c].after.every((p) => inPre.has(p))) continue;
    const M = prefix.concat([c], o.slice(ext, j), o.slice(j + 1));
    const d = indepDecode(pz, M);
    if (!d.ok || pd.start[c] - d.start[c] <= 0 || !reach(c)) continue;
    out.push({ kind: 'earlier', task: c, order: M, ms: d.ms, d });
  }
  const pT = o[ext];
  for (let k = ext + 1; k < n; k++) {
    if (pz.tasks[o[k]].after.includes(pT)) break;
    const M = prefix.concat(o.slice(ext + 1, k + 1), [pT], o.slice(k + 1));
    const d = indepDecode(pz, M);
    if (!d.ok || !reach(M[ext])) continue;
    out.push({ kind: 'later', task: pT, after: o[k], order: M, ms: d.ms, d });
  }
  return out;
}
const sameArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
// 時刻は 0 も「0分から」（画面のカードの見込み・工程表の目盛りと同じ0始まりの表記。「最初から」とは書かない）
const atT = (t, u) => t + u;
function inspectExplain(pz, tag, B) {
  const n = pz.tasks.length;
  const u = pz.unit;
  const names = pz.tasks.map((t) => t.name);
  const top = indepTop(pz).order;
  const orders = [[], pz.solution.bestOrder, top];
  for (let k = 0; k < 4; k++) orders.push(randomOrder(pz));
  orders.push(randomOrder(pz, Math.max(1, Math.floor(n / 2))));
  // 最短の並べ方の隣どうしを入れ替えたもの（少しだけ外れた段取り）
  for (let k = 0; k < 2; k++) {
    const o = pz.solution.bestOrder.slice();
    const a = Math.floor(rnd() * (n - 1));
    const t = o[a]; o[a] = o[a + 1]; o[a + 1] = t;
    if (indepDecode(pz, o).ok) orders.push(o);
  }
  const errs = { shape: [], text: [], diff: [], move: [], improve: [], cause: [], link: [], chain: [], best: [] };
  for (const o of orders) {
    let r;
    try { r = E.explain(pz, o); } catch (e) { errs.shape.push('例外 ' + e.message + ' ' + JSON.stringify(o)); continue; }
    if (!r || !Array.isArray(r.tips) || r.tips.length < 1 || r.tips.length > 2) { errs.shape.push('tips の形 ' + JSON.stringify(r)); continue; }
    for (const t of r.tips) {
      if (typeof t !== 'string' || !t.trim() || BAD.test(t) || t.length > TIP_MAX || !t.endsWith('。')) errs.text.push('文の形: ' + t);
      for (const m of t.matchAll(/「([^」]+)」/g)) if (!names.includes(m[1])) errs.text.push('ない作業名: ' + m[1] + ' / ' + t);
      // 時刻は「0分から」（画面のカード・工程表と同じ0始まり）。「最初から始め…」とは書かない
      if (/最初から始め/.test(t)) errs.text.push('時刻を「最初から」と書いている（0' + u + 'から）: ' + t);
    }
    const all = r.tips.join('');
    const complete = o.length === n;
    const pd = indepDecode(pz, o);
    // diffAt: 最短の並べ方と最初に分かれた位置
    const L = Math.max(0, ...B.optimal.map((x) => commonPrefix(x, o)));
    const wantDiff = L < o.length ? L : null;
    if (r.diffAt !== wantDiff) errs.diff.push(`diffAt=${r.diffAt} 期待=${wantDiff} ${JSON.stringify(o)}`);
    if (complete && pd.ms === B.best && r.diffAt !== null) errs.diff.push('最短なのに diffAt がある');
    // bestOrder は最短で、あなたの順番の頭（分かれるまで）を引き継ぐ
    const bo = indepDecode(pz, r.bestOrder || []);
    const keepLen = wantDiff == null ? o.length : wantDiff;
    if (!bo.ok || (r.bestOrder || []).length !== n || bo.ms !== B.best || commonPrefix(r.bestOrder, o) < keepLen) errs.diff.push('explain.bestOrder が最短でない／頭が違う ' + JSON.stringify(r.bestOrder));
    if (!sameArr(r.order, o)) errs.shape.push('order が使った順番と違う ' + JSON.stringify(r.order));
    if (wantDiff != null) {
      const bT = r.bestTask, pT = o[wantDiff];
      const ok = B.optimal.some((x) => commonPrefix(x, o) >= wantDiff && x[wantDiff] === bT);
      if (!ok || r.diffTask !== pT) errs.diff.push(`bestTask=${bT} diffTask=${r.diffTask} の組が最短の並べ方と合わない`);
      const R = r.reason || {};
      const mv = r.move;
      // 勧めた直し方で、本当に完成が早まるか（同じ時刻に始めていた作業は勧めない）。
      // move が無いエンジン（#0002 まで）は「bestTask を分かれ目へ動かした順番」で確かめる
      if (complete && all.includes('を置けば')) {
        const M = mv ? mv.order : o.slice(0, wantDiff).concat([bT], o.slice(wantDiff).filter((x) => x !== bT));
        const md = indepDecode(pz, M);
        const later = mv && mv.kind === 'later';
        if (!md.ok || md.ms >= pd.ms) errs.improve.push(`勧めたとおりにしても完成が早まらない（${pd.ms}→${md.ok ? md.ms : '不正'}） 勧めた「${names[bT]}」 ${JSON.stringify(o)}`);
        else if (!later && !(pd.start[bT] > md.start[bT])) errs.improve.push(`勧めた「${names[bT]}」は、あなたの段取りでも同じ時刻（${pd.start[bT]}${u}）に始まっていた ${JSON.stringify(o)}`);
      }
      if (complete) {
        const moves = singleMoves(pz, o, wantDiff, B, pd).filter((m) => m.ms < pd.ms);
        const minMs = moves.length ? Math.min(...moves.map((m) => m.ms)) : null;
        if (mv) {
          const want = mv.kind === 'earlier' ? o.slice(0, wantDiff).concat([mv.task], o.slice(wantDiff).filter((x) => x !== mv.task))
            : (() => { const rest = o.filter((x) => x !== mv.task); const k = rest.indexOf(mv.after); return rest.slice(0, k + 1).concat([mv.task], rest.slice(k + 1)); })();
          const md = indepDecode(pz, mv.order);
          if (!sameArr(mv.order, want) || (mv.kind === 'later' && mv.task !== pT)) errs.move.push('move.order が「1枚だけ動かした順番」でない ' + JSON.stringify(mv));
          else if (!md.ok || md.ms !== mv.makespan) errs.move.push('move.makespan が検算と違う ' + mv.makespan + '/' + md.ms);
          else if (mv.makespan !== minMs) errs.move.push(`1枚動かす直し方で、いちばん早くなるものを選んでいない（${mv.makespan} / 最小 ${minMs}） ${JSON.stringify(o)}`);
          else if (mv.kind === 'earlier' && !(pd.start[mv.task] > md.start[mv.task])) errs.move.push('前へ動かすカードが、あなたの段取りより早く始まらない');
          if (bT !== mv.order[wantDiff]) errs.move.push('bestTask が直し方の分かれ目のカードと違う');
          if (mv.makespan === B.best && !sameArr(r.bestOrder, mv.order)) errs.move.push('直し方で最短に届くのに、bestOrder がその順番でない');
          const got = mv.makespan === B.best ? '、最短の' + B.best + u + 'に届く。' : '、' + mv.makespan + u + 'に縮まる。';
          if (mv.kind === 'earlier') {
            const adv = (wantDiff === 0 ? '最初に' : qn(names[pT]) + 'より先に') + qn(names[mv.task]) + 'を置けば' + got;
            if (r.tips[1] !== adv) errs.text.push('助言の文が違う: ' + r.tips.join(' ') + ' / 期待 ' + adv);
          } else if (!(r.tips[1] || '').startsWith(qn(names[pT]) + 'は後回し。') && !(r.tips[1] || '').startsWith(qn(names[pT]) + 'は' + qn(names[mv.after]) + 'の後に回せば')) errs.text.push('後回しの文が違う: ' + r.tips.join(' '));
          else if (!(r.tips[1] || '').endsWith(got)) errs.text.push('後回しの文の結果が違う: ' + r.tips[1] + ' / 期待 …' + got);
        } else if (minMs != null) errs.move.push(`1枚動かせば ${minMs}${u} に縮むのに、直し方（move）が無い ${JSON.stringify(o)}`);
        else {
          // 1枚動かすだけでは縮まらないとき: 最短の段取り（explain.bestOrder）で本当にそうなっていることだけを書く
          const t1 = r.tips[1] || '';
          const a1 = /^最短の段取りでは、「(.+)」より先に「(.+)」に入る。組み直してみよう。$/.exec(t1);
          const a2 = /^最短の段取りでは、「(.+)」を(\d+(?:分|日))から始める。組み直してみよう。$/.exec(t1);
          const a3 = /^最短の段取りでは、(\d+)枚目に「(.+)」を置いている。組み直してみよう。$/.exec(t1);
          const ix = (nmx) => names.indexOf(nmx);
          const ok1 = a1 && bo.start[ix(a1[2])] < bo.start[ix(a1[1])];
          const ok2 = a2 && atT(bo.start[ix(a2[1])], u) === a2[2];
          const ok3 = a3 && +a3[1] === wantDiff + 1 && a3[2] === names[bT];
          if (!(ok1 || ok2 || ok3)) errs.text.push('1枚では直らないときの文が本当でない: ' + r.tips.join(' '));
        }
      } else {
        const adv = (wantDiff === 0 ? '最初に' : qn(names[pT]) + 'より先に') + qn(names[bT]) + 'を置けば、最短の' + B.best + u + 'に届く。';
        if (!r.tips.includes(adv)) errs.text.push('途中の助言の文が違う: ' + r.tips.join(' ') + ' / 期待 ' + adv);
      }
      // 理由の文（1文目）の中身が本当か
      if (R.kind === 'delay') {
        const x = R.task;
        const ref = mv ? indepDecode(pz, mv.order) : bo;
        const lane = pz.lanes.find((l) => l.id === R.lane);
        let want = qn(names[x]) + 'は' + atT(ref.start[x], u) + 'から始められたのに、' + pd.start[x] + u + 'からになった。';
        if (R.blocker != null) {
          const li = pz.lanes.findIndex((l) => l.id === R.lane);
          const b = R.blocker;
          if (!(li >= 0 && o.indexOf(b) < o.indexOf(x) && pd.lanesOf[b].includes(li) && pd.lanesOf[x].includes(li) && pd.end[b] === pd.start[x])) errs.cause.push(`「${names[b]}」が${R.lane}をふさいでいない ${JSON.stringify(o)}`);
          want += (lane ? lane.name : '?') + 'が' + qn(names[b]) + 'でふさがっていたから。';
        }
        if (R.from !== ref.start[x] || R.to !== pd.start[x] || !(R.to > R.from)) errs.cause.push(`遅れの時刻が違う ${R.from}→${R.to} / ${ref.start[x]}→${pd.start[x]}`);
        if (r.tips[0] !== want) errs.cause.push('理由の文が違う: ' + r.tips[0] + ' / 期待 ' + want);
      } else if (R.kind === 'late') {
        // 途中の順番: まだ置いていない作業を、今から置くと遅れる
        const x = R.task;
        const to = indepDecode(pz, o.concat([x])).start[x];
        const want = qn(names[x]) + 'は' + atT(bo.start[x], u) + 'から始められるのに、今から置くと' + to + u + 'からになる。';
        if (o.includes(x) || R.from !== bo.start[x] || R.to !== to || !(to > R.from) || r.tips[0] !== want) errs.cause.push('「今から置くと」の文が本当でない: ' + r.tips[0] + ' / 期待 ' + want);
      } else if (R.kind === 'hold' && R.x != null && mv) {
        const md = indepDecode(pz, mv.order);
        const x = R.x;
        const li = pz.lanes.findIndex((l) => l.id === R.lane);
        const ln = li >= 0 ? pz.lanes[li].name : '?';
        let prevEnd = 0;
        for (let i = 0; i < n; i++) if (i !== x && md.lanesOf[i].includes(li) && md.end[i] <= md.start[x]) prevEnd = Math.max(prevEnd, md.end[i]);
        const w = md.start[x] - prevEnd;
        const t0 = qn(names[x]) + 'は' + atT(md.start[x], u) + 'から始められたのに、' + pd.start[x] + u + 'からになった。' + ln + 'が先に' + qn(names[pT]) + 'に入っていたから。';
        const got = mv.makespan === B.best ? '、最短の' + B.best + u + 'に届く。' : '、' + mv.makespan + u + 'に縮まる。';
        const t1 = qn(names[pT]) + 'は後回し。' + (w > 0 ? ln + 'は' + w + u + '待って' + qn(names[x]) + 'に入れば' : '先に' + qn(names[x]) + 'を進めれば') + got;
        if (!(md.lanesOf[x].includes(li) && pz.tasks[pT].needs.includes(pz.lanes[li].type) && md.start[x] < pd.start[x])) errs.cause.push('後回しの理由の作業・レーンが合わない ' + JSON.stringify(R));
        if (r.tips[0] !== t0 || r.tips[1] !== t1 || R.wait !== w) errs.cause.push('後回しの文が違う: ' + r.tips.join(' ') + ' / 期待 ' + t0 + t1);
      }
      // 2文がつながる: 1文目と2文目に同じ作業が出てくる（流れの文なら、勧める作業がその流れに入っている）。
      // 結果の画面（全部置いたとき）で確かめる。途中の順番は、案内の付箋が2文目だけを使う
      if (r.tips.length === 2 && complete) {
        const nm0 = [...r.tips[0].matchAll(/「([^」]+)」/g)].map((m) => m[1]);
        const nm1 = [...r.tips[1].matchAll(/「([^」]+)」/g)].map((m) => m[1]);
        const linked = nm0.some((x) => nm1.includes(x)) || (r.tips[0].startsWith('完成を決めるのは') && (r.chain || []).includes(bT));
        if (!linked) errs.link.push('1文目と2文目がつながらない: ' + r.tips.join(' '));
      }
    }
    // 完成を決める流れ: 最短の日程（explain.bestOrder）で、時刻0から完成まですき間なくつながる
    const ch = r.chain || [];
    if (bo.ok && ch.length) {
      let ok = bo.start[ch[0]] === 0 && bo.end[ch[ch.length - 1]] === B.best;
      for (let k = 1; k < ch.length; k++) {
        const a = ch[k - 1], b = ch[k];
        const linked = pz.tasks[b].after.includes(a) || bo.lanesOf[a].some((l) => bo.lanesOf[b].includes(l));
        if (bo.end[a] !== bo.start[b] || !linked) ok = false;
      }
      if (!ok) errs.chain.push('流れがつながっていない ' + JSON.stringify(ch));
      if (all.includes('完成を決めるのは')) {
        const want = chainWant(pz, ch, bo, B.best);
        if (!r.tips.includes(want)) errs.chain.push('流れの文が中身と合わない: ' + all + ' / 期待 ' + want);
        for (let k = 1; k < ch.length && ch.length <= 4; k++) {
          const a = ch[k - 1], b = ch[k];
          if (!pz.tasks[b].after.includes(a) && want.includes(qn(names[a]) + '→' + qn(names[b]))) errs.chain.push('前提でつながらない所を「→」だけで書いている: ' + want);
        }
      }
    } else if (!ch.length) errs.chain.push('chain が空');
    // 道具の作業の合計で決まる、の文: 1台だけの資源で、合計がちょうど最短・前提の流れより長い
    const mb = /^(.+)の作業は合計(\d+)(分|日)。最短は、(.+)を1(分|日)も休ませない段取り。$/.exec(r.tips.find((t) => t.includes('の作業は合計')) || '');
    if (mb) {
      const lane = pz.lanes.find((l) => l.name === mb[1] && l.type !== 'wait');
      const cnt = lane ? pz.lanes.filter((l) => l.type === lane.type).length : 0;
      const sum = lane ? pz.tasks.filter((t) => t.needs.includes(lane.type)).reduce((x, t) => x + t.dur, 0) : -1;
      if (!lane || cnt !== 1 || sum !== +mb[2] || sum !== B.best || !(B.best > longestChain(pz)) || mb[4] !== mb[1]) errs.chain.push('「作業は合計」の文が本当でない: ' + all);
    }
    // 最短に届いたときの2文目
    if (complete && pd.ms === B.best && B.countBest !== B.countAll) {
      const t1 = r.tips[1] || '';
      const m1 = /^上から順に置くと(\d+)(分|日)。「(.+)」より先に「(.+)」を置いたのが決め手。$/.exec(t1);
      const m2 = /^上から順に置くと(\d+)(分|日)。「(.+)」を「(.+)」の後に回したのが決め手。$/.exec(t1);
      const pos = (nmx) => o.indexOf(names.indexOf(nmx));
      if (m1 && !(+m1[1] === indepDecode(pz, top).ms && pos(m1[4]) < pos(m1[3]))) errs.best.push('落とし穴の文が本当でない: ' + t1);
      if (m2 && !(+m2[1] === indepDecode(pz, top).ms && pos(m2[3]) > pos(m2[4]))) errs.best.push('後回しの決め手の文が本当でない: ' + t1);
      // #0005: 決め手の一手（b を a より先に）は、(1) 上から順にその一手だけを加えると最短に届き、(2) 最短の並べ方はどれも b を a より先に置いている
      if (m1 || m2) {
        const a = names.indexOf(m1 ? m1[3] : m2[3]), b = names.indexOf(m1 ? m1[4] : m2[4]);
        let M;
        if (m1) { M = top.filter((x) => x !== b); M.splice(M.indexOf(a), 0, b); } else { M = top.filter((x) => x !== a); M.splice(M.indexOf(b) + 1, 0, a); }
        const md = indepDecode(pz, M);
        if (!(md.ok && md.ms === B.best)) errs.best.push('決め手の一手を上から順に加えても最短に届かない（' + (md.ok ? md.ms : '不正') + u + '）: ' + t1);
        if (!B.optimal.every((x) => x.indexOf(b) < x.indexOf(a))) errs.best.push('決め手の順番でなくても最短に届く並べ方がある: ' + t1);
      }
      const mm = /「([^」]+)」の(\d+)(分|日)の間に/.exec(t1);
      if (mm) {
        const x = names.indexOf(mm[1]);
        if (x < 0 || !ch.includes(x) || pz.tasks[x].dur !== +mm[2] || pz.tasks[x].needs.includes(PERSON[pz.theme])) errs.best.push('「〜の間に」の作業が流れの放置できる作業でない: ' + all);
      }
      if (!m1 && !m2 && !mm && !/を1(分|日)も休ませなかったのが決め手。$/.test(t1) && t1 !== 'この流れを一度も止めずに進めたのが決め手。') errs.best.push('最短に届いたときの2文目が決まりの形でない: ' + t1);
    }
    if (B.countBest === B.countAll && !all.startsWith('どの順番でも' + B.best + u + 'で終わる。')) errs.text.push('どの順番でも同じなのに、そう書いていない: ' + all);
  }
  // 壊れた入力
  for (const junk of [null, 'x', [99, -1], [1.5]]) {
    try { const r = E.explain(pz, junk); if (!r || !Array.isArray(r.tips) || !r.tips.length || r.tips.some((t) => BAD.test(t))) errs.shape.push('壊れた入力 ' + JSON.stringify(junk)); } catch (e) { errs.shape.push('壊れた入力で例外 ' + JSON.stringify(junk) + ' ' + e.message); }
  }
  // 無効な番号が混ざっても、schedule と同じく飛ばして続ける（結果の数字と解説が食い違わない。#0003）
  {
    const bo0 = pz.solution.bestOrder;
    const junk = [bo0[0], bo0[0], 99, -1, 'x'].concat(bo0.slice(1));
    try {
      const r = E.explain(pz, junk), sc = E.schedule(pz, junk);
      if (r.playerMakespan !== sc.makespan || r.kind !== (B.countBest === B.countAll ? 'same' : 'best')) errs.shape.push(`無効な番号が混ざると、explain（${r.playerMakespan}・${r.kind}）と schedule（${sc.makespan}）が食い違う`);
    } catch (e) { errs.shape.push('無効な番号で例外 ' + e.message); }
  }
  record('explain: 例外なく1〜2文を返す（壊れた入力でも。無効な番号は schedule と同じく飛ばす）', errs.shape.length === 0, tag + ' ' + errs.shape.slice(0, 2).join(' / '));
  record('explain: 文に機械的な文字列が無い・作業名が本物・「。」で終わる・長すぎない・助言の文が中身と合う', errs.text.length === 0, tag + ' ' + errs.text.slice(0, 2).join(' / '));
  record('explain: diffAt・先に置く作業が総当たりの最短の並べ方と合う', errs.diff.length === 0, tag + ' ' + errs.diff.slice(0, 2).join(' / '));
  record('explain: 勧めた直し方で完成が早まる（同じ時刻に始めていた作業は勧めない）', errs.improve.length === 0, tag + ' ' + errs.improve.slice(0, 2).join(' / '));
  record('explain: 直し方（move）は1枚だけ動かす形で、完成がいちばん早くなるもの', errs.move.length === 0, tag + ' ' + errs.move.slice(0, 2).join(' / '));
  record('explain: 理由の文（〜から始められたのに・ふさがっていた・後回し）が本当', errs.cause.length === 0, tag + ' ' + errs.cause.slice(0, 2).join(' / '));
  record('explain: 1文目と2文目が同じ作業の話でつながる', errs.link.length === 0, tag + ' ' + errs.link.slice(0, 2).join(' / '));
  record('explain: 「完成を決める流れ」「作業は合計」が本当（前提か道具のつながりだけ）', errs.chain.length === 0, tag + ' ' + errs.chain.slice(0, 2).join(' / '));
  record('explain: 最短に届いたときの2文目（落とし穴・待ち時間・休ませない）が本当（決め手の一手は、それだけで最短に届き、最短にはそれが要る）', errs.best.length === 0, tag + ' ' + errs.best.slice(0, 2).join(' / '));
}

/* ---------- 生成時間 ---------- */
// 遅かった生成は、負荷による誤判定を避けるため、新しいエンジンで3回測り直して一番短い値を使う
const SLOW = 100;
function remeasure(run) {
  let best = Infinity;
  for (let k = 0; k < 3; k++) {
    const F = fresh();
    F.generate({ seed: 'warm-up', star: 2, theme: 'kitchen' });
    const a = performance.now();
    run(F);
    best = Math.min(best, performance.now() - a);
  }
  return best;
}
const timed = (d, run) => (d > SLOW ? Math.min(d, remeasure(run)) : d);
const rawTimes = [];   // 測り直す前の値（表示用。負荷で遅く出た回も含む）

/* ---------- 本体 ---------- */
const t0 = Date.now();
const load0 = os.loadavg()[0];   // 始めたときのマシンの混み具合（性能の結果の読み方の参考。#0009）
let farMs = null;   // 遠い先の日付の初回の時間（目安を超えたかの表示用）
console.log('検査対象: ' + target);
console.log(`練習: ★1〜3 × 台所・現場 各${COUNT}問 / 日替わり ${DAYS}日分（2026-10-19 から）\n`);

const times = [];
const table = [];
const condTotal = { all: 0, ratio: 0, top: 0, tips: 0, good: 0 };
const menuSeen = {};
const agg = {};   // ★×テーマごとの集計（★の難しさ・予想の範囲・塗る→乾かす）
// 「塗る→乾かす」（塗る作業のすぐ後に、待つだけの作業が続く）がある問題か
const hasPaintDry = (pz) => pz.tasks.some((t, i) => /塗る$/.test(t.name) && pz.tasks.some((x) => x.needs.length === 0 && x.after.includes(i)));
// 練習
for (const theme of ['kitchen', 'site']) {
  for (const star of [1, 2, 3]) {
    const dist = { 1: 0, 2: 0, 3: 0 };
    const tt = [];
    const pass = { ratio: 0, top: 0, tips: 0, good: 0 };
    const ratios = [];
    const A = (agg[theme + star] = { smart: [], ratio: [], pos: [], atLo: 0, est: 0, paint: 0, n: 0 });
    for (let i = 0; i < COUNT; i++) {
      const seed = i % 3 === 0 ? 100000 * star + i : 'p' + theme[0] + star + '-' + i.toString(36);
      const tag = `[練習 ${theme} ★${star} seed=${seed}]`;
      let pz;
      const a = performance.now();
      try { pz = E.generate({ seed, star, theme }); } catch (e) { record('生成できる', false, tag + ' ' + e.message); continue; }
      const raw = performance.now() - a;
      const d = timed(raw, (F) => F.generate({ seed, star, theme }));
      tt.push(d); times.push(d); rawTimes.push(raw);
      record('生成できる', !!pz && pz.theme === theme && pz.target === star && pz.seed === seed, tag);
      (menuSeen[theme + star] = menuSeen[theme + star] || new Set()).add(pz.menu);
      dist[pz.star]++;
      inspectShape(pz, tag, { shape: true });
      const S = inspectSolution(pz, tag, { shape: true });
      ratios.push(S.ratio);
      A.n++; A.smart.push(S.smart); A.ratio.push(S.ratio); A.pos.push(S.pos); if (S.atLo) A.atLo++; if (S.tr.est.min <= S.B.best) A.est++; if (hasPaintDry(pz)) A.paint++;
      for (const k of ['ratio', 'top', 'tips']) if (S.conds[k]) { pass[k]++; condTotal[k]++; }
      if (S.good) { pass.good++; condTotal.good++; }
      condTotal.all++;
      if (i < 40) inspectSchedule(pz, tag);
      if (i < 40) inspectExplain(pz, tag, S.B);
      if (i < 15) {
        const again = E2.generate({ seed, star, theme });
        record('同じseedで同じ問題（別インスタンス）', JSON.stringify(again) === JSON.stringify(pz), tag);
        const sv = E.solve(pz);
        record('solve() が問題の solution と stats に一致', sv.best === pz.solution.best && sv.countBest === pz.solution.countBest && sv.countAll === pz.solution.countAll &&
          sv.lpt === S.tr.lpt.min && sv.idleFirst === S.tr.idle.min && sv.cp === S.tr.cp.min && sv.est === S.tr.est.min && sv.topDown === S.top.ms &&
          indepDecode(pz, sv.bestOrder).ms === pz.solution.best && ['lpt', 'idleFirst', 'cp', 'est'].every((k) => indepDecode(pz, sv.orders[k]).ms === sv[k]), tag);
      }
    }
    ratios.sort((x, y) => x - y);
    const avg = tt.reduce((x, y) => x + y, 0) / Math.max(1, tt.length);
    const goal = RATIO_GOAL[star] != null ? ratios.filter((x) => x <= RATIO_GOAL[star]).length : null;
    table.push({ theme, star, dist, avg, max: Math.max(...tt), pass, n: tt.length, med: ratios[ratios.length >> 1], rmax: ratios[ratios.length - 1], goal });
    record(`練習 ${theme} ★${star}: 良い問題の条件を全部満たす（100%）`, pass.good === tt.length, `${pass.good}/${tt.length}`);
    record(`練習 ${theme} ★${star}: 実測の★が目標どおり（100%）`, dist[star] === tt.length, JSON.stringify(dist));
    if (goal != null) record(`練習 ${theme} ★${star}: 最短の並べ方の割合が目安（${RATIO_GOAL[star]}）以下の問題が ${RATIO_GOAL_SHARE[theme] * 100}% 以上`, goal >= RATIO_GOAL_SHARE[theme] * tt.length, `${goal}/${tt.length}`);
  }
}
/* ★の難しさ・予想の範囲・題材の偏り（#0003） */
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
for (const theme of ['kitchen', 'site']) {
  const sm = [1, 2, 3].map((st) => mean(agg[theme + st].smart));
  const ra = [1, 2, 3].map((st) => mean(agg[theme + st].ratio));
  record(`★の難しさ（${theme}）: 賢い置き方で最短に届く確率の平均が ★1 > ★2 > ★3（差 ${SMART_GAP} 以上）`, sm[0] - sm[1] >= SMART_GAP && sm[1] - sm[2] >= SMART_GAP, sm.map((x) => x.toFixed(3)).join(' > '));
  // 適当に並べて届く割合（ratio）は ★1 がいちばん大きい（★2・★3 はどちらも 0.2 以下。★3 は同じ道具が2つあると入れ替えても同じ日程が増えるので、★2 との大小は見ない）
  record(`★の難しさ（${theme}）: 最短の並べ方の割合の平均は ★1 が ★2・★3 より大きい`, ra[0] > ra[1] && ra[0] > ra[2], ra.map((x) => x.toFixed(3)).join(' / '));
  const e2 = agg[theme + 2].est / Math.max(1, agg[theme + 2].n), e3 = agg[theme + 3].est / Math.max(1, agg[theme + 3].n);
  record(`★の難しさ（${theme}）: 「早く始められる順」（同点は全部ためす）で届く問題は ★3 のほうが ★2 より少ない`, e3 < e2, `★2 ${(e2 * 100).toFixed(0)}% / ★3 ${(e3 * 100).toFixed(0)}%`);
  for (const st of [1, 2, 3]) {
    const A = agg[theme + st];
    const left = A.pos.filter((x) => x < 0.5).length / Math.max(1, A.n), right = 1 - left;
    // 現場★1・★2 は最短が小さく、下限1で右寄りにできないことが多いので見ない（左寄りでも、真ん中・端は答えにならない）
    const need = theme === 'site' && st < 3 ? 0 : GUESS_SIDE;
    record('予想の範囲: 最短が範囲の左寄り・右寄りのどちらにもある（範囲から答えの位置が読めない）', A.atLo === 0 && left >= need && right >= need, `${theme} ★${st} 左寄り ${(left * 100).toFixed(0)}% 右寄り ${(right * 100).toFixed(0)}%`);
  }
  if (theme === 'site') {
    const p = (agg.site2.paint + agg.site3.paint) / Math.max(1, agg.site2.n + agg.site3.n);
    record(`現場: ★2・★3 で「塗る→乾かす」が出る問題は ${PAINT_SHARE * 100}% まで（どの題材も似て見えない）`, p <= PAINT_SHARE, `${(p * 100).toFixed(0)}%`);
  }
}

// 日替わり
const dTimes = [];
const dSmart = [];   // 日ごとの [★, smart]（週の中で★3 が★2 よりやさしくないか）
const dayStr = (i) => new Date(DAY1 + i * 86400000).toISOString().slice(0, 10);
const lastMenu = {};
const dDist = { kitchen: {}, site: {} };
let dGood = 0;
for (let i = 0; i < DAYS; i++) {
  const ds = dayStr(i);
  const wd = new Date(DAY1 + i * 86400000).getUTCDay();
  const [wStar, wTheme] = WEEK[wd];
  const tag = `[日替わり ${ds}]`;
  let cfg, pz;
  try { cfg = E.dailyConfig(ds); } catch (e) { record('日替わり: 設定', false, tag + ' ' + e.message); continue; }
  record('日替わり: 設定（No.・曜日・★・テーマ・seed）', cfg.no === i + 1 && cfg.weekday === wd && cfg.star === wStar && cfg.theme === wTheme &&
    cfg.seed === 'dandori-' + ds.replace(/-/g, '') && cfg.date === ds, tag + ' ' + JSON.stringify(cfg));
  const a = performance.now();
  try { pz = E.daily(ds); } catch (e) { record('日替わり: 生成できる', false, tag + ' ' + e.message); continue; }
  const raw = performance.now() - a;
  const d = timed(raw, (F) => { F.dailyConfig(ds); F.daily(ds); });
  dTimes.push(d); times.push(d); rawTimes.push(raw);
  record('日替わり: 生成できる（No.・日付・曜日・seed・テーマ・★・題名が設定と同じ）', pz.no === cfg.no && pz.date === ds && pz.weekday === wd && pz.seed === cfg.seed &&
    pz.theme === wTheme && pz.target === wStar && pz.star === wStar && pz.title === cfg.title && pz.menu === cfg.menu, tag + ` star=${pz.star} title=${pz.title}/${cfg.title}`);
  inspectShape(pz, tag, { shape: true });
  const S = inspectSolution(pz, tag, { shape: true });
  dSmart.push([pz.target, S.smart]);
  const tplD = (E.TEMPLATES || []).find((x) => x.id === pz.menu);
  record('日替わり: 練習だけの献立（お弁当）は出さない', !!tplD && tplD.daily !== false, tag + ' ' + pz.menu);
  if (S.good) dGood++;
  record('日替わり: 良い問題の条件を満たす', S.good, tag + ' ' + JSON.stringify(S.conds) + ' ratio=' + S.ratio.toFixed(3));
  if (i < 60) { inspectSchedule(pz, tag); inspectExplain(pz, tag, S.B); }
  // 同じ献立・題材が7日以内に重ならない（テーマごと）
  const lm = lastMenu[pz.menu];
  record('日替わり: 同じ献立・題材が7日以内に重ならない', lm == null || i - lm >= 7, tag + ' ' + pz.menu + ' 前回 ' + lm);
  lastMenu[pz.menu] = i;
  dDist[pz.theme][pz.menu] = (dDist[pz.theme][pz.menu] || 0) + 1;
  if (i < 20) {
    const again = E2.daily(ds);
    record('日替わり: 同じ日付で同じ問題（別インスタンス）', JSON.stringify(again) === JSON.stringify(pz), tag);
  }
}
// #0005: 同じ週（月〜日）で、どの★2 よりも smart が大きい（やさしい）★3 がある週は WEEK_INVERT_MAX 週まで
{
  let inv = 0, weeks = 0;
  for (let w = 0; (w + 1) * 7 <= dSmart.length; w++) {
    const wk = dSmart.slice(w * 7, w * 7 + 7);
    const m2 = Math.max(...wk.filter((x) => x[0] === 2).map((x) => x[1])), m3 = Math.max(...wk.filter((x) => x[0] === 3).map((x) => x[1]));
    weeks++;
    if (m3 > m2) inv++;
  }
  record(`★の難しさ（日替わり）: 同じ週のどの★2 よりもやさしい★3 がある週は ${WEEK_INVERT_MAX} 週まで`, DAYS < 364 || inv <= WEEK_INVERT_MAX, `${inv}/${weeks}週`);
}
// No.1 より前・遠い先の日付
{
  let ok = true, detail = '';
  try {
    const c0 = E.dailyConfig('2026-10-18'), c1 = E.dailyConfig('2026-01-01');
    ok = c0.no === 0 && c1.no < 0 && c0.seed === 'dandori-20261018' && !!E.daily('2026-10-18').tasks.length;
    detail = JSON.stringify([c0.no, c1.no]);
  } catch (e) { ok = false; detail = e.message; }
  record('日替わり: No.1 より前の日付も計算できる（No. は 0 以下。丸めは画面で）', ok, detail);
  const F = fresh();
  const a = performance.now();
  let far = null;
  try { far = F.dailyConfig('2036-10-19'); } catch (e) { far = null; }
  const ms = performance.now() - a;
  record('日替わり: 10年先の dailyConfig も軽い（初回 50ms 以下）', !!far && far.no === 3654 && ms <= 50, far ? `No.${far.no} ${ms.toFixed(1)}ms` : 'エラー');
  // 時計が大きくずれた端末（9999年）でも固まらない（#0003: No.1 から順に割り当てていて、Node で8秒かかっていた）
  const F2 = fresh();
  const a2 = performance.now();
  let far2 = null;
  try { far2 = F2.dailyConfig('9999-12-31'); F2.daily('9999-12-31'); } catch (e) { far2 = null; }
  const ms2 = performance.now() - a2;
  // 合否は PERF.max（300ms。#0003 の前は8秒かかっていた）。100ms（目安）を超えたら表示だけ（#0009）
  farMs = ms2;
  record(`日替わり: 遠い先（9999-12-31）の dailyConfig・daily も軽い（初回 ${PERF.max}ms 以下。目安 ${PERF.aim}ms）`, !!far2 && far2.no > 0 && ms2 <= PERF.max, far2 ? `No.${far2.no} ${ms2.toFixed(1)}ms` : 'エラー');
  record('Engine.DAY1 は 2026-10-19', E.DAY1 === '2026-10-19', String(E.DAY1));
}

/* ---------- はじめての段取り・例題 ---------- */
{
  const ex = E.example();
  const B = brute(ex);
  inspectShape(ex, '[例題]');
  record('例題: 手1・コンロ1・炊飯器1、7作業', ex.lanes.map((l) => l.type).join(',') === 'hand,stove,rice' && ex.tasks.length === 7, JSON.stringify(ex.lanes.map((l) => l.type)));
  record('例題: 前提を満たす90通り・最短21分は28通り・上から順は27分', B.countAll === 90 && B.countBest === 28 && B.best === 21 && indepTop(ex).ms === 27 &&
    ex.solution.best === 21 && ex.solution.countBest === 28 && ex.solution.countAll === 90, `${B.countAll} ${B.countBest} ${B.best} top=${indepTop(ex).ms}`);
  inspectSchedule(ex, '[例題]');
  inspectExplain(ex, '[例題]', B);
  // #0003: 3話それぞれが別のコツを1つずつ教える（第1話 並べ方と工程表、第2話 放置できる作業を先に、第3話 コンロの取り合い）
  const want = [
    { best: 8, same: true, top: 8, lanes: 'hand' },
    { best: 20, same: false, top: 26, lanes: 'hand,rice' },
    { best: 16, same: false, top: 21, lanes: 'hand,stove' },
  ];
  for (let k = 1; k <= 3; k++) {
    const t = E.tutorial(k);
    const tag = '[はじめての段取り ' + k + ']';
    const Bt = brute(t);
    inspectShape(t, tag);
    const w = want[k - 1];
    record('はじめての段取り: 手作りの問題（最短・上から順・資源）', Bt.best === w.best && (Bt.countBest === Bt.countAll) === w.same && indepTop(t).ms === w.top &&
      t.lanes.map((l) => l.type).join(',') === w.lanes && t.solution.best === w.best && t.solution.countAll === Bt.countAll,
      tag + ` best=${Bt.best} same=${Bt.countBest === Bt.countAll} top=${indepTop(t).ms}`);
    const L = t.lesson || {};
    record('はじめての段取り: 案内の文（題・始めの一言・置く前の問い・流れに乗っているとき・外れたとき・解けたとき）', L.no === k && ['title', 'intro', 'tip', 'on', 'hint', 'done'].every((x) => typeof L[x] === 'string' && L[x].length > 0 && !BAD.test(L[x])), tag + ' ' + Object.keys(L).join(','));
    // 置く前・置いている途中の案内は、答え（置く作業の名前）を言わずに考え方を教える。始めの一言はあらすじと別の文
    const names = t.tasks.map((x) => x.name);
    const leak = ['intro', 'tip', 'on', 'hint'].filter((x) => typeof L[x] === 'string' && [...L[x].matchAll(/「([^」]+)」/g)].some((m) => names.includes(m[1])));
    record('はじめての段取り: 解く前の案内で答え（作業名）を言わない・始めの一言はあらすじと違う', leak.length === 0 && L.intro !== t.story, tag + ' ' + leak.join(','));
    const person = PERSON[t.theme];
    const top = indepTop(t).order;
    let lesson = true, why = '';
    if (k === 1) { lesson = Bt.countBest === Bt.countAll; why = 'どの順でも同じでない'; }
    if (k === 2) {
      // 最短の並べ方はどれも、放っておける作業（自分を使わない作業）の前の下ごしらえから始める。上から順はそうしない
      const prep = (o) => t.tasks.some((x) => !x.needs.includes(person) && x.needs.length && x.after.includes(o[0]));
      lesson = Bt.optimal.every(prep) && !prep(top);
      why = '最短の並べ方が、機械の前の下ごしらえから始まっていない（または上から順でも届く）';
    }
    if (k === 3) {
      // コンロは1口。前提の無いコンロの作業が2つあり、最短の並べ方はどれも「後に手の作業が続くほう」を先にコンロへ。上から順は逆
      const st = t.tasks.map((x, i) => i).filter((i) => t.tasks[i].needs.includes('stove'));
      const free = st.filter((i) => t.tasks[i].after.length === 0);
      // 後に手の作業が続く（その作業だけを待つ手の作業がある。全部の後の盛り付けは数えない）
      const withHand = st.filter((i) => t.tasks.some((x) => x.after.length === 1 && x.after[0] === i && x.needs.includes(person)));
      const first = (o) => o.find((i) => st.includes(i));
      lesson = t.lanes.filter((l) => l.type === 'stove').length === 1 && free.length >= 2 && withHand.length === 1 &&
        Bt.optimal.every((o) => first(o) === withHand[0]) && first(top) !== withHand[0];
      why = 'コンロの取り合い（前提の無いコンロの作業2つ・後に手の作業が続くほうを先に）になっていない';
    }
    record('はじめての段取り: 1話に1つずつ別のコツ（並べ方／放置できる作業を先に／コンロの取り合い）', lesson, tag + ' ' + why);
    inspectSchedule(t, tag);
    inspectExplain(t, tag, Bt);
    record('はじめての段取り: 同じものを返す（別インスタンス）', JSON.stringify(E2.tutorial(k)) === JSON.stringify(t), tag);
  }
  let ok = true;
  try { ok = E.tutorial(0).lesson.no === 1 && E.tutorial(9).lesson.no === 3 && E.tutorial('2').lesson.no === 2 && E.tutorial().lesson.no === 1; } catch (e) { ok = false; }
  record('はじめての段取り: 範囲外の番号は1〜3に丸める', ok, '');
}

/* ---------- API の細かい約束 ---------- */
{
  const F1 = fresh(), F2 = fresh();
  const a = F1.generate({ seed: '7', star: 2, theme: 'kitchen' }), b = F1.generate({ seed: 7, star: 2, theme: 'kitchen' });
  const c = F2.generate({ seed: 7, star: 2, theme: 'kitchen' });
  record('API: seed の型をそのまま返す', a.seed === '7' && b.seed === 7 && JSON.stringify(b) === JSON.stringify(c), JSON.stringify([a.seed, b.seed, c.seed]));
  // 有限でない数の seed も、保存（JSON）して読み戻した seed で同じ問題を作り直せる（#0003: NaN が null になって別の問題になった）
  const nf = [];
  for (const sd of [NaN, Infinity, -Infinity]) {
    try {
      const p = E.generate({ seed: sd, star: 1, theme: 'kitchen' });
      const back = JSON.parse(JSON.stringify(p)).seed;
      const p2 = fresh().generate({ seed: back, star: 1, theme: 'kitchen' });
      if (JSON.stringify(p2) !== JSON.stringify(p)) nf.push(String(sd) + ' → ' + JSON.stringify(back));
    } catch (e) { nf.push(String(sd) + ' 例外 ' + e.message); }
  }
  record('API: NaN・Infinity の seed でも、保存した seed で同じ問題を作り直せる', nf.length === 0, nf.join(' / '));
  // 結果の★（#0003: 最短 + 2 で★2 は、現場では甘すぎた）
  let gOk = typeof E.grade === 'function' && typeof E.near === 'function', gDet = '';
  if (gOk) {
    for (const [b, w] of [[9, 1], [13, 1], [15, 2], [24, 2], [25, 3], [5, 1]]) if (E.near(b) !== w) { gOk = false; gDet += `near(${b})=${E.near(b)} `; }
    for (const p of [E.daily('2026-10-19'), E.generate({ seed: 'g', star: 3, theme: 'site' }), E.generate({ seed: 'g', star: 2, theme: 'kitchen' })]) {
      const b = p.solution.best, nr = NEAR(b);
      if (E.grade(p, b) !== 3 || E.grade(p, b + nr) !== 2 || E.grade(p, b + nr + 1) !== 1) { gOk = false; gDet += `grade ${p.menu} best=${b} `; }
    }
  } else gDet = 'Engine.grade / Engine.near が無い';
  record('API: 結果の★（最短 ★3・最短 + 最短の1割 以内 ★2・それより遅い ★1）', gOk, gDet);
  record('API: Engine.WEEK が曜日の決まりと同じ', JSON.stringify(E.WEEK) === JSON.stringify(WEEK), JSON.stringify(E.WEEK));
  const norm = [];
  for (const [o, ws, wt] of [[{ seed: 'n', star: '2' }, 2, 'kitchen'], [{ seed: 'n', star: 9, theme: 'site' }, 3, 'site'], [{ seed: 'n', star: 0, theme: 'x' }, 1, 'kitchen'], [{ seed: 'n' }, 1, 'kitchen'], [{}, 1, 'kitchen'], [undefined, 1, 'kitchen']]) {
    try { const p = E.generate(o); if (p.target !== ws || p.theme !== wt) norm.push(JSON.stringify(o) + ' → ' + p.target + p.theme); } catch (e) { norm.push(JSON.stringify(o) + ' 例外 ' + e.message); }
  }
  record('API: ★は1〜3、テーマは kitchen / site に丸める', norm.length === 0, norm.join(' / '));
  for (const d of ['2026-02-30', '2026-13-01', '2027-02-29', '2026-00-10', '2026-1-1', '', null]) {
    let threw = false;
    try { E.dailyConfig(d); } catch (e) { threw = true; }
    record('API: 存在しない日付は受け付けない', threw, String(d));
  }
  let leap = null;
  try { leap = E.dailyConfig('2028-02-29'); } catch (e) { leap = null; }
  record('API: うるう日は受け付ける', !!leap && leap.weekdayLabel === '火' && leap.weekday === 2, JSON.stringify(leap));
  // 返した問題を書き換えても、次の生成に影響しない
  const F3 = fresh();
  const p1 = F3.generate({ seed: 'mut', star: 3, theme: 'site' });
  const keep = JSON.stringify(p1);
  p1.tasks[0].dur = 999; p1.solution.best = -1; p1.lanes.length = 0;
  const p2 = F3.generate({ seed: 'mut', star: 3, theme: 'site' });
  const d1 = F3.daily('2026-10-24'); d1.title = 'x';
  record('API: 返した問題を書き換えても、次の生成は同じ', JSON.stringify(p2) === keep && F3.daily('2026-10-24').title !== 'x', '');
  // 表や決まりを外から変えられない
  const F4 = fresh(), F5 = fresh();
  try { F4.RULES.ratio[2] = 1; F4.RULES.tries = 1; } catch (e) { /* 凍結されていれば例外でもよい */ }
  try { F4._internal.TEMPLATES[0].steps[0].lo = 99; } catch (e) { /* 同上 */ }
  const p4 = F4.generate({ seed: 'api', star: 2, theme: 'kitchen' }), p5 = F5.generate({ seed: 'api', star: 2, theme: 'kitchen' });
  const hooks = Object.keys(F4).filter((k) => k.startsWith('_') && k !== '_internal');
  record('API: 生成の決まりを外から変えられない', hooks.length === 0 && JSON.stringify(p4) === JSON.stringify(p5) && Object.isFrozen(F4) && Object.isFrozen(F4.RULES), JSON.stringify(hooks));
  // 部品表: 台所は献立20以上、現場は工事の題材10以上。どれも何かの★で使う
  const T = E.TEMPLATES || [];
  const kn = T.filter((x) => x.theme === 'kitchen').length, sn = T.filter((x) => x.theme === 'site').length;
  record('部品表: 台所の献立20以上・現場の題材10以上', kn >= 20 && sn >= 10, `台所 ${kn} / 現場 ${sn}`);
  const unused = T.filter((x) => !(x.stars && x.stars.length));
  record('部品表: どの献立・題材も、どれかの★で使う', unused.length === 0, unused.map((x) => x.id).join(','));
  // 練習で、★に割り当てた献立・題材がすべて出る（偏らない）
  for (const theme of ['kitchen', 'site']) for (const star of [1, 2, 3]) {
    const want = T.filter((x) => x.theme === theme && x.stars.includes(star)).map((x) => x.id);
    const seen = menuSeen[theme + star] || new Set();
    const miss = want.filter((id) => !seen.has(id));
    record('練習: ★に割り当てた献立・題材が全部出る', COUNT < 60 || miss.length === 0, `${theme} ★${star} 出ない: ${miss.join(',')}`);
  }
  // 日替わりの献立・題材が偏らない（1年で全部出る）
  for (const theme of ['kitchen', 'site']) {
    const used = new Set(Object.values(WEEK).filter((w) => w[1] === theme).map((w) => w[0]));
    const want = T.filter((x) => x.theme === theme && x.daily !== false && x.stars.some((s) => used.has(s))).map((x) => x.id);
    const miss = want.filter((id) => !dDist[theme][id]);
    record('日替わり: 1年で、その曜日に使う献立・題材が全部出る（練習だけの献立を除く）', DAYS < 365 || miss.length === 0, theme + ' 出ない: ' + miss.join(','));
  }
}

/* ---------- 部品表の全数検査（★に割り当てた献立・題材で、条件を満たす問題が作れる） ----------
 * 献立・題材ごとに seed を変えて作り、条件を満たす割合を見る（generate の menu 指定を使う）。 */
const perTpl = [];
{
  const T = E.TEMPLATES || [];
  const N = Math.max(6, Math.round(COUNT / 10));
  for (const x of T) for (const star of x.stars) {
    let good = 0;
    for (let i = 0; i < N; i++) {
      let p;
      try { p = E.generate({ seed: 'tpl-' + x.id + '-' + i, star, theme: x.theme, menu: x.id }); } catch (e) { record('部品表: 生成できる', false, `${x.id} ★${star} ${i} ${e.message}`); continue; }
      record('部品表: 生成できる', p.menu === x.id, `${x.id} ★${star} ${i} → ${p.menu}`);
      if (p.menu !== x.id) continue;
      const S = inspectSolution(p, `[部品表 ${x.id} ★${star} ${i}]`, { shape: true });
      if (S.good) good++;
    }
    perTpl.push([x.id, star, good, N]);
    record('部品表: 献立・題材ごとに条件を満たす問題が作れる（100%）', good === N, `${x.id} ★${star} ${good}/${N}`);
  }
}

/* ---------- 部品表に頼らない、ランダムな問題（solve・schedule・explain の作りを直接ためす） ----------
 * 資源の種類・同じ種類2つ・待つだけ・2資源同時・前提をでたらめに組んだ問題で、総当たりと比べる。
 * 部品表からはめったに出ない形（待つだけの作業の後に続く作業、同じ種類の2レーンの取り合いなど）も入る。 */
const FUZZ = Math.max(60, COUNT * 3);
{
  let bad = 0;
  for (let k = 0; k < FUZZ; k++) {
    const theme = rnd() < 0.5 ? 'kitchen' : 'site';
    const pool = RES_TYPES[theme].slice();
    const nTypes = 1 + Math.floor(rnd() * 4);
    const types = [];
    while (types.length < nTypes) { const t = pool[Math.floor(rnd() * pool.length)]; if (!types.includes(t)) types.push(t); }
    const lanes = [];
    for (const t of types) {
      const two = rnd() < 0.3;
      for (let c = 0; c < (two ? 2 : 1); c++) lanes.push({ id: t + (two ? c + 1 : ''), type: t, name: t + (two ? c + 1 : ''), icon: t });
    }
    const n = 3 + Math.floor(rnd() * 6);
    const raw = [];
    for (let i = 0; i < n; i++) {
      const r = rnd();
      const m = r < 0.3 ? 0 : r < 0.8 ? 1 : 2;
      const needs = [];
      while (needs.length < Math.min(m, types.length)) { const t = types[Math.floor(rnd() * types.length)]; if (!needs.includes(t)) needs.push(t); }
      const after = [];
      for (let j = 0; j < i; j++) if (rnd() < 0.28) after.push(j);
      raw.push({ dur: 1 + Math.floor(rnd() * 9), needs, after });
    }
    // 表示の順は混ぜる（前提が上にあるとは限らない）
    const perm = [...Array(n).keys()].sort(() => rnd() - 0.5);
    const pos = Array(n); perm.forEach((c, p) => { pos[c] = p; });
    const tasks = perm.map((c, p) => ({ name: 'T' + p, dur: raw[c].dur, needs: raw[c].needs, after: raw[c].after.map((x) => pos[x]).sort((a, b) => a - b), icon: raw[c].needs[0] || 'wait' }));
    if (tasks.some((t) => !t.needs.length)) lanes.push({ id: 'wait', type: 'wait', name: '待つだけ', icon: 'wait' });
    const pz = { seed: 'fuzz-' + k, star: 1, target: 1, theme, unit: UNIT[theme], title: 'fuzz', story: 'fuzz', parts: [], lanes, tasks, solution: null, stats: null };
    const tag = `[ランダム ${k} n=${n} lanes=${lanes.map((l) => l.id).join(',')}]`;
    let sv;
    try { sv = E.solve(pz); } catch (e) { record('ランダムな問題: solve が総当たりと一致', false, tag + ' 例外 ' + e.message); bad++; continue; }
    const B = brute(pz);
    const ok = sv.best === B.best && sv.countBest === B.countBest && sv.countAll === B.countAll && indepDecode(pz, sv.bestOrder).ms === B.best &&
      sv.topDown === indepTop(pz).ms && sv.lpt === indepTrick(pz, 'lpt').min && sv.idleFirst === indepTrick(pz, 'idle').min && sv.cp === indepTrick(pz, 'cp').min && sv.est === indepTrick(pz, 'est').min &&
      Math.abs(sv.smart - indepSmart(pz, B.best)) < 1e-9;
    if (!ok) bad++;
    record('ランダムな問題: solve が総当たりと一致（最短・数・コツの完成時刻・賢い置き方の確率）', ok, tag + ` engine=${sv.best}/${sv.countBest}/${sv.countAll} brute=${B.best}/${B.countBest}/${B.countAll}`);
    pz.solution = { best: sv.best, bestOrder: sv.bestOrder, countBest: sv.countBest, countAll: sv.countAll };
    if (k % 2 === 0) { inspectSchedule(pz, tag); inspectExplain(pz, tag, B); }
  }
}

/* ---------- 同じ名前の作業はいつも同じ資源 ---------- */
for (const theme of ['kitchen', 'site']) {
  const bad = [];
  for (const [name, m] of nameNeeds[theme]) if (m.size > 1) bad.push(name + ': ' + [...m.entries()].map(([k, tag]) => k + ' ' + tag).join(' / '));
  record('部品表: 同じ名前の作業は、どの問題でも同じ資源を使う（' + theme + '）', bad.length === 0, bad.slice(0, 4).join(' | '));
}

/* ---------- Web Worker の中でも動くか ---------- */
{
  let W = null, err = '';
  try { W = loadAsWorker(code); } catch (e) { err = e.message; }
  record('Worker: window・document なしで読める（self.Engine）', !err && !!W && typeof W.generate === 'function', err || 'self.Engine が無い');
  if (W) {
    let ok = false, detail = '';
    try {
      const a = W.generate({ seed: 'worker', star: 3, theme: 'site' });
      const b = E.generate({ seed: 'worker', star: 3, theme: 'site' });
      const d = W.daily('2026-10-19');
      const s = W.schedule(a, a.solution.bestOrder);
      const x = W.explain(a, s.tasks.map((t) => t.i));
      ok = JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(d) === JSON.stringify(E.daily('2026-10-19')) && s.makespan === a.solution.best && x.tips.length > 0;
    } catch (e) { detail = e.message; }
    record('Worker: 同じ問題を作れる・schedule/explain も動く', ok, detail);
  }
}
if (target.endsWith('.html')) {
  const A = '// ==ENGINE ' + 'START==', B = '// ==ENGINE ' + 'END==';
  const nA = SRC.split(A).length - 1, nB = SRC.split(B).length - 1;
  record('目印（ENGINE START / END）は index.html に1回ずつ', nA === 1 && nB === 1, `START ${nA}回 / END ${nB}回`);
}

/* ---------- 回帰: 問題が前と同じか ---------- */
function goldenHashes(Eng) {
  const h1 = crypto.createHash('sha256');
  for (let i = 0; i < 365; i++) h1.update(JSON.stringify(Eng.daily(dayStr(i))) + '\n');
  const h2 = crypto.createHash('sha256');
  for (const star of [1, 2, 3]) for (const theme of ['kitchen', 'site']) for (let i = 0; i < 20; i++) h2.update(JSON.stringify(Eng.generate({ seed: 'r' + i, star, theme })) + '\n');
  const h3 = crypto.createHash('sha256');
  for (let k = 1; k <= 3; k++) h3.update(JSON.stringify(Eng.tutorial(k)) + '\n');
  h3.update(JSON.stringify(Eng.example()) + '\n');
  return { daily365: h1.digest('hex').slice(0, 32), practice120: h2.digest('hex').slice(0, 32), fixed4: h3.digest('hex').slice(0, 32) };
}
let regressMsg = '';
const REG = [['daily365', '回帰: 日替わり365日が基準と同じ'], ['practice120', '回帰: 練習120問が基準と同じ'], ['fixed4', '回帰: はじめての段取り3問と例題が基準と同じ']];
{
  let now;
  try { now = goldenHashes(fresh()); } catch (e) { now = { daily365: 'error', practice120: 'error', fixed4: 'error' }; record('回帰: ハッシュを計算できる', false, e.message); }
  const g = GOLDEN[E.VERSION];
  if (!g) {
    regressMsg = `VERSION ${E.VERSION} の基準ハッシュがありません。docs に変更を書いてから、tools/check-engine.mjs の GOLDEN に ${E.VERSION}: { daily365: '${now.daily365}', practice120: '${now.practice120}', fixed4: '${now.fixed4}' } を足してください。`;
    for (const [, name] of REG) record(name, false, regressMsg);
  } else {
    const msg = (k) => `ハッシュ ${g[k]} → ${now[k]}。問題が変わりました。意図した変更なら、エンジンの VERSION を上げて docs に書き、GOLDEN に新しい VERSION の値を足してください。`;
    for (const [k, name] of REG) if (!record(name, now[k] === g[k], msg(k))) regressMsg = regressMsg || msg(k);
  }
}

/* ---------- 生成時間の最悪値・冷えた状態（表示だけ） ---------- */
const perfInfo = { seeds: [], cold: null };
{
  for (const [theme, star] of [['kitchen', 3], ['site', 2], ['site', 3]]) {
    const F = fresh();
    F.generate({ seed: 'warm-up', star, theme });
    const tt = [];
    let worst = null, rawMx = 0;
    for (let i = 0; i < PERF_SEEDS; i++) {
      const seed = 'p' + (1790000000000 + i * 7919).toString(36) + ((i * 104729) % 1e6).toString(36);
      const a = performance.now();
      try { F.generate({ seed, star, theme }); } catch (e) { record('生成できる', false, `[性能 ${theme} ★${star} ${seed}] ${e.message}`); continue; }
      const raw = performance.now() - a;
      const d = timed(raw, (G) => G.generate({ seed, star, theme }));
      tt.push(d); rawMx = Math.max(rawMx, raw);
      if (!worst || d > worst[1]) worst = [seed, d];
    }
    tt.sort((x, y) => x - y);
    if (tt.length) perfInfo.seeds.push({ theme, star, n: tt.length, avg: tt.reduce((x, y) => x + y, 0) / tt.length, p99: tt[Math.floor(tt.length * 0.99)], max: tt[tt.length - 1], worst: worst[0], rawMx });
  }
  const cold = [];
  for (let i = 0; i < 365; i += 13) {
    const ds = dayStr(i);
    const F = fresh();
    const a = performance.now();
    F.daily(ds);
    cold.push([ds, performance.now() - a]);
  }
  cold.sort((x, y) => y[1] - x[1]);
  perfInfo.cold = { n: cold.length, avg: cold.reduce((x, y) => x + y[1], 0) / cold.length, max: cold[0] };
}

/* ---------- 表示 ---------- */
const f1 = (x) => x.toFixed(1);
const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + '%' : '-');
console.log('★×テーマごとの結果（実測★の分布 / 条件の通過率 / 最短の並べ方の割合 中央・最大 / 生成時間）');
for (const r of table) {
  console.log(`  ${r.theme.padEnd(7)} ★${r.star}: 実測 ★1=${r.dist[1]} ★2=${r.dist[2]} ★3=${r.dist[3]}  割合≤${RATIO[r.star]} ${pct(r.pass.ratio, r.n)}  上から順+${TOP_GAP} ${pct(r.pass.top, r.n)}  コツで届かない ${pct(r.pass.tips, r.n)}  全部 ${pct(r.pass.good, r.n)}  割合 中央${r.med.toFixed(3)} 最大${r.rmax.toFixed(3)}${r.goal != null ? `（目安≤${RATIO_GOAL[r.star]} ${pct(r.goal, r.n)}）` : ''}  平均 ${f1(r.avg)}ms 最大 ${f1(r.max)}ms`);
}
console.log('\n★の難しさ（smart = 賢い置き方で最短に届く確率の平均 / 早く始められる順で届く割合）・予想の範囲（最短の位置の中央値）・塗る→乾かす');
for (const theme of ['kitchen', 'site']) {
  console.log(`  ${theme.padEnd(7)} ` + [1, 2, 3].map((st) => { const A = agg[theme + st]; return `★${st}: smart ${mean(A.smart).toFixed(3)} 早く始められる順 ${pct(A.est, A.n)} 位置 ${median(A.pos).toFixed(2)}`; }).join(' | ') +
    (theme === 'site' ? `  塗る→乾かす（★2・★3） ${pct(agg.site2.paint + agg.site3.paint, agg.site2.n + agg.site3.n)}` : ''));
}
const avgAll = times.reduce((x, y) => x + y, 0) / Math.max(1, times.length);
const maxAll = Math.max(...times);
console.log(`\n日替わり ${DAYS}日: 条件を満たす ${dGood}/${DAYS}  平均 ${f1(dTimes.reduce((x, y) => x + y, 0) / Math.max(1, dTimes.length))}ms 最大 ${f1(Math.max(...dTimes))}ms`);
for (const theme of ['kitchen', 'site']) console.log(`  ${theme}: ` + Object.entries(dDist[theme]).sort((x, y) => y[1] - x[1]).map(([k, v]) => k + ' ' + v).join(', '));
console.log(`\n生成時間（練習＋日替わり ${times.length}問）: 平均 ${f1(avgAll)}ms / 最大 ${f1(maxAll)}ms（${SLOW}ms を超えたものは新しいエンジンで測り直した短いほう。測り直す前の最大 ${f1(Math.max(0, ...rawTimes))}ms）`);
console.log('生成時間の参考（アプリと同じ形の seed・温まった状態）');
for (const r of perfInfo.seeds) console.log(`  ${r.theme} ★${r.star} ${r.n}問: 平均 ${f1(r.avg)}ms p99 ${f1(r.p99)}ms 最大 ${f1(r.max)}ms（${r.worst}。測り直す前の最大 ${f1(r.rawMx)}ms）`);
if (perfInfo.cold) console.log(`  日替わり（冷えた状態＝開いた直後）${perfInfo.cold.n}日: 平均 ${f1(perfInfo.cold.avg)}ms 最大 ${f1(perfInfo.cold.max[1])}ms（${perfInfo.cold.max[0]}）`);
console.log('献立・題材ごとの条件の通過: ' + perTpl.filter((x) => x[2] < x[3]).map((x) => `${x[0]}★${x[1]} ${x[2]}/${x[3]}`).join(', ') + (perTpl.every((x) => x[2] === x[3]) ? `全部 100%（${perTpl.length}組）` : ''));

const overAim = times.filter((x) => x > PERF.aim).length;
console.log(`マシンの混み具合: load average 始め ${load0.toFixed(1)} → 終わり ${os.loadavg()[0].toFixed(1)}（CPU ${os.cpus().length}）。かかった時間 ${((Date.now() - t0) / 1000).toFixed(0)}秒（空いていれば約30秒）。` +
  '混んでいると生成の時間が数倍になる。性能が FAIL したら、回帰が PASS していることを見たうえで、空いているときに測り直す');
console.log(`目安（${PERF.aim}ms）: ${overAim ? `超えた生成 ${overAim}/${times.length}問（最大 ${f1(maxAll)}ms）。マシンが混んでいないときに測り直して、続くようならエンジンを見直す` : `すべて目安以内（最大 ${f1(maxAll)}ms）`}` +
  (farMs != null && farMs > PERF.aim ? ` / 遠い先の日付の初回 ${f1(farMs)}ms も目安を超えた` : ''));
record(`性能: 平均${PERF.avg}ms以下`, avgAll <= PERF.avg, `平均 ${f1(avgAll)}ms`);
record(`性能: 最大${PERF.max}ms以下（仕様の目標。目安 ${PERF.aim}ms は表示だけ）`, maxAll <= PERF.max, `最大 ${f1(maxAll)}ms`);

console.log('\n検査項目:');
let anyFail = false;
for (const r of results) {
  const ok = r.fail === 0;
  if (!ok) anyFail = true;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.pass}/${r.pass + r.fail})`);
  if (!ok) for (const d of failures[r.name]) console.log('        ' + d);
}
if (regressMsg) console.log('\n*** ' + (GOLDEN[E.VERSION] ? '問題が基準と違います。VERSION を上げて docs に書いてください。' : 'VERSION ' + E.VERSION + ' の基準ハッシュを GOLDEN に足してください。') + ' ***\n    ' + regressMsg);
console.log(`\n${anyFail ? 'FAIL' : 'PASS'}  ${results.length}項目  (${((Date.now() - t0) / 1000).toFixed(1)}秒)`);
process.exit(anyFail ? 1 : 0);
