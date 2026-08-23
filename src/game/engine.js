/**
 * CHaser の試合エンジン。
 *
 * Node 版 chaser/server.js の move_player / look / search / put_wall /
 * get_ready / game_result_check を、入出力から切り離した純粋な関数として移した。
 *
 * ここには通信もタイマーも無い。盤面と行動を受け取って新しい盤面を返すだけにしてある。
 * こうしておくと、Durable Objects でも Node でもそのまま動き、テストも書きやすい。
 *
 * 本家との差異を作らないことが最優先。読みやすさより忠実さを採っている箇所がある。
 */

import {
  FLOOR, BLOCK, ITEM, COOL, HOT, BOTH,
  REC_BLOCK, charaNum, charaNumDiff, toRec,
} from './constants.js';

/* ------------------------------------------------------------ 盤面 */

/**
 * マップ定義から試合の状態を作る。
 * マップ定義は Node 版の load_data/game_server_data/*.json と同じ形式。
 */
export function createState(mapDef) {
  return {
    name: mapDef.name,
    roomId: mapDef.room_id,
    sizeX: mapDef.map_size_x,
    sizeY: mapDef.map_size_y,
    // 元の定義を壊さないよう複製する
    map: mapDef.map_data.map((row) => row.slice()),
    turn: mapDef.turn,
    cool: { x: mapDef.cool.x, y: mapDef.cool.y, score: 0, name: '', turn: false, getready: true },
    hot: { x: mapDef.hot.x, y: mapDef.hot.y, score: 0, name: '', turn: false, getready: true },
  };
}

const inBounds = (state, x, y) => x >= 0 && x < state.sizeX && y >= 0 && y < state.sizeY;

/** 方向から移動量を求める。本家と同じく、既知の3方向以外はすべて right として扱う */
function delta(direction) {
  if (direction === 'top') return [0, -1];
  if (direction === 'bottom') return [0, 1];
  if (direction === 'left') return [-1, 0];
  return [1, 0];
}

/**
 * 指定した範囲のセルを、クライアントへ返す形に変換して並べる。
 * 盤外はブロック扱いにする(本家と同じ)。
 */
function scan(state, chara, originX, originY, xRange, yRange) {
  const out = [];
  for (const dy of yRange) {
    for (const dx of xRange) {
      const x = originX + dx;
      const y = originY + dy;
      out.push(inBounds(state, x, y) ? toRec(state.map[y][x], chara) : REC_BLOCK);
    }
  }
  return out;
}

/* ------------------------------------------------------------ 行動 */

/** 自分の周囲9マス。ターンの最初に呼ぶ */
export function getReady(state, chara) {
  const me = state[chara];
  return scan(state, chara, me.x, me.y, [-1, 0, 1], [-1, 0, 1]);
}

/**
 * 移動する。
 *
 * 本家の move_player と同じく、移動先がブロックでも座標だけは動く。
 * 盤面には駒が置かれないため、直後の判定で「ブロック衝突」の負けになる。
 * 盤外へ出ようとした場合も同様に負けになる。
 */
export function walk(state, chara, direction) {
  const me = state[chara];
  const mine = charaNum[chara];
  const theirs = charaNumDiff[chara];

  // 元いたマスを空ける。相手と重なっていた場合は相手だけを残す
  state.map[me.y][me.x] = state.map[me.y][me.x] === BOTH ? theirs : FLOOR;

  const [dx, dy] = delta(direction);
  const nx = me.x + dx;
  const ny = me.y + dy;
  const moved = inBounds(state, nx, ny);

  if (moved) {
    me.x = nx;
    me.y = ny;

    const target = state.map[ny][nx];
    if (target === FLOOR) {
      state.map[ny][nx] = mine;
    } else if (target === ITEM) {
      state.map[ny][nx] = mine;
      me.score += 1;
      // アイテムを取ると、来たマスがブロックになる
      state.map[ny - dy][nx - dx] = BLOCK;
    } else if (target === theirs) {
      state.map[ny][nx] = BOTH;
    }
    // ブロックの場合は何も置かない。座標だけが移り、判定で負けになる
  }

  return scan(state, chara, me.x, me.y, [-1, 0, 1], [-1, 0, 1]);
}

/** 指定方向の 3x3 を見る(1〜3マス先) */
export function look(state, chara, direction) {
  const me = state[chara];
  if (direction === 'top') return scan(state, chara, me.x, me.y, [-1, 0, 1], [-3, -2, -1]);
  if (direction === 'bottom') return scan(state, chara, me.x, me.y, [-1, 0, 1], [1, 2, 3]);
  if (direction === 'left') return scan(state, chara, me.x, me.y, [-3, -2, -1], [-1, 0, 1]);
  return scan(state, chara, me.x, me.y, [1, 2, 3], [-1, 0, 1]);
}

/** 指定方向の直線9マスを見る */
export function search(state, chara, direction) {
  const me = state[chara];
  const far = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const near = far.map((n) => -n);

  if (direction === 'top') return scan(state, chara, me.x, me.y, [0], near);
  if (direction === 'bottom') return scan(state, chara, me.x, me.y, [0], far);
  if (direction === 'left') return scan(state, chara, me.x, me.y, near, [0]);
  return scan(state, chara, me.x, me.y, far, [0]);
}

/**
 * 隣のマスにブロックを置く。
 * 相手がいるマスに置いた場合は攻撃になり、勝敗判定で使うため戻り値で知らせる。
 *
 * @returns {{cells: number[], hitOpponent: boolean}}
 */
export function putWall(state, chara, direction) {
  const me = state[chara];
  const theirs = charaNumDiff[chara];

  const [dx, dy] = delta(direction);
  const x = me.x + dx;
  const y = me.y + dy;

  let hitOpponent = false;
  if (inBounds(state, x, y)) {
    if (state.map[y][x] === theirs) hitOpponent = true;
    state.map[y][x] = BLOCK;
  }

  return {
    cells: scan(state, chara, me.x, me.y, [-1, 0, 1], [-1, 0, 1]),
    hitOpponent,
  };
}

/* ------------------------------------------------------------ 勝敗 */

/** 上下左右のセル。盤外はブロック扱い */
function neighbours(state, x, y) {
  return {
    left: x - 1 < 0 ? BLOCK : state.map[y][x - 1],
    right: x + 1 > state.sizeX - 1 ? BLOCK : state.map[y][x + 1],
    top: y - 1 < 0 ? BLOCK : state.map[y - 1][x],
    bottom: y + 1 > state.sizeY - 1 ? BLOCK : state.map[y + 1][x],
  };
}

const surrounded = (n) => n.top === BLOCK && n.bottom === BLOCK && n.left === BLOCK && n.right === BLOCK;

/**
 * 1手ぶんの決着判定。本家の game_result_check と同じ順序で見る。
 *
 * @param {string} chara      いま行動した側
 * @param {boolean} attacked  put で相手を叩いたか。勝因の文言が変わる
 * @returns {{winner: 'cool'|'hot'|'draw', info: string}|null} 決着していなければ null
 */
export function checkResult(state, chara, attacked = false) {
  // hot が動き終わるとターンが1つ減る
  if (chara === 'hot') state.turn -= 1;

  if (state.turn === 0) {
    if (state.cool.score > state.hot.score) return { winner: 'cool', info: 'スコアより' };
    if (state.cool.score < state.hot.score) return { winner: 'hot', info: 'スコアより' };
    return { winner: 'draw', info: 'スコアより' };
  }

  const c = state.map[state.cool.y][state.cool.x];
  const h = state.map[state.hot.y][state.hot.x];

  // 自分の駒が盤面に無い = ブロックへ突っ込んだか盤外へ出た
  const coolLost = c !== BOTH && c !== COOL;
  const hotLost = c !== BOTH && h !== HOT;

  if (coolLost && h !== HOT) return { winner: 'draw', info: 'アタックにより' };
  if (coolLost) return { winner: 'hot', info: attacked ? 'アタックにより' : 'ブロック衝突により' };
  if (hotLost) return { winner: 'cool', info: attacked ? 'アタックにより' : 'ブロック衝突により' };

  const cn = neighbours(state, state.cool.x, state.cool.y);
  const hn = neighbours(state, state.hot.x, state.hot.y);
  const coolStuck = surrounded(cn);
  const hotStuck = surrounded(hn);

  if (coolStuck && hotStuck) return { winner: 'draw', info: 'ブロック閉じ込めにより' };
  if (coolStuck) return { winner: 'hot', info: 'ブロック閉じ込めにより' };
  if (hotStuck) return { winner: 'cool', info: 'ブロック閉じ込めにより' };

  return null;
}
