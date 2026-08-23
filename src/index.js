/**
 * 入口の Worker。
 *
 * 役割は3つ。
 *   1. /room/<id> の WebSocket を、その試合の Durable Object へ渡す
 *   2. /api/... でマップやチュートリアルのデータを返す
 *   3. それ以外は静的ファイル。画面は言語ごとに別ファイルなので振り分ける
 *
 * 状態は一切持たない。試合の状態はすべて Durable Object 側にある。
 */

export { MatchRoom } from './room.js';

import { statusPage } from './status_page.js';
import maps from './data/maps.json' with { type: 'json' };
import tutorialData from './data/tutorial.json' with { type: 'json' };

const LANGS = ['ja', 'ja-k'];
const DEFAULT_LANG = 'ja';

/** 画面のパスと、書き出した HTML の名前の対応 */
const PAGES = {
  '/': 'index',
  '/menu-tutorial': 'menu-tutorial',
  '/menu-programming': 'menu-programming',
  '/menu-programming-exp': 'menu-programming-exp',
  '/menu-match': 'menu-match',
  '/programming': 'programming',
  '/programming-exp': 'programming-exp',
  '/match': 'match',
  '/watching': 'watching',
};

/** Cookie から言語を読む。未知の値なら既定 */
function pickLang(request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = /(?:^|;\s*)lng=([^;]+)/.exec(cookie);
  const lng = m ? decodeURIComponent(m[1]) : '';
  return LANGS.includes(lng) ? lng : DEFAULT_LANG;
}

/** public/pages/<lng>/<name>.html を返す */
function page(request, env, lng, name) {
  const url = new URL(request.url);
  url.pathname = `/pages/${lng}/${name}.html`;
  return env.ASSETS.fetch(new Request(url, request));
}

/** 一覧に出すルーム。合言葉つきや一時ルームは除く(本家と同じ扱い) */
function joinList() {
  return Object.values(maps)
    .filter((m) => !String(m.name).includes('room_onetime'))
    .map((m) => [(m.cpu ? 'AUTO: ' : 'VS: ') + m.name, m.room_id]);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    /* --- 試合 --- */
    // ルームIDには合言葉が付くことがある (例: room_010?ab12cd)。
    // クライアントが encodeURIComponent して送ってくるので ? は %3F で届く
    const room = /^\/room\/([^/]+)(\/.*)?$/.exec(path);
    if (room) {
      const roomId = decodeURIComponent(room[1]);
      // 合言葉ごとに別のインスタンスにする。同じ合言葉の人だけが同じ試合に入る
      const id = env.ROOM.idFromName(roomId);
      return env.ROOM.get(id).fetch(request);
    }

    /* --- データ --- */
    if (path === '/api/join') return Response.json(joinList());

    if (path === '/api/game') {
      const roomId = url.searchParams.get('room_id');
      if (roomId) return Response.json(maps[roomId] || false);
      return Response.json(maps);
    }

    if (path === '/api/tutorial') return Response.json(tutorialData.tutorial);

    if (path === '/api/bgm') return Response.json([]);

    if (path === '/health') {
      return Response.json({
        ok: true,
        service: 'blockly-chaser-shizuoka-do',
        rooms: Object.keys(maps).length,
        stages: Object.keys(tutorialData.tutorial).length,
      });
    }

    if (path === '/status') {
      return new Response(statusPage(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    /* --- 画面 --- */
    const lng = pickLang(request);

    if (PAGES[path] !== undefined) return page(request, env, lng, PAGES[path]);

    // チュートリアルはステージごとに1ページある
    if (path === '/tutorial') {
      const stage = url.searchParams.get('stage');
      if (stage && tutorialData.tutorial[stage]) {
        return page(request, env, lng, 'tutorial/' + stage);
      }
      return page(request, env, lng, 'menu-tutorial');
    }

    // 対戦画面は、そのルームに CPU がいるかで分かれる
    if (path === '/match/player') {
      const roomId = url.searchParams.get('room_id');
      const def = roomId ? maps[roomId.split('?')[0]] : null;
      return page(request, env, lng, def && def.cpu ? 'match-cpu' : 'match-player');
    }

    /* --- 静的ファイル --- */
    if (env.ASSETS) return env.ASSETS.fetch(request);

    return new Response('Not Found', { status: 404 });
  },
};
