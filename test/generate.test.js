import test from 'node:test';
import assert from 'node:assert';

import maps from '../src/data/maps.json' with { type: 'json' };
import { createMap, spawnPlayers, prepareMap } from '../src/game/generate.js';
import { FLOOR, BLOCK, ITEM, COOL, HOT } from '../src/game/constants.js';
import { createState, getReady } from '../src/game/engine.js';

const clone = (id) => JSON.parse(JSON.stringify(maps[id]));

/** 決定的な擬似乱数。テストのたびに同じ盤面が出る */
function seeded(seed = 42) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

const count = (map, v) => map.flat().filter((c) => c === v).length;

/* --- 盤面の生成 --- */

test('map_data が空のルームは生成対象', () => {
  const procedural = Object.values(maps).filter((m) => m.map_data.length === 0);
  assert.strictEqual(procedural.length, 10, '手続き生成のルームは10件のはず');
});

test('生成した盤面の大きさが定義どおり', () => {
  const m = createMap(clone('room_001'), seeded());
  assert.strictEqual(m.map_data.length, m.map_size_y);
  assert.strictEqual(m.map_data[0].length, m.map_size_x);
});

test('指定された数のブロックとアイテムが置かれる', () => {
  const def = clone('room_001');
  const m = createMap(def, seeded());
  assert.strictEqual(count(m.map_data, BLOCK), def.auto_block);
  assert.strictEqual(count(m.map_data, ITEM), def.auto_point);
});

test('対称マップでも指定された数になる', () => {
  const def = clone('room_002');
  assert.ok(def.auto_symmetry, 'room_002 は対称マップのはず');
  const m = createMap(def, seeded());
  assert.strictEqual(count(m.map_data, BLOCK), def.auto_block);
  assert.strictEqual(count(m.map_data, ITEM), def.auto_point);
});

test('cool と hot がそれぞれ1つずつ置かれる', () => {
  const m = createMap(clone('room_001'), seeded());
  assert.strictEqual(count(m.map_data, COOL), 1);
  assert.strictEqual(count(m.map_data, HOT), 1);
});

test('cool と hot は盤の中心に対して点対称', () => {
  const m = createMap(clone('room_001'), seeded());
  const tx = Math.floor((m.map_size_x - 1) / 2);
  const ty = Math.floor((m.map_size_y - 1) / 2);
  assert.strictEqual(m.hot.x, tx + (tx - m.cool.x));
  assert.strictEqual(m.hot.y, ty + (ty - m.cool.y));
});

test('座標と盤面上のマーカーが一致する', () => {
  const m = createMap(clone('room_001'), seeded());
  assert.strictEqual(m.map_data[m.cool.y][m.cool.x], COOL);
  assert.strictEqual(m.map_data[m.hot.y][m.hot.x], HOT);
});

test('対称マップは盤面も点対称になる', () => {
  const m = createMap(clone('room_002'), seeded());
  const tx = Math.floor((m.map_size_x - 1) / 2);
  const ty = Math.floor((m.map_size_y - 1) / 2);

  for (let y = 0; y < m.map_size_y; y++) {
    for (let x = 0; x < m.map_size_x; x++) {
      const my = ty + (ty - y);
      const mx = tx + (tx - x);
      if (mx < 0 || mx >= m.map_size_x || my < 0 || my >= m.map_size_y) continue;

      const a = m.map_data[y][x];
      const b = m.map_data[my][mx];
      const isPlayer = (v) => v === COOL || v === HOT;
      if (isPlayer(a) || isPlayer(b)) continue;   // 駒は色が違うので対象外
      assert.strictEqual(a, b, `(${x},${y}) と (${mx},${my}) が対称ではありません`);
    }
  }
});

test('プレイヤーの周囲は空いている', () => {
  const m = createMap(clone('room_001'), seeded());
  for (const dy of [-1, 0, 1]) {
    for (const dx of [-1, 0, 1]) {
      const x = m.cool.x + dx;
      const y = m.cool.y + dy;
      if (x < 0 || x >= m.map_size_x || y < 0 || y >= m.map_size_y) continue;
      const cell = m.map_data[y][x];
      assert.ok(cell === FLOOR || cell === COOL || cell === HOT,
        `cool の隣 (${x},${y}) に ${cell} が置かれています`);
    }
  }
});

test('同じ乱数からは同じ盤面が出る', () => {
  const a = createMap(clone('room_001'), seeded(7));
  const b = createMap(clone('room_001'), seeded(7));
  assert.deepStrictEqual(a.map_data, b.map_data);
});

test('違う乱数からは違う盤面が出る', () => {
  const a = createMap(clone('room_001'), seeded(7));
  const b = createMap(clone('room_001'), seeded(99));
  assert.notDeepStrictEqual(a.map_data, b.map_data);
});

test('元のマップ定義を書き換えない', () => {
  const def = clone('room_001');
  const before = JSON.stringify(def);
  createMap(def, seeded());
  assert.strictEqual(JSON.stringify(def), before);
});

/* --- 配置だけのルーム --- */

test('座標が未定のルームに両者を配置する', () => {
  const def = clone('room_008');
  assert.ok(def.cool.x === undefined || def.cool.x < 0, 'room_008 は座標未定のはず');

  const m = spawnPlayers(def, seeded());
  assert.strictEqual(count(m.map_data, COOL), 1);
  assert.strictEqual(count(m.map_data, HOT), 1);
  assert.strictEqual(m.map_data[m.cool.y][m.cool.x], COOL);
  assert.strictEqual(m.map_data[m.hot.y][m.hot.x], HOT);
});

test('配置は床の上に限る', () => {
  const def = clone('room_009');
  const before = clone('room_009').map_data;
  const m = spawnPlayers(def, seeded());
  assert.strictEqual(before[m.cool.y][m.cool.x], FLOOR);
  assert.strictEqual(before[m.hot.y][m.hot.x], FLOOR);
});

/* --- 全ルームの通し --- */

test('prepareMap で全28ルームが試合を始められる形になる', () => {
  for (const [roomId, def] of Object.entries(maps)) {
    const m = prepareMap(clone(roomId), seeded(roomId.length * 13 + 1));

    assert.ok(m.map_data.length > 0, `${roomId}: 盤面が空です`);
    assert.strictEqual(count(m.map_data, COOL), 1, `${roomId}: cool が1つではありません`);
    assert.strictEqual(count(m.map_data, HOT), 1, `${roomId}: hot が1つではありません`);
    assert.ok(m.cool.x >= 0 && m.cool.y >= 0, `${roomId}: cool の座標が未定です`);
    assert.ok(m.hot.x >= 0 && m.hot.y >= 0, `${roomId}: hot の座標が未定です`);

    // 実際にエンジンへ通して周囲9マスが取れること
    const state = createState(m);
    const cells = getReady(state, 'cool');
    assert.strictEqual(cells.length, 9, `${roomId}: 周囲9マスが取れません`);
  }
});

test('固定盤面のルームは prepareMap を通しても変わらない', () => {
  const before = clone('room_014');
  const after = prepareMap(clone('room_014'), seeded());
  assert.deepStrictEqual(after.map_data, before.map_data);
  assert.deepStrictEqual(after.cool, before.cool);
});
