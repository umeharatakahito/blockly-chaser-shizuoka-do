/**
 * 盤面の自動生成。Node 版の create_map() と player_spon() を移した。
 *
 * 2種類ある。
 *   create_map()   map_data が空のルーム。ブロックもアイテムも位置から作る
 *   player_spon()  盤面はあるが cool/hot の座標が (-1,-1) のルーム。配置だけ決める
 *
 * 乱数を差し替えられるようにしてあるので、テストでは決定的に動かせる。
 */

import { FLOOR, BLOCK, ITEM, COOL, HOT } from './constants.js';

const pickIndex = (list, rng) => Math.floor(rng() * list.length);

/**
 * 盤面をまるごと生成する。
 *
 * cool の位置は盤の左半分から選び、hot はその点対称の位置に置く。
 * auto_symmetry が真ならブロックとアイテムも点対称に置く。
 *
 * @param {Object} mapDef マップ定義。map_data が空のもの
 * @returns {Object} map_data と cool/hot の座標を埋めた新しい定義
 */
export function createMap(mapDef, rng = Math.random) {
  const sizeX = mapDef.map_size_x;
  const sizeY = mapDef.map_size_y;

  const map = Array.from({ length: sizeY }, () => new Array(sizeX).fill(FLOOR));

  // 盤の中心。点対称の基準になる
  const tx = Math.floor((sizeX - 1) / 2);
  const ty = Math.floor((sizeY - 1) / 2);

  // cool を置ける候補。左半分から、中央付近の一部を除く
  let candidates = [];
  for (let x = 0; x < Math.floor(sizeX / 2) + 1; x++) {
    for (let y = 0; y < sizeY; y++) {
      if (y === Math.floor(sizeY / 2) - 1 && x === Math.floor(sizeX / 2)) break;
      if (x === Math.floor(sizeX / 2) - 1
          && y <= Math.floor(sizeY / 2) + 1 && y >= Math.floor(sizeY / 2) - 1) continue;
      candidates.push([x, y]);
    }
  }

  const ci = pickIndex(candidates, rng);
  const [cx, cy] = candidates[ci];
  const hx = tx + (tx - cx);
  const hy = ty + (ty - cy);
  candidates.splice(ci, 1);

  map[cy][cx] = COOL;
  map[hy][hx] = HOT;

  // 本家は auto_point / auto_block を書き換えるので、こちらも複製して扱う
  let points = mapDef.auto_point;
  let blocks = mapDef.auto_block;

  if (mapDef.auto_symmetry) {
    // 中央の縦3マスを候補に戻す
    for (let i = 0; i < 3; i++) {
      candidates.push([Math.floor(sizeX / 2) - 1, Math.floor(sizeY / 2) - 1 + i]);
    }
    // cool の周囲は空けておく
    candidates = candidates.filter(([x, y]) => !(x >= cx - 1 && x <= cx + 1 && y >= cy - 1 && y <= cy + 1));

    // 対称に置くため偶数・奇数を整える
    if (points % 2 === 0) points = points === 1 ? points + 1 : points - 1;
    if (blocks % 2 === 1) blocks = blocks === 1 ? blocks + 1 : blocks - 1;

    // 中心には必ずアイテムを1つ置く
    map[ty][tx] = ITEM;
    points -= 1;
  } else {
    // 両者の周囲を空けた全マスが候補
    candidates = [];
    for (let x = 0; x < sizeX; x++) {
      for (let y = 0; y < sizeY; y++) {
        const nearCool = x >= cx - 1 && x <= cx + 1 && y >= cy - 1 && y <= cy + 1;
        const nearHot = x >= hx - 1 && x <= hx + 1 && y >= hy - 1 && y <= hy + 1;
        if (!nearCool && !nearHot) candidates.push([x, y]);
      }
    }
  }

  /* アイテム */
  const placeItems = mapDef.auto_symmetry ? Math.floor(points / 2) : points;
  for (let i = 0; i < placeItems && candidates.length; i++) {
    const idx = pickIndex(candidates, rng);
    const [px, py] = candidates[idx];
    map[py][px] = ITEM;
    if (mapDef.auto_symmetry) map[ty + (ty - py)][tx + (tx - px)] = ITEM;
    candidates.splice(idx, 1);
  }

  // ブロックは外周に置かない。また、索敵(9マス)の端になる位置も避ける
  candidates = candidates.filter(([x, y]) => {
    if (x < 1 || x > sizeX - 2 || y < 1 || y > sizeY - 2) return false;
    if (x === cx && (y === cy + 9 || y === cy - 9)) return false;
    if (x === hx && (y === hy + 9 || y === hy - 9)) return false;
    return true;
  });

  /* ブロック */
  const placeBlocks = mapDef.auto_symmetry ? Math.floor(blocks / 2) : blocks;
  for (let i = 0; i < placeBlocks && candidates.length; i++) {
    const idx = pickIndex(candidates, rng);
    const [bx, by] = candidates[idx];
    map[by][bx] = BLOCK;
    if (mapDef.auto_symmetry) map[ty + (ty - by)][tx + (tx - bx)] = BLOCK;
    candidates.splice(idx, 1);
  }

  return {
    ...mapDef,
    map_data: map,
    cool: { ...mapDef.cool, x: cx, y: cy },
    hot: { ...mapDef.hot, x: hx, y: hy },
  };
}

/**
 * 盤面はそのままに、cool と hot の位置だけ決める。
 * cool は左半分の床から選び、hot は右半分(対称マップなら鏡像)に置く。
 */
export function spawnPlayers(mapDef, rng = Math.random) {
  const sizeX = mapDef.map_size_x;
  const sizeY = mapDef.map_size_y;
  const map = mapDef.map_data.map((row) => row.slice());

  const left = [];
  for (let x = 0; x < Math.floor(sizeX / 2) + 1; x++) {
    for (let y = 0; y < sizeY; y++) {
      if (map[y][x] !== FLOOR) continue;
      if (x === Math.floor(sizeX / 2) && y >= Math.floor(sizeY / 2)) continue;
      left.push([x, y]);
    }
  }

  const [cx, cy] = left[pickIndex(left, rng)];
  map[cy][cx] = COOL;

  let hx;
  let hy;

  if (mapDef.auto_symmetry) {
    // 本家の計算をそのまま使う
    hx = sizeX - cx;
    hy = sizeY - cy;
  } else {
    const right = [];
    for (let x = Math.floor(sizeX / 2) + 1; x < sizeX; x++) {
      for (let y = 0; y < sizeY; y++) {
        if (map[y][x] !== FLOOR) continue;
        if (x === Math.floor(sizeX / 2) && y <= Math.floor(sizeY / 2)) continue;
        right.push([x, y]);
      }
    }
    [hx, hy] = right[pickIndex(right, rng)];
  }

  map[hy][hx] = HOT;

  return {
    ...mapDef,
    map_data: map,
    cool: { ...mapDef.cool, x: cx, y: cy },
    hot: { ...mapDef.hot, x: hx, y: hy },
  };
}

/**
 * ルーム定義を、試合を始められる形に整える。
 * 盤面が無ければ生成し、座標が未定なら配置する。
 */
export function prepareMap(mapDef, rng = Math.random) {
  if (!mapDef.map_data || mapDef.map_data.length === 0) return createMap(mapDef, rng);
  if (mapDef.cool.x === undefined || mapDef.cool.x < 0) return spawnPlayers(mapDef, rng);
  return mapDef;
}
