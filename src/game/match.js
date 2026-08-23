/**
 * 1試合の進行。通信も保存も持たない純粋なロジックにしてある。
 *
 * Node 版の player_join / game_start_timer / game_result_check の
 * ターン制御にあたる部分を移した。
 *
 * 進行の約束事(本家と同じ):
 *   - cool が先手
 *   - 自分の番になると getready = true。get_ready を送ると false になり、行動できる
 *   - 行動すると相手の番になり、相手が時間内に動かなければ自分の勝ち
 *   - hot が動き終わるとターンが1つ減る
 */

import { createState, getReady, walk, look, search, putWall, checkResult } from './engine.js';
import { createCpuState, decideByLevel } from './cpu.js';

/** 相手が動かないまま試合が止まるのを防ぐ既定の待ち時間 */
export const DEFAULT_TIMEOUT_MS = 10000;
/** CPU が指すまでの間。本家と同じ */
export const CPU_DELAY_MS = 100;

/**
 * 試合を作る。
 *
 * @param {Object} mapDef  マップ定義
 * @param {Object} opts    { playerName, playerSide }
 *                         playerSide を省略すると、CPU 設定から自動で決める
 */
export function createMatch(mapDef, { playerName = 'player', playerSide = null } = {}) {
  const state = createState(mapDef);

  let side = playerSide;
  let cpu = null;

  if (mapDef.cpu) {
    // 本家では cpu.turn が CPU の担当側を表す
    const cpuSide = mapDef.cpu.turn === 'cool' ? 'cool' : 'hot';
    side = side ?? (cpuSide === 'cool' ? 'hot' : 'cool');
    cpu = { side: cpuSide, brain: createCpuState(mapDef.cpu.level) };
    state[cpuSide].name = 'cpu';
  } else {
    side = side ?? 'cool';
  }

  state[side].name = playerName;

  return {
    state,
    cpu,
    playerSide: side,
    finished: false,
    result: null,
    timeoutMs: Number.isFinite(mapDef.timeout) ? mapDef.timeout * 1000 : DEFAULT_TIMEOUT_MS,
  };
}

/** 試合を開始する。cool の番から始まる */
export function startMatch(match) {
  match.state.cool.turn = true;
  match.state.cool.getready = true;
  return match;
}

/** いま指定した側の番か */
export const isTurnOf = (match, chara) => match.state[chara].turn === true;

/**
 * 自分の周囲9マスを受け取り、行動できる状態にする。
 * 自分の番でなければ null を返す(本家は空の応答を返すのに対応)。
 */
export function requestReady(match, chara) {
  const me = match.state[chara];
  if (!me.turn || !me.getready) return null;

  me.getready = false;
  return getReady(match.state, chara);
}

/**
 * 行動の種類。キーは本家のイベント名に合わせてある。
 * effect は画面演出の種別で、本家の game_result_check に渡す値と同じ。
 */
const ACTIONS = {
  move_player: {
    effect: 'r',
    run: (state, chara, dir) => ({ cells: walk(state, chara, dir), attacked: false }),
  },
  look: {
    effect: 'l',
    run: (state, chara, dir) => ({ cells: look(state, chara, dir), attacked: false }),
  },
  search: {
    effect: 's',
    run: (state, chara, dir) => ({ cells: search(state, chara, dir), attacked: false }),
  },
  put_wall: {
    effect: 'r',
    run: (state, chara, dir) => {
      const { cells, hitOpponent } = putWall(state, chara, dir);
      return { cells, attacked: hitOpponent };
    },
  },
};

/** 応答のイベント名。本家と同じ */
export const REC_EVENT = {
  move_player: 'move_rec',
  look: 'look_rec',
  search: 'search_rec',
  put_wall: 'put_rec',
};

/**
 * 行動を1つ適用する。
 *
 * @returns {{cells: number[], result: Object|null, nextTurn: string|null}|null}
 *          自分の番でない、または get_ready がまだなら null
 */
export function applyAction(match, chara, kind, direction) {
  const me = match.state[chara];
  if (match.finished) return null;
  if (!me.turn || me.getready) return null;

  const action = ACTIONS[kind];
  if (!action) return null;

  me.turn = false;
  me.getready = true;

  const { cells, attacked } = action.run(match.state, chara, direction);
  const result = checkResult(match.state, chara, attacked);

  // 画面演出用。本家の updata_board に載る effect と同じ形
  const effect = { t: action.effect, p: chara };
  if (action.effect === 'l' || action.effect === 's') effect.d = direction;

  if (result) {
    match.finished = true;
    match.result = result;
    return { cells, result, effect, nextTurn: null };
  }

  const next = chara === 'cool' ? 'hot' : 'cool';
  match.state[next].turn = true;
  match.state[next].getready = true;

  return { cells, result: null, effect, nextTurn: next };
}

/**
 * 時間切れ。動かなかった側の負けにする。
 * @param {string} winner 勝ちになる側
 */
export function timeout(match, winner) {
  if (match.finished) return null;
  match.finished = true;
  match.result = { winner, info: 'タイムアウトより' };
  return match.result;
}

/**
 * CPU に1手指させる。CPU の番でなければ何もしない。
 *
 * @returns {{kind: string, direction: string, cells: number[], result: Object|null, nextTurn: string|null}|null}
 */
export function playCpuTurn(match, rng = Math.random) {
  if (!match.cpu || match.finished) return null;

  const side = match.cpu.side;
  if (!isTurnOf(match, side)) return null;

  const cells = requestReady(match, side);
  if (!cells) return null;

  const [kind, direction] = decideByLevel(cells, match.cpu.brain, rng);

  // CPU の判断結果を本家のイベント名へ読み替える
  const mapped = kind === 'attack' ? 'put_wall' : kind === 'move' ? 'move_player' : kind;
  const outcome = applyAction(match, side, mapped, direction);
  if (!outcome) return null;

  return { kind: mapped, direction, ...outcome };
}

/** 画面へ送る盤面 */
export function boardSnapshot(match) {
  return {
    map: match.state.map,
    coolScore: match.state.cool.score,
    hotScore: match.state.hot.score,
    turn: match.state.turn,
    coolName: match.state.cool.name,
    hotName: match.state.hot.name,
  };
}
