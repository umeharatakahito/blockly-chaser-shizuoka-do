import test from 'node:test';
import assert from 'node:assert';

import maps from '../src/data/maps.json' with { type: 'json' };
import { prepareMap } from '../src/game/generate.js';
import { createState, getReady, walk, look, search, putWall, checkResult } from '../src/game/engine.js';
import {
  createBot, decideBotAction, afterBotAction, levelParams, clampLevel, describeLevel, MAX_LEVEL,
} from '../src/game/bot.js';
import { createMatch, startMatch, playCpuTurn } from '../src/game/match.js';

/** 再現できる乱数(mulberry32) */
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

const fixedMap = (id) => prepareMap(JSON.parse(JSON.stringify(maps[id])));

const ACT = {
  move: (s, c, d) => ({ attacked: false, cells: walk(s, c, d) }),
  move_player: (s, c, d) => ({ attacked: false, cells: walk(s, c, d) }),
  look: (s, c, d) => ({ attacked: false, cells: look(s, c, d) }),
  search: (s, c, d) => ({ attacked: false, cells: search(s, c, d) }),
  put_wall: (s, c, d) => { const r = putWall(s, c, d); return { attacked: r.hitOpponent, cells: r.cells }; },
};

/**
 * ボット同士を戦わせる。cool に levelA、hot に levelB。
 * @returns {{winner: string, info: string, turns: number}}
 */
function playBots(mapId, levelA, levelB, seed) {
  const rng = seeded(seed);
  const state = createState(fixedMap(mapId));
  const bots = {
    cool: createBot(levelA, state.sizeX, state.sizeY),
    hot: createBot(levelB, state.sizeX, state.sizeY),
  };

  let turns = 0;
  for (;;) {
    for (const side of ['cool', 'hot']) {
      getReady(state, side);
      const [kind, dir] = decideBotAction(state, side, bots[side], rng);
      assert.ok(ACT[kind], `不明な行動 ${kind}`);
      assert.ok(['top', 'bottom', 'left', 'right'].includes(dir), `不明な向き ${dir}`);
      const { attacked } = ACT[kind](state, side, dir);
      afterBotAction(bots[side], state, side, kind, dir);
      const result = checkResult(state, side, attacked);
      turns++;
      if (result) return { ...result, turns };
      if (turns > 2000) throw new Error('試合が終わりません');
    }
  }
}

/** levelA(cool) が levelB(hot) に勝った割合。先後の偏りを消すため入れ替えても数える */
function winRate(levelA, levelB, games = 20, mapId = 'room_112') {
  let wins = 0;
  let total = 0;
  for (let i = 0; i < games; i++) {
    const r1 = playBots(mapId, levelA, levelB, 1000 + i);
    if (r1.winner !== 'draw') { total++; if (r1.winner === 'cool') wins++; }
    const r2 = playBots(mapId, levelB, levelA, 2000 + i);
    if (r2.winner !== 'draw') { total++; if (r2.winner === 'hot') wins++; }
  }
  return total ? wins / total : 0.5;
}

/* --- パラメータ --- */

test('レベルは 1〜30 に丸める', () => {
  assert.strictEqual(clampLevel(0), 1);
  assert.strictEqual(clampLevel(31), 30);
  assert.strictEqual(clampLevel('12'), 12);
  assert.strictEqual(clampLevel('abc'), 1);
  assert.strictEqual(clampLevel(7.6), 8);
});

test('レベルが上がるほど迷いとうっかりが減り、攻撃が増える', () => {
  let prev = levelParams(1);
  for (let L = 2; L <= MAX_LEVEL; L++) {
    const p = levelParams(L);
    assert.ok(p.random <= prev.random, `L${L} の迷いが増えています`);
    assert.ok(p.blunder <= prev.blunder, `L${L} のうっかりが増えています`);
    assert.ok(p.attack >= prev.attack, `L${L} の攻撃が減っています`);
    prev = p;
  }
  assert.strictEqual(levelParams(10).random, 0);
  assert.strictEqual(levelParams(5).blunder, 0);
  assert.strictEqual(levelParams(8).attack, 1);
  assert.strictEqual(levelParams(1).attack, 0);
});

test('機能はレベルで段階的に解放される', () => {
  assert.ok(!levelParams(5).danger && levelParams(6).danger);
  assert.ok(!levelParams(19).omniscient && levelParams(20).omniscient);
  assert.ok(!levelParams(24).lookahead && levelParams(25).lookahead);
});

test('全レベルに説明がある', () => {
  for (let L = 1; L <= MAX_LEVEL; L++) assert.ok(describeLevel(L).length > 0);
});

/* --- 判断 --- */

test('隣に相手がいれば高レベルは必ず叩く', () => {
  const state = createState(fixedMap('room_112'));
  // cool の右に hot を置く
  const me = state.cool;
  state.map[state.hot.y][state.hot.x] = 0;
  state.hot.x = me.x + 1;
  state.hot.y = me.y;
  state.map[me.y][me.x + 1] = 4;

  const bot = createBot(30, state.sizeX, state.sizeY);
  const [kind, dir] = decideBotAction(state, 'cool', bot, seeded(1));
  assert.deepStrictEqual([kind, dir], ['put_wall', 'right']);
});

test('L1 は隣に相手がいても叩かない', () => {
  const state = createState(fixedMap('room_112'));
  const me = state.cool;
  state.map[state.hot.y][state.hot.x] = 0;
  state.hot.x = me.x + 1;
  state.hot.y = me.y;
  state.map[me.y][me.x + 1] = 4;

  const bot = createBot(1, state.sizeX, state.sizeY);
  for (let i = 0; i < 20; i++) {
    const [kind] = decideBotAction(state, 'cool', bot, seeded(i));
    assert.notStrictEqual(kind, 'put_wall');
  }
});

test('L10 以上はブロックへ突っ込まない', () => {
  for (let seed = 0; seed < 30; seed++) {
    const r = playBots('room_113', 10, 10, seed);
    assert.notStrictEqual(r.info, 'ブロック衝突により', `seed=${seed} で衝突しました`);
  }
});

test('記憶は JSON にして戻せる', () => {
  const state = createState(fixedMap('room_112'));
  const bot = createBot(15, state.sizeX, state.sizeY);
  decideBotAction(state, 'cool', bot, seeded(3));
  const copy = JSON.parse(JSON.stringify(bot));
  assert.deepStrictEqual(copy, bot);
  // 復元した記憶でも続けて判断できる
  const [kind] = decideBotAction(state, 'cool', copy, seeded(4));
  assert.ok(kind);
});

/* --- 強さの順序 --- */

test('L30 は L1 にほぼ必ず勝つ', () => {
  assert.ok(winRate(30, 1, 10) >= 0.9, `勝率 ${winRate(30, 1, 10)}`);
});

test('L20 は L8 に勝ち越す', () => {
  const rate = winRate(20, 8, 15);
  assert.ok(rate >= 0.6, `勝率 ${rate}`);
});

test('L10 は L3 に勝ち越す', () => {
  const rate = winRate(10, 3, 15);
  assert.ok(rate >= 0.6, `勝率 ${rate}`);
});

test('L5 は L1 に勝ち越す', () => {
  const rate = winRate(5, 1, 15);
  assert.ok(rate >= 0.55, `勝率 ${rate}`);
});

/* --- match.js との連携 --- */

test('ボット対戦の試合では人間側の手が記録される', () => {
  const m = startMatch(createMatch(fixedMap('room_112'), { playerName: 'テスト', bot: { level: 5 }, record: true }));
  assert.strictEqual(m.cpu.side, 'hot');
  assert.strictEqual(m.state.hot.name, 'ボット L5');
  assert.strictEqual(m.playerSide, 'cool');

  // cool(人間)が1手、hot(ボット)が1手
  const { requestReady, applyAction } = matchModule;
  requestReady(m, 'cool');
  applyAction(m, 'cool', 'look', 'top');
  const move = playCpuTurn(m, seeded(9));
  assert.ok(move);
  assert.deepStrictEqual(m.recording, [['look', 'top']], 'ボットの手は記録に入らない');
});

test('ゴーストは記録した手をなぞり、尽きたらボットとして続ける', () => {
  const actions = [['look', 'top'], ['search', 'left'], ['look', 'bottom']];
  const m = startMatch(createMatch(fixedMap('room_112'), {
    playerName: '挑戦者', ghost: { actions, level: 3, name: 'ゆうき' },
  }));
  assert.strictEqual(m.cpu.side, 'cool', 'ゴーストは記録した側(cool)');
  assert.strictEqual(m.playerSide, 'hot');
  assert.strictEqual(m.state.cool.name, 'ゴースト: ゆうき');

  const { requestReady, applyAction } = matchModule;
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const g = playCpuTurn(m, seeded(i));
    seen.push([g.kind, g.direction]);
    requestReady(m, 'hot');
    applyAction(m, 'hot', 'look', 'top');
  }
  assert.deepStrictEqual(seen.slice(0, 3), actions);
  assert.strictEqual(seen.length, 5, '記録が尽きたあとも手を指す');
});

import * as matchModule from '../src/game/match.js';
