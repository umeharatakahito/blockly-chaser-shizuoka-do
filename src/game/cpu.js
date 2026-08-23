/**
 * CPU の思考。Node 版 chaser/server.js の cpu() と cpu_action() を移した。
 *
 * 判断材料は「クライアントへ返す形の周囲9マス」だけで、盤面そのものは見ない。
 * 本家がそうなっているため、そこも変えていない。
 *
 *   9マスの並び        値の意味
 *     0 1 2            0 = 床
 *     3 4 5            1 = 相手
 *     6 7 8            2 = ブロック
 *   4 が自分           3 = アイテム
 *
 * レベルは数値のほか "2?item=10&holdAttack=3" のような文字列も受け付ける。
 * 本家と同じ書式で、? 以降がパラメータになる。
 */

const WALL = 2;
const ITEM = 3;

/** 直前4手を見るため、履歴は最低5件を保つ */
const INITIAL_HISTORY = ['mode_direction', 'mode_direction', 'mode_direction', 'mode_direction', 'mode_direction'];

/**
 * レベル指定を解釈して CPU の記憶を作る。
 * 記憶は試合のあいだ持ち越す(Durable Object の中に置く)。
 */
export function createCpuState(levelSpec) {
  let level = 0;
  const params = {};

  if (typeof levelSpec === 'number') {
    level = levelSpec;
  } else if (typeof levelSpec === 'string') {
    const head = levelSpec[0];
    level = head === '1' ? 1 : head === '2' ? 2 : 0;

    const q = levelSpec.indexOf('?');
    if (q !== -1) {
      for (const pair of levelSpec.slice(q + 1).split('&')) {
        const [key, value] = pair.split('=');
        const n = parseInt(value, 10);
        if (key) params[key] = Number.isNaN(n) ? undefined : n;
      }
    }
  }

  return {
    level,
    params,
    history: INITIAL_HISTORY.slice(),
    turn: 0,
    nowItem: 0,
    wall3: 0,
  };
}

const pick = (list, rng) => list[Math.floor(rng() * list.length)];

/**
 * レベル2の思考。周囲9マスから次の行動を決める。
 *
 * @returns {[('attack'|'move'|'search'), string]}
 */
export function decideAction(cells, cpu, rng = Math.random) {
  const history = cpu.history;
  const params = cpu.params;

  cpu.turn += 1;

  // アイテムを取ってよいターンか。item が未指定なら常に取りに行く
  const canGetItem = params.item === undefined
    || Math.floor(cpu.turn / params.item) + 1 > cpu.nowItem;

  if (history.length >= 6) history.shift();

  // 通常 4 は自分(=0)だが、相手と重なっていると 1 になる。本家の判定をそのまま使う
  const enemy = cells[4] === 1 ? 2 : 1;

  /* 基本行動1: 上下左右に相手がいれば攻撃 */
  if (cells[1] === enemy || cells[3] === enemy || cells[5] === enemy || cells[7] === enemy) {
    if (params.holdAttack === undefined) {
      if (cells[1] === enemy) { history.push('attack_top'); return ['attack', 'top']; }
      if (cells[3] === enemy) { history.push('attack_left'); return ['attack', 'left']; }
      if (cells[5] === enemy) { history.push('attack_right'); return ['attack', 'right']; }
      history.push('attack_bottom');
      return ['attack', 'bottom'];
    }

    // 攻撃を保留する設定のときは、相手から離れる向きへ逃げる
    params.holdAttack -= 1;
    if (params.holdAttack === 0) params.holdAttack = undefined;

    const away = [];
    const addIfOpen = (index, name) => { if (cells[index] !== WALL) away.push(name); };

    if (cells[1] === enemy) { addIfOpen(3, 'left'); addIfOpen(5, 'right'); addIfOpen(7, 'bottom'); }
    else if (cells[3] === enemy) { addIfOpen(1, 'top'); addIfOpen(5, 'right'); addIfOpen(7, 'bottom'); }
    else if (cells[5] === enemy) { addIfOpen(1, 'top'); addIfOpen(3, 'left'); addIfOpen(7, 'bottom'); }
    else { addIfOpen(1, 'top'); addIfOpen(3, 'left'); addIfOpen(5, 'right'); }

    const dir = pick(away, rng);
    history.push('move_' + dir);
    return ['move', dir];
  }

  /* 基本行動2: 周囲の状況から向きごとの点数を出す */
  const score = { top: 100, left: 100, bottom: 100, right: 100 };

  // 斜めに相手がいる場合、まず索敵で1ターン様子を見る
  if (cells[0] === enemy || cells[2] === enemy || cells[6] === enemy || cells[8] === enemy) {
    if (history[history.length - 1].split('_')[0] !== 'search') {
      history.push('search_randam');
      return ['search', 'bottom'];
    }
    // 既に索敵したあとなら、相手のいる側を避ける
    if (cells[0] === enemy) { score.top -= 200; score.left -= 200; }
    if (cells[2] === enemy) { score.top -= 200; score.right -= 200; }
    if (cells[6] === enemy) { score.bottom -= 200; score.left -= 200; }
    if (cells[8] === enemy) { score.bottom -= 200; score.right -= 200; }
  }

  // 斜めのアイテムは、その方向へ寄る動機になる
  if (params.naname !== 0) {
    if (cells[0] === ITEM) { score.top += 50; score.left += 50; }
    if (cells[2] === ITEM) { score.top += 50; score.right += 50; }
    if (cells[6] === ITEM) { score.bottom += 50; score.left += 50; }
    if (cells[8] === ITEM) { score.bottom += 50; score.right += 50; }
  }

  // 隣のアイテム。ただしその両脇に相手がいる、または両脇とも壁なら見送る
  const considerItem = (itemIdx, sideA, sideB, dir) => {
    if (cells[itemIdx] !== ITEM) return;
    if (cells[sideA] === enemy || cells[sideB] === enemy) return;
    if (cells[sideA] === WALL && cells[sideB] === WALL) return;
    score[dir] += canGetItem ? 50 : -50;
  };
  considerItem(1, 0, 2, 'top');
  considerItem(3, 0, 6, 'left');
  considerItem(5, 2, 8, 'right');
  considerItem(7, 6, 8, 'bottom');

  // 直前に「3面が壁」の処理をしたなら、来た方向とは違う向きへ寄せる
  if (cpu.wall3 === 1) {
    cpu.wall3 = 0;
    const [name, direction] = history[history.length - 1].split('_');
    if (name === 'move') {
      if (direction === 'top' || direction === 'bottom') { score.left += 50; score.right += 50; }
      else if (direction === 'left' || direction === 'right') { score.top += 50; score.bottom += 50; }
    }
  }

  // 一辺が壁で埋まっているときは外周にいる可能性が高い。その向きを避ける
  const wallSide = (a, b, c) => cells[a] === WALL && cells[b] === WALL && cells[c] === WALL;

  if (wallSide(0, 1, 2)) {
    score.top -= 100; score.left -= 50; score.right -= 50; score.bottom += 50; cpu.wall3 = 1;
  } else if (wallSide(0, 3, 6)) {
    score.left -= 100; score.top -= 50; score.bottom -= 50; score.right += 50; cpu.wall3 = 1;
  } else if (wallSide(2, 5, 8)) {
    score.right -= 100; score.top -= 50; score.bottom -= 50; score.left += 50; cpu.wall3 = 1;
  } else if (wallSide(6, 7, 8)) {
    score.bottom -= 100; score.left -= 50; score.right -= 50; score.top += 50; cpu.wall3 = 1;
  } else {
    // 直前4手を見て、同じ向きを続けやすく、引き返しにくくする
    const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
    for (let i = 1; i < 5; i++) {
      const [name, direction] = history[history.length - i].split('_');
      const weight = 20 / (i * i);
      if (name === 'move') score[direction] += weight;
      if (opposite[direction]) score[opposite[direction]] -= weight;
    }
  }

  // 壁の向きへは進めない。ただし既に負の評価なら下げ直さない(本家と同じ)
  const blockIfWall = (index, dir) => {
    if (cells[index] === WALL && score[dir] > 0) score[dir] = 0;
  };
  blockIfWall(1, 'top');
  blockIfWall(3, 'left');
  blockIfWall(5, 'right');
  blockIfWall(7, 'bottom');

  // 最高点の向きを選ぶ。同点なら等確率で
  const best = Object.keys(score).reduce((a, b) => (score[a] > score[b] ? a : b));
  const tied = Object.keys(score).filter((k) => score[k] === score[best]);
  const chosen = pick(tied, rng);

  if (score[chosen] >= 30) {
    history.push('move_' + chosen);

    // 進む先にアイテムがあれば取得数を数える
    const itemAhead = { top: 1, left: 3, right: 5, bottom: 7 }[chosen];
    if (cells[itemAhead] === ITEM) cpu.nowItem += 1;

    return ['move', chosen];
  }

  // どこにも動けないときは索敵で1ターン使う
  history.push('search_randam');
  return ['search', 'top'];
}

/**
 * レベルに応じて次の行動を決める。
 *
 *   0: ひたすら上を索敵する
 *   1: 壁でない向きへランダムに動く
 *   2: decideAction による判断
 */
export function decideByLevel(cells, cpu, rng = Math.random) {
  if (cpu.level === 1) {
    const open = [];
    if (cells[1] !== WALL) open.push('top');
    if (cells[3] !== WALL) open.push('left');
    if (cells[5] !== WALL) open.push('right');
    if (cells[7] !== WALL) open.push('bottom');
    // 本家は空配列でも参照するため undefined になりうる。ここでは索敵に倒す
    if (open.length === 0) return ['look', 'top'];
    return ['move', pick(open, rng)];
  }

  if (cpu.level === 2) return decideAction(cells, cpu, rng);

  return ['look', 'top'];
}
