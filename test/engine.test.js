import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FLOOR, BLOCK, ITEM, COOL, HOT, BOTH,
} from '../src/game/constants.js';
import {
  createState, getReady, walk, look, search, putWall, checkResult,
} from '../src/game/engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const loadMap = (f) => JSON.parse(fs.readFileSync(path.join(here, '..', 'load_data', f), 'utf8'));

/**
 * 手で組んだ盤面から状態を作る。
 * rows は文字列の配列。 . = 床, # = ブロック, o = アイテム, C = cool, H = hot
 */
function board(rows, turn = 100) {
  const sym = { '.': FLOOR, '#': BLOCK, o: ITEM, C: COOL, H: HOT };
  const map = rows.map((r) => [...r].map((ch) => sym[ch]));
  const find = (v) => {
    for (let y = 0; y < map.length; y++) {
      for (let x = 0; x < map[y].length; x++) if (map[y][x] === v) return { x, y };
    }
    return { x: -1, y: -1 };
  };
  const cool = find(COOL);
  const hot = find(HOT);

  return {
    sizeX: map[0].length,
    sizeY: map.length,
    map,
    turn,
    cool: { ...cool, score: 0 },
    hot: { ...hot, score: 0 },
  };
}

/* --- 実サーバーとの突き合わせ --- */

test('getReady が Node 版の実サーバーと同じ9マスを返す', () => {
  // Node 版で実際に room_010 に入って受け取った値。
  // blockly-chaser-shizuoka の test/game_integration.test.js で固定してある
  const state = createState(loadMap('game_server_010.json'));
  assert.deepStrictEqual(getReady(state, 'cool'), [0, 0, 0, 0, 0, 3, 0, 3, 0]);
});

/* --- 走査 --- */

test('周囲9マスは 0=床 1=相手 2=ブロック 3=アイテム で返る', () => {
  const s = board([
    '#o.',
    '.CH',
    '..o',
  ]);
  assert.deepStrictEqual(getReady(s, 'cool'), [2, 3, 0, 0, 0, 1, 0, 0, 3]);
});

test('盤外はブロックとして返る', () => {
  const s = board(['C.', '..']);
  // 左と上が盤外
  assert.deepStrictEqual(getReady(s, 'cool'), [2, 2, 2, 2, 0, 0, 2, 0, 0]);
});

test('自分の駒は床として返る', () => {
  const s = board(['...', '.C.', '...']);
  assert.strictEqual(getReady(s, 'cool')[4], 0);
});

test('look は指定方向の3x3を、遠い行から順に返す', () => {
  const s = board([
    'ooo',   // 3マス先
    '###',   // 2マス先
    '...',   // 1マス先
    '.C.',
  ]);
  assert.deepStrictEqual(look(s, 'cool', 'top'), [
    3, 3, 3,   // 3マス先はアイテム
    2, 2, 2,   // 2マス先はブロック
    0, 0, 0,   // 1マス先は床
  ]);
});

test('look は左右方向では列が遠い順に並ぶ', () => {
  const s = board([
    '...o',
    'C.#o',
    '...o',
  ]);
  assert.deepStrictEqual(look(s, 'cool', 'right'), [
    0, 0, 3,   // y-1 の行を 1,2,3 マス先の順に
    0, 2, 3,
    0, 0, 3,
  ]);
});

test('search は指定方向の直線9マスを返す', () => {
  const s = board(['C' + '.'.repeat(9)]);
  const result = search(s, 'cool', 'right');
  assert.strictEqual(result.length, 9);
  assert.deepStrictEqual(result, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('search は盤外をブロックで埋める', () => {
  const s = board(['C..']);
  assert.deepStrictEqual(search(s, 'cool', 'right'), [0, 0, 2, 2, 2, 2, 2, 2, 2]);
});

/* --- 移動 --- */

test('床へ移動できる', () => {
  const s = board(['...', '.C.', '...']);
  walk(s, 'cool', 'top');
  assert.deepStrictEqual({ x: s.cool.x, y: s.cool.y }, { x: 1, y: 0 });
  assert.strictEqual(s.map[0][1], COOL);
  assert.strictEqual(s.map[1][1], FLOOR, '元いたマスが空いていません');
});

test('アイテムを取るとスコアが増え、来たマスがブロックになる', () => {
  const s = board(['.o.', '.C.', '...']);
  walk(s, 'cool', 'top');
  assert.strictEqual(s.cool.score, 1);
  assert.strictEqual(s.map[0][1], COOL);
  assert.strictEqual(s.map[1][1], BLOCK, 'アイテムを取った後、来たマスがブロックになっていません');
});

test('ブロックへ突っ込むと座標だけ動き、盤面には駒が残らない', () => {
  const s = board(['.#.', '.C.', '...']);
  walk(s, 'cool', 'top');
  assert.deepStrictEqual({ x: s.cool.x, y: s.cool.y }, { x: 1, y: 0 });
  assert.strictEqual(s.map[0][1], BLOCK, 'ブロックが消えています');
  assert.ok(!s.map.flat().includes(COOL), 'cool の駒が盤上に残っています');
});

test('盤外へ出ようとすると駒が消える', () => {
  const s = board(['C..']);
  walk(s, 'cool', 'top');
  assert.ok(!s.map.flat().includes(COOL));
  assert.deepStrictEqual({ x: s.cool.x, y: s.cool.y }, { x: 0, y: 0 }, '座標は動かないはず');
});

test('相手のマスへ移動すると重なり状態になる', () => {
  const s = board(['.H.', '.C.', '...']);
  walk(s, 'cool', 'top');
  assert.strictEqual(s.map[0][1], BOTH);
});

test('重なり状態から離れると相手だけが残る', () => {
  const s = board(['...', '.C.', '...']);
  s.map[1][1] = BOTH;
  s.hot = { x: 1, y: 1, score: 0 };
  walk(s, 'cool', 'top');
  assert.strictEqual(s.map[1][1], HOT, '相手が消えています');
  assert.strictEqual(s.map[0][1], COOL);
});

/* --- ブロック設置 --- */

test('隣にブロックを置ける', () => {
  const s = board(['...', '.C.', '...']);
  const { hitOpponent } = putWall(s, 'cool', 'top');
  assert.strictEqual(s.map[0][1], BLOCK);
  assert.strictEqual(hitOpponent, false);
});

test('相手のいるマスに置くと攻撃になる', () => {
  const s = board(['.H.', '.C.', '...']);
  const { hitOpponent } = putWall(s, 'cool', 'top');
  assert.strictEqual(hitOpponent, true);
  assert.strictEqual(s.map[0][1], BLOCK, '相手がブロックに置き換わっていません');
});

test('盤外には置けない', () => {
  const s = board(['C..']);
  const { hitOpponent } = putWall(s, 'cool', 'top');
  assert.strictEqual(hitOpponent, false);
  assert.strictEqual(s.map[0][0], COOL, '自分の駒が壊れています');
});

/* --- 勝敗判定 --- */

test('決着していなければ null を返す', () => {
  const s = board(['...', 'C.H', '...']);
  assert.strictEqual(checkResult(s, 'cool'), null);
});

test('ターンが尽きるとスコアで決まる', () => {
  const s = board(['...', 'C.H', '...'], 1);
  s.cool.score = 5;
  s.hot.score = 3;
  assert.deepStrictEqual(checkResult(s, 'hot'), { winner: 'cool', info: 'スコアより' });
});

test('スコアが同じなら引き分け', () => {
  const s = board(['...', 'C.H', '...'], 1);
  assert.deepStrictEqual(checkResult(s, 'hot'), { winner: 'draw', info: 'スコアより' });
});

test('ターンは hot が動いたときだけ減る', () => {
  const s = board(['...', 'C.H', '...'], 10);
  checkResult(s, 'cool');
  assert.strictEqual(s.turn, 10);
  checkResult(s, 'hot');
  assert.strictEqual(s.turn, 9);
});

test('ブロックへ突っ込むと負ける', () => {
  const s = board(['.#.', '.C.', '..H']);
  walk(s, 'cool', 'top');
  assert.deepStrictEqual(checkResult(s, 'cool'), { winner: 'hot', info: 'ブロック衝突により' });
});

test('put で相手を叩くとアタック勝ちになる', () => {
  const s = board(['.H.', '.C.', '...']);
  const { hitOpponent } = putWall(s, 'cool', 'top');
  assert.deepStrictEqual(checkResult(s, 'cool', hitOpponent), { winner: 'cool', info: 'アタックにより' });
});

test('四方をブロックで囲まれると負ける', () => {
  const s = board([
    '.#..',
    '#C#.',
    '.#.H',
    '....',
  ]);
  assert.deepStrictEqual(checkResult(s, 'cool'), { winner: 'hot', info: 'ブロック閉じ込めにより' });
});

test('両方が囲まれると引き分け', () => {
  const s = board([
    '.#..#.',
    '#C#.H.',
    '.#..#.',
  ]);
  // hot の左右も塞ぐ
  s.map[1][3] = BLOCK;
  s.map[1][5] = BLOCK;
  assert.deepStrictEqual(checkResult(s, 'cool'), { winner: 'draw', info: 'ブロック閉じ込めにより' });
});

test('盤の角は2辺が盤外なので囲まれやすい', () => {
  const s = board([
    'C#.',
    '#..',
    '..H',
  ]);
  // 左と上が盤外(ブロック扱い)、右と下がブロック
  assert.deepStrictEqual(checkResult(s, 'cool'), { winner: 'hot', info: 'ブロック閉じ込めにより' });
});

/* --- 状態の生成 --- */

test('createState は元のマップ定義を書き換えない', () => {
  const def = loadMap('game_server_014.json');
  const before = JSON.stringify(def.map_data);
  const s = createState(def);
  walk(s, 'cool', 'top');
  assert.strictEqual(JSON.stringify(def.map_data), before, 'マップ定義が壊れています');
});

test('createState はスコアを 0 から始める', () => {
  const s = createState(loadMap('game_server_010.json'));
  assert.strictEqual(s.cool.score, 0);
  assert.strictEqual(s.hot.score, 0);
  assert.strictEqual(s.turn, 100);
});
