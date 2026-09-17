/**
 * 静岡大会マップの設計図と評価。
 *
 *   node tool/shizuoka_maps.mjs eval [試合数]   盤面を描き、ボット同士で戦わせて決着の内訳を出す
 *   node tool/shizuoka_maps.mjs write          src/data/maps.json の room_010〜014 / 110〜114 を書き換える
 *
 * 設計図は上半分(y0〜7)と中央行(y8)の左半分+中央だけを書く。残りは点対称に作るので必ず公平になる。
 *   .  床   #  ブロック   o  アイテム   C  cool の開始位置(hot は点対称の位置に置く)
 *
 * 初心者向けの方針:
 *   - 開始位置のまわり8手以内に袋小路を作らない(アイテムを取ると来た道がブロックになり、自滅しやすいため)
 *   - アイテムを線状に並べて中央へ誘導し、両者が出会うようにする
 *   - 難しさはブロックの数でなく形で出す。密度はブロック25〜45・アイテム20〜35
 *   - 目安: L5 同士で「ブロック閉じ込め」決着 20% 未満、引き分け 10% 未満。L12 同士でも引き分け 10% 未満
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createState, getReady, walk, look, search, putWall, checkResult } from '../src/game/engine.js';
import { createBot, decideBotAction, afterBotAction } from '../src/game/bot.js';

const MAPS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/data/maps.json');

export const DESIGNS = {
  room_010: { name: '静岡練習マップ(みかん畑)', turn: 100, rows: [
    '...............',
    '..o.......o....',
    '.o.o.....o.o...',
    '..o..#....o....',
    '....C....#.....',
    '.#.....o.......',
    '.....o.o.#..o..',
    '..#...o.....o..',
    '...o...o',
  ]},
  room_011: { name: '静岡予選マップ(茶畑)', turn: 100, rows: [
    '...............',
    '..o..o...o..o..',
    '##..###.###..##',
    '...............',
    '...o.o.o.o.o...',
    '.###..###..###.',
    '..C............',
    '..o.o.o.o.o.o..',
    '#..##.o.',
  ]},
  room_012: { name: '静岡初戦マップ(駿河湾)', turn: 150, rows: [
    '...............',
    '.o.....o.....o.',
    '..#..o..#..o...',
    '...#.....#.....',
    '....#.o...#..o.',
    '.C..#.....#....',
    '...#.o...#..o..',
    '..#..o..#..o...',
    '.o....o.',
  ]},
  room_013: { name: '静岡準決マップ(浜名湖)', turn: 150, rows: [
    '..o.........o..',
    '...............',
    '.o....#.....o..',
    '...............',
    '....###.###....',
    '...#.o.o.o.#...',
    '...#.......#...',
    '...#..ooo..#...',
    '.C.....o',
  ]},
  room_014: { name: '静岡決勝マップ(逆さ富士)', turn: 150, rows: [
    '...............',
    '......ooo......',
    '......###......',
    '.....#.o.#.....',
    '....#.....#....',
    '...#.o...o.#...',
    '..#.C.......#..',
    '.#.....o.....#.',
    '.o.o.o.o',
  ]},
};

const W = 15;
const H = 17;
const FLIP = { '.': '.', '#': '#', o: 'o', C: 'H', H: 'C' };
const VALUE = { '.': 0, '#': 1, o: 2, C: 3, H: 4 };

/** 設計図から盤面を作る。下半分は点対称に写す */
export function build(design) {
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  for (let y = 0; y < 8; y++) {
    if (design.rows[y].length !== W) throw new Error(`${design.name}: y${y} は ${W} 文字`);
    for (let x = 0; x < W; x++) g[y][x] = design.rows[y][x];
  }
  if (design.rows[8].length !== 8) throw new Error(`${design.name}: y8 は 8 文字`);
  for (let x = 0; x < 8; x++) g[8][x] = design.rows[8][x];
  for (let y = 0; y < 8; y++) for (let x = 0; x < W; x++) g[16 - y][14 - x] = FLIP[g[y][x]];
  for (let x = 0; x < 7; x++) g[8][14 - x] = FLIP[g[8][x]];

  let cool = null;
  let hot = null;
  const map = g.map((row, y) => row.map((ch, x) => {
    if (ch === 'C') cool = { x, y };
    if (ch === 'H') hot = { x, y };
    return VALUE[ch];
  }));
  if (!cool || !hot) throw new Error(`${design.name}: C がありません`);
  return {
    name: design.name,
    map_size_x: W,
    map_size_y: H,
    map_data: map,
    cool: { status: false, turn: false, ...cool },
    hot: { status: false, turn: false, ...hot },
    turn: design.turn,
  };
}

const render = (m) => {
  const ch = { 0: '・', 1: '■', 2: '◇', 3: 'C', 4: 'H' };
  return m.map_data.map((r, y) => String(y).padStart(2) + ' ' + r.map((c) => ch[c]).join('')).join('\n');
};

/** 盤面の形の指標。到達できないマスや袋小路が無いかを見る */
function shape(def) {
  const md = def.map_data;
  const bfs = (sx, sy) => {
    const d = Array.from({ length: H }, () => Array(W).fill(-1));
    d[sy][sx] = 0;
    const q = [[sx, sy]];
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || md[ny][nx] === 1 || d[ny][nx] >= 0) continue;
        d[ny][nx] = d[y][x] + 1;
        q.push([nx, ny]);
      }
    }
    return d;
  };
  let blocks = 0;
  let items = 0;
  let floor = 0;
  for (const r of md) for (const c of r) { if (c === 1) blocks++; else { floor++; if (c === 2) items++; } }
  const d = bfs(def.cool.x, def.cool.y);
  let reach = 0;
  let dead = 0;
  let deadNear = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (md[y][x] === 1) continue;
      if (d[y][x] >= 0) reach++;
      let closed = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || md[ny][nx] === 1) closed++;
      }
      if (closed >= 3) { dead++; if (d[y][x] >= 0 && d[y][x] <= 8) deadNear++; }
    }
  }
  return `ブロック${blocks} アイテム${items} 到達可能${reach}/${floor} 両者間${d[def.hot.y][def.hot.x]}手 袋小路${dead}(開始8手圏${deadNear})`;
}

/* --- ボット同士の対戦 --- */

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ACT = {
  move: (s, c, d) => ({ attacked: false, cells: walk(s, c, d) }),
  move_player: (s, c, d) => ({ attacked: false, cells: walk(s, c, d) }),
  look: (s, c, d) => ({ attacked: false, cells: look(s, c, d) }),
  search: (s, c, d) => ({ attacked: false, cells: search(s, c, d) }),
  put_wall: (s, c, d) => { const r = putWall(s, c, d); return { attacked: r.hitOpponent, cells: r.cells }; },
};

function play(def, level, seed) {
  const rng = seeded(seed);
  const state = createState(def);
  const bots = { cool: createBot(level, W, H), hot: createBot(level, W, H) };
  let t = 0;
  for (;;) {
    for (const side of ['cool', 'hot']) {
      getReady(state, side);
      const [kind, dir] = decideBotAction(state, side, bots[side], rng);
      const { attacked } = ACT[kind](state, side, dir);
      afterBotAction(bots[side], state, side, kind, dir);
      const result = checkResult(state, side, attacked);
      t++;
      if (result) return { ...result, turns: Math.ceil(t / 2), score: state.cool.score + state.hot.score };
      if (t > 4000) throw new Error('試合が終わりません');
    }
  }
}

function evaluate(games) {
  for (const [id, design] of Object.entries(DESIGNS)) {
    const def = build(design);
    console.log(`\n## ${id} ${def.name} turn=${def.turn}\n${render(def)}\n${shape(def)}`);
    for (const level of [3, 5, 8, 12]) {
      const st = { draw: 0, turns: 0, score: 0, early: 0, by: {} };
      for (let i = 0; i < games; i++) {
        const r = play(def, level, 10000 + i);
        if (r.winner === 'draw') st.draw++;
        st.turns += r.turns;
        st.score += r.score;
        if (r.turns <= 10) st.early++;
        st.by[r.info] = (st.by[r.info] || 0) + 1;
      }
      const pct = (x) => (Math.round((100 * x) / games) + '%').padStart(4);
      const by = Object.entries(st.by).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => k.replace('により', '').replace('より', '') + pct(v)).join(' ');
      const trap = (st.by['ブロック閉じ込めにより'] || 0) / games;
      const ng = (level === 5 && (trap > 0.2 || st.draw / games > 0.1)) || (level === 12 && st.draw / games > 0.1);
      console.log(`  L${String(level).padStart(2)} 引分${pct(st.draw)} 10手以内${pct(st.early)} 平均${String(Math.round(st.turns / games)).padStart(3)}手 合計スコア${(st.score / games).toFixed(1).padStart(5)} | ${by}${ng ? '  ←NG' : ''}`);
    }
  }
}

function write() {
  const maps = JSON.parse(fs.readFileSync(MAPS_FILE, 'utf8'));
  for (const [cpuId, design] of Object.entries(DESIGNS)) {
    const b = build(design);
    for (const id of [cpuId, cpuId.replace('room_0', 'room_1')]) {
      const old = maps[id] || {};
      const next = {
        name: b.name, room_id: id, map_size_x: b.map_size_x, map_size_y: b.map_size_y,
        map_data: b.map_data, cool: b.cool, hot: b.hot,
      };
      if (old.cpu) next.cpu = old.cpu;
      next.turn = b.turn;
      maps[id] = next;
      console.log(`${id} ${b.name} turn=${b.turn}`);
    }
  }
  fs.writeFileSync(MAPS_FILE, JSON.stringify(maps) + '\n');
}

const cmd = process.argv[2];
if (cmd === 'eval') evaluate(Number(process.argv[3] || 200));
else if (cmd === 'write') write();
else console.log('使い方: node tool/shizuoka_maps.mjs eval [試合数] | write');
