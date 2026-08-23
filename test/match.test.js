import test from 'node:test';
import assert from 'node:assert';

import maps from '../src/data/maps.json' with { type: 'json' };
import {
  createMatch, startMatch, requestReady, applyAction, timeout, playCpuTurn, boardSnapshot, isTurnOf,
} from '../src/game/match.js';

const fixedMap = (id) => JSON.parse(JSON.stringify(maps[id]));

/* --- 準備 --- */

test('マップが28ルーム揃っている', () => {
  assert.strictEqual(Object.keys(maps).length, 28);
  assert.ok(maps.room_014, '静岡決勝マップ(CPU対戦)がありません');
  assert.ok(maps.room_114, '静岡決勝マップ(対人)がありません');
});

test('CPU対戦ルームでは相手が cpu になる', () => {
  const m = createMatch(fixedMap('room_014'), { playerName: 'テスト選手' });
  assert.strictEqual(m.playerSide, 'cool');
  assert.strictEqual(m.cpu.side, 'hot');
  assert.strictEqual(m.state.hot.name, 'cpu');
  assert.strictEqual(m.state.cool.name, 'テスト選手');
});

test('対人ルームでは CPU がいない', () => {
  const m = createMatch(fixedMap('room_114'), { playerName: 'テスト選手' });
  assert.strictEqual(m.cpu, null);
});

test('cool が先手', () => {
  const m = startMatch(createMatch(fixedMap('room_014')));
  assert.ok(isTurnOf(m, 'cool'));
  assert.ok(!isTurnOf(m, 'hot'));
});

/* --- ターンの制御 --- */

test('自分の番でなければ get_ready は通らない', () => {
  const m = startMatch(createMatch(fixedMap('room_014')));
  assert.strictEqual(requestReady(m, 'hot'), null);
  assert.ok(Array.isArray(requestReady(m, 'cool')));
});

test('get_ready の前に行動はできない', () => {
  const m = startMatch(createMatch(fixedMap('room_014')));
  assert.strictEqual(applyAction(m, 'cool', 'walk', 'top'), null);
});

test('get_ready のあとに1回だけ行動できる', () => {
  const m = startMatch(createMatch(fixedMap('room_014')));
  requestReady(m, 'cool');
  assert.ok(applyAction(m, 'cool', 'look', 'top'));
  assert.strictEqual(applyAction(m, 'cool', 'look', 'top'), null, '2回行動できてしまいます');
});

test('行動すると相手の番になる', () => {
  const m = startMatch(createMatch(fixedMap('room_014')));
  requestReady(m, 'cool');
  const out = applyAction(m, 'cool', 'look', 'top');
  assert.strictEqual(out.nextTurn, 'hot');
  assert.ok(isTurnOf(m, 'hot'));
});

test('未知の行動は受け付けない', () => {
  const m = startMatch(createMatch(fixedMap('room_014')));
  requestReady(m, 'cool');
  assert.strictEqual(applyAction(m, 'cool', 'fly', 'top'), null);
});

/* --- 決着 --- */

test('時間切れで決着する', () => {
  const m = startMatch(createMatch(fixedMap('room_014')));
  const r = timeout(m, 'hot');
  assert.deepStrictEqual(r, { winner: 'hot', info: 'タイムアウトより' });
  assert.ok(m.finished);
});

test('決着後は行動できない', () => {
  const m = startMatch(createMatch(fixedMap('room_014')));
  requestReady(m, 'cool');
  timeout(m, 'hot');
  assert.strictEqual(applyAction(m, 'cool', 'walk', 'top'), null);
});

test('ブロックへ突っ込むと決着する', () => {
  const m = startMatch(createMatch(fixedMap('room_014')));
  const cells = requestReady(m, 'cool');

  // 周囲でブロック(2)の方向を探して突っ込む
  const dirs = { 1: 'top', 3: 'left', 5: 'right', 7: 'bottom' };
  const wallIndex = Object.keys(dirs).find((i) => cells[i] === 2);
  assert.ok(wallIndex, 'テスト用にブロックが隣接している必要があります');

  const out = applyAction(m, 'cool', 'walk', dirs[wallIndex]);
  assert.ok(out.result, '決着していません');
  assert.strictEqual(out.result.winner, 'hot');
});

/* --- CPU --- */

test('CPU は自分の番でなければ動かない', () => {
  const m = startMatch(createMatch(fixedMap('room_014')));
  assert.strictEqual(playCpuTurn(m), null, 'cool の番なのに CPU が動いています');
});

test('CPU が自分の番に1手指す', () => {
  const m = startMatch(createMatch(fixedMap('room_014')));
  requestReady(m, 'cool');
  applyAction(m, 'cool', 'look', 'top');

  const move = playCpuTurn(m, () => 0);
  assert.ok(move, 'CPU が動いていません');
  assert.ok(['walk', 'look', 'search', 'put'].includes(move.kind), '不正な行動: ' + move.kind);
  assert.ok(isTurnOf(m, 'cool'), 'CPU のあとに手番が戻っていません');
});

/* --- 通し --- */

test('CPU と最後まで戦って決着する', () => {
  const m = startMatch(createMatch(fixedMap('room_010'), { playerName: '通しテスト' }));

  // 線形合同法で決定的に動かす
  let seed = 12345;
  const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

  const dirs = ['top', 'bottom', 'left', 'right'];
  let steps = 0;

  while (!m.finished && steps < 2000) {
    steps++;

    if (isTurnOf(m, 'cool')) {
      const cells = requestReady(m, 'cool');
      assert.ok(cells, `${steps}手目: 周囲9マスが取れません`);

      // ブロックでない方向へ進む。無ければ索敵
      const idx = { top: 1, bottom: 7, left: 3, right: 5 };
      const open = dirs.filter((d) => cells[idx[d]] !== 2);
      if (open.length) applyAction(m, 'cool', 'walk', open[Math.floor(rng() * open.length)]);
      else applyAction(m, 'cool', 'search', 'top');
    } else if (isTurnOf(m, 'hot')) {
      assert.ok(playCpuTurn(m, rng), `${steps}手目: CPU が動きません`);
    } else {
      assert.fail(`${steps}手目: どちらの番でもありません`);
    }
  }

  assert.ok(m.finished, `${steps}手で決着しませんでした`);
  assert.ok(['cool', 'hot', 'draw'].includes(m.result.winner), '不正な勝者: ' + m.result.winner);
  assert.ok(m.result.info, '勝因がありません');
});

test('盤面の写しに必要な情報が揃っている', () => {
  const m = startMatch(createMatch(fixedMap('room_010'), { playerName: 'あおい' }));
  const snap = boardSnapshot(m);

  assert.strictEqual(snap.map.length, m.state.sizeY);
  assert.strictEqual(snap.coolScore, 0);
  assert.strictEqual(snap.coolName, 'あおい');
  assert.strictEqual(snap.hotName, 'cpu');
  assert.strictEqual(snap.turn, 100);
});
