import test from 'node:test';
import assert from 'node:assert';

import { createCpuState, decideAction, decideByLevel } from '../src/game/cpu.js';

/** 9マスを組み立てる。既定は全部床 */
function cells(overrides = {}) {
  const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const [i, v] of Object.entries(overrides)) c[i] = v;
  return c;
}

const FLOOR = 0, ENEMY = 1, WALL = 2, ITEM = 3;
const always = (v) => () => v;

/* --- レベル指定の解釈 --- */

test('数値のレベルを受け付ける', () => {
  assert.strictEqual(createCpuState(0).level, 0);
  assert.strictEqual(createCpuState(1).level, 1);
  assert.strictEqual(createCpuState(2).level, 2);
});

test('文字列のレベルとパラメータを解釈する', () => {
  const s = createCpuState('2?item=10&holdAttack=3');
  assert.strictEqual(s.level, 2);
  assert.deepStrictEqual(s.params, { item: 10, holdAttack: 3 });
});

test('未知のレベルは0として扱う', () => {
  assert.strictEqual(createCpuState('9').level, 0);
  assert.strictEqual(createCpuState('なんだこれ').level, 0);
});

test('履歴は直前4手を見るため5件から始まる', () => {
  assert.strictEqual(createCpuState(2).history.length, 5);
});

/* --- レベル0 / 1 --- */

test('レベル0はひたすら上を索敵する', () => {
  const cpu = createCpuState(0);
  assert.deepStrictEqual(decideByLevel(cells(), cpu), ['look', 'top']);
});

test('レベル1は壁でない向きへ動く', () => {
  const cpu = createCpuState(1);
  // 上と左が壁 → 右か下を選ぶ
  const action = decideByLevel(cells({ 1: WALL, 3: WALL }), cpu, always(0));
  assert.strictEqual(action[0], 'move');
  assert.ok(['right', 'bottom'].includes(action[1]), '壁の方向を選んでいます: ' + action[1]);
});

test('レベル1は四方が壁なら索敵に倒す', () => {
  const cpu = createCpuState(1);
  const action = decideByLevel(cells({ 1: WALL, 3: WALL, 5: WALL, 7: WALL }), cpu);
  assert.deepStrictEqual(action, ['look', 'top']);
});

/* --- レベル2: 攻撃 --- */

test('上下左右に相手がいれば攻撃する', () => {
  for (const [index, dir] of [[1, 'top'], [3, 'left'], [5, 'right'], [7, 'bottom']]) {
    const cpu = createCpuState(2);
    assert.deepStrictEqual(decideAction(cells({ [index]: ENEMY }), cpu), ['attack', dir]);
  }
});

test('攻撃したことが履歴に残る', () => {
  const cpu = createCpuState(2);
  decideAction(cells({ 1: ENEMY }), cpu);
  assert.strictEqual(cpu.history[cpu.history.length - 1], 'attack_top');
});

test('holdAttack 指定時は攻撃せず相手から離れる', () => {
  const cpu = createCpuState('2?holdAttack=2');
  const action = decideAction(cells({ 1: ENEMY }), cpu, always(0));
  assert.strictEqual(action[0], 'move');
  assert.notStrictEqual(action[1], 'top', '相手の方へ動いています');
  assert.strictEqual(cpu.params.holdAttack, 1, 'holdAttack が減っていません');
});

test('holdAttack を使い切ると攻撃を再開する', () => {
  const cpu = createCpuState('2?holdAttack=1');
  decideAction(cells({ 1: ENEMY }), cpu, always(0));
  assert.strictEqual(cpu.params.holdAttack, undefined);
  assert.deepStrictEqual(decideAction(cells({ 1: ENEMY }), cpu), ['attack', 'top']);
});

/* --- レベル2: 索敵 --- */

test('斜めに相手がいると、まず索敵で様子を見る', () => {
  const cpu = createCpuState(2);
  assert.deepStrictEqual(decideAction(cells({ 0: ENEMY }), cpu), ['search', 'bottom']);
});

test('索敵の直後は相手のいる側を避けて動く', () => {
  const cpu = createCpuState(2);
  decideAction(cells({ 0: ENEMY }), cpu);              // 1回目: 索敵
  const action = decideAction(cells({ 0: ENEMY }), cpu, always(0));  // 2回目
  assert.strictEqual(action[0], 'move');
  assert.ok(['right', 'bottom'].includes(action[1]),
    '左上に相手がいるのに左か上へ動いています: ' + action[1]);
});

test('動けないときは索敵する', () => {
  const cpu = createCpuState(2);
  const action = decideAction(cells({ 1: WALL, 3: WALL, 5: WALL, 7: WALL }), cpu);
  assert.deepStrictEqual(action, ['search', 'top']);
});

/* --- レベル2: アイテム --- */

test('隣のアイテムへ向かう', () => {
  const cpu = createCpuState(2);
  const action = decideAction(cells({ 5: ITEM }), cpu, always(0));
  assert.deepStrictEqual(action, ['move', 'right']);
});

test('アイテムの両脇が壁なら見送る', () => {
  const cpu = createCpuState(2);
  // 右にアイテム、その上下(2と8)が壁
  const action = decideAction(cells({ 5: ITEM, 2: WALL, 8: WALL }), cpu, always(0));
  assert.notStrictEqual(action[1], 'right', '袋小路のアイテムへ向かっています');
});

test('アイテムの脇に相手がいれば見送る', () => {
  const cpu = createCpuState(2);
  const action = decideAction(cells({ 5: ITEM, 2: ENEMY }), cpu, always(0));
  // 斜めの相手がいるので索敵が先に来る
  assert.strictEqual(action[0], 'search');
});

test('アイテムを取った回数を数える', () => {
  const cpu = createCpuState(2);
  decideAction(cells({ 5: ITEM }), cpu, always(0));
  assert.strictEqual(cpu.nowItem, 1);
});

test('item 指定があると取得ペースを抑える', () => {
  const cpu = createCpuState('2?item=100');
  // 1ターン目に1つ取ると、しばらく次のアイテムを避ける
  decideAction(cells({ 5: ITEM }), cpu, always(0));
  assert.strictEqual(cpu.nowItem, 1);

  const action = decideAction(cells({ 5: ITEM }), cpu, always(0));
  assert.notStrictEqual(action[1], 'right', '取得ペースの制限が効いていません');
});

/* --- レベル2: 壁沿い --- */

test('上側が3マスとも壁なら下へ寄る', () => {
  const cpu = createCpuState(2);
  const action = decideAction(cells({ 0: WALL, 1: WALL, 2: WALL }), cpu, always(0));
  assert.deepStrictEqual(action, ['move', 'bottom']);
  assert.strictEqual(cpu.wall3, 1, '外周判定の記録が残っていません');
});

test('左側が3マスとも壁なら右へ寄る', () => {
  const cpu = createCpuState(2);
  assert.deepStrictEqual(decideAction(cells({ 0: WALL, 3: WALL, 6: WALL }), cpu, always(0)), ['move', 'right']);
});

test('壁沿い処理の次のターンは進路を変える', () => {
  const cpu = createCpuState(2);
  decideAction(cells({ 0: WALL, 1: WALL, 2: WALL }), cpu, always(0));  // bottom へ
  assert.strictEqual(cpu.wall3, 1);

  decideAction(cells(), cpu, always(0));
  assert.strictEqual(cpu.wall3, 0, 'フラグが戻っていません');
});

/* --- レベル2: 履歴 --- */

test('同じ向きへ進み続けやすい', () => {
  const cpu = createCpuState(2);
  // 右へ4回動かす
  for (let i = 0; i < 4; i++) cpu.history.push('move_right');
  const action = decideAction(cells(), cpu, always(0));
  assert.deepStrictEqual(action, ['move', 'right'], '直進の傾向が出ていません');
});

test('履歴が伸びすぎない', () => {
  const cpu = createCpuState(2);
  for (let i = 0; i < 30; i++) decideAction(cells(), cpu, always(0));
  assert.ok(cpu.history.length <= 6, '履歴が ' + cpu.history.length + ' 件に増えています');
});

test('ターン数を数える', () => {
  const cpu = createCpuState(2);
  decideAction(cells(), cpu, always(0));
  decideAction(cells(), cpu, always(0));
  assert.strictEqual(cpu.turn, 2);
});

test('返す方向は必ず上下左右のいずれか', () => {
  const cpu = createCpuState(2);
  const rng = (() => { let n = 0; return () => ((n = (n * 9301 + 49297) % 233280) / 233280); })();

  for (let i = 0; i < 300; i++) {
    const c = cells();
    for (let j = 0; j < 9; j++) c[j] = Math.floor(rng() * 4);
    c[4] = 0;
    const [kind, dir] = decideAction(c, cpu, rng);
    assert.ok(['attack', 'move', 'search'].includes(kind), '不正な行動: ' + kind);
    assert.ok(['top', 'bottom', 'left', 'right'].includes(dir), '不正な方向: ' + dir);
  }
});
