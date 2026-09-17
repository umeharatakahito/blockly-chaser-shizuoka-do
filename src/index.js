/**
 * 入口の Worker。
 *
 * 役割は3つ。
 *   1. /room/<id> の WebSocket を、その試合の Durable Object へ渡す
 *   2. /api/... や /records/... などのデータを返す(多くは Durable Object へ渡す)
 *   3. それ以外は静的ファイル。画面は言語ごとに別ファイルなので振り分ける
 *
 * 状態は一切持たない。試合の状態はすべて Durable Object 側にある。
 *
 * 画面の構成:
 *   通常モード  チュートリアル / 対人対戦 / ボット対戦 / ゴースト対戦 / プログラミング
 *   大会モード  対戦トーナメント / 試合動画 / エントリー / データアップロード / 作品部門の提出
 *   運営モード  (鍵つき) 対戦表・動画・エントリー・アップロード・作品・記録の管理
 */

export { MatchRoom } from './room.js';
export { TournamentStore } from './tournament_do.js';
export { MovieStore } from './movies_do.js';
export { RecordStore } from './records_do.js';

import { statusPage } from './status_page.js';
import { handleWorks, worksReady, checkGas, MAX_WORK_BYTES } from './works.js';
import { isAdmin, hasAdminKey, login, logout, forbidden, isLocalhost } from './admin.js';
import { describeLevel, MIN_LEVEL, MAX_LEVEL } from './game/bot.js';
import maps from './data/maps.json' with { type: 'json' };
import tutorialData from './data/tutorial.json' with { type: 'json' };

const LANGS = ['ja', 'ja-k'];
const DEFAULT_LANG = 'ja';

/** 誰でも見られる画面。パスと、書き出した HTML の名前の対応 */
const PAGES = {
  '/': 'index',
  '/menu-tutorial': 'menu-tutorial',
  '/menu-programming': 'menu-programming',
  '/programming': 'programming',
  '/vs': 'menu-match',
  '/menu-match': 'menu-match',
  '/bot': 'menu-bot',
  '/ghost': 'menu-ghost',
  '/match': 'match',
  '/match/player': 'match-player',
  '/match/cpu': 'match-cpu',
  '/watching': 'watching',
  '/tournament': 'tournament',
  '/movies': 'movies',
  '/entry': 'entry',
  '/works': 'works',
  '/admin': 'admin',
};

/** 運営モードの画面。鍵が無いとログイン画面へ */
const ADMIN_PAGES = {
  '/tournament/admin': 'tournament-admin',
  '/movies/admin': 'movies-admin',
  '/admin/entries': 'admin-entries',
  '/admin/uploads': 'admin-uploads',
  '/admin/works': 'admin-works',
  '/admin/records': 'admin-records',
};

/** 古いパス。統合・改名した画面へ飛ばす */
const REDIRECTS = {
  '/menu-programming-exp': '/menu-programming',
  '/programming-exp': '/programming',
  // 提出はエントリーと同じ画面にまとめた
  '/upload': '/entry',
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

function redirect(url, to) {
  const dest = new URL(to, url);
  dest.search = url.search;
  return Response.redirect(dest.toString(), 302);
}

/** 一覧に出すルーム。合言葉つきや一時ルームは除く(本家と同じ扱い) */
function joinList() {
  return Object.values(maps)
    .filter((m) => !String(m.name).includes('room_onetime'))
    .map((m) => [(m.cpu ? 'AUTO: ' : 'VS: ') + m.name, m.room_id]);
}

function botLevels() {
  const levels = [];
  for (let L = MIN_LEVEL; L <= MAX_LEVEL; L++) levels.push({ level: L, description: describeLevel(L) });
  return levels;
}

/* ------------------------------------------------------------ データの振り分け */

/**
 * Durable Object へ渡すデータ要求。
 * admin: true のものは運営の鍵が要る。
 */
const DATA_ROUTES = [
  // 対戦表
  { binding: 'TOURNAMENT', method: 'GET', path: '/tournament/data' },
  { binding: 'TOURNAMENT', method: 'GET', path: '/tournament/admin-data', admin: true },
  { binding: 'TOURNAMENT', method: 'POST', re: /^\/tournament\/(title|players\/add|players\/remove|build|reset|result|import|results\/clear)$/, admin: true },
  // 試合動画
  { binding: 'MOVIES_META', method: 'GET', path: '/movies/list' },
  { binding: 'MOVIES_META', method: 'GET', path: '/movies/admin-list', admin: true },
  { binding: 'MOVIES_META', method: 'POST', re: /^\/movies\/(save|hide|show|remove)$/, admin: true },
  // ボット対戦の記録
  { binding: 'RECORDS', method: 'GET', re: /^\/records\/(ghosts|ghost|ranking)$/ },
  { binding: 'RECORDS', method: 'GET', path: '/records/admin-list', admin: true },
  { binding: 'RECORDS', method: 'POST', path: '/records/name' },
  { binding: 'RECORDS', method: 'POST', re: /^\/records\/(hide|show|remove)$/, admin: true },
  // エントリー
  { binding: 'RECORDS', method: 'GET', path: '/entry/list' },
  { binding: 'RECORDS', method: 'POST', path: '/entry/add' },
  { binding: 'RECORDS', method: 'GET', path: '/entry/admin-list', admin: true },
  { binding: 'RECORDS', method: 'POST', re: /^\/entry\/(update|hide|show|remove)$/, admin: true },
  // アップロード
  { binding: 'RECORDS', method: 'GET', path: '/upload/list' },
  { binding: 'RECORDS', method: 'POST', path: '/upload/add' },
  { binding: 'RECORDS', method: 'GET', re: /^\/upload\/(admin-list|file)$/, admin: true },
  { binding: 'RECORDS', method: 'POST', path: '/upload/remove', admin: true },
  // ドライブへの書き出し
  { binding: 'RECORDS', method: 'GET', path: '/drive/status', admin: true },
  { binding: 'RECORDS', method: 'POST', path: '/drive/sync', admin: true },
  // 作品部門(start / finish は Worker で受ける。handleWorks を参照)
  { binding: 'RECORDS', method: 'GET', path: '/works/admin-list', admin: true },
  { binding: 'RECORDS', method: 'POST', path: '/works/remove', admin: true },
];

function findDataRoute(method, path) {
  return DATA_ROUTES.find((r) => r.method === method && (r.path ? r.path === path : r.re.test(path))) || null;
}

/* ------------------------------------------------------------ 入口 */

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
    if (path === '/api/bot-levels') return Response.json(botLevels());

    /* --- 運営の鍵 --- */
    if (path === '/admin/status') {
      return Response.json({
        admin: await isAdmin(request, env),
        keyConfigured: hasAdminKey(env),
        localhost: isLocalhost(request),
      });
    }
    if (path === '/admin/login' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const res = await login(request, env, body.key);
      return res || Response.json({ ok: false, error: '鍵が違います' }, { status: 403 });
    }
    if (path === '/admin/logout' && request.method === 'POST') return logout();

    /* --- 作品部門の提出 --- */
    if (path === '/works/config') {
      return Response.json({ ready: worksReady(env), passcode: Boolean(env.WORKS_PASSCODE), maxBytes: MAX_WORK_BYTES });
    }
    if (path === '/works/check') {
      if (!(await isAdmin(request, env))) return forbidden();
      return Response.json(await checkGas(env));
    }
    if ((path === '/works/start' || path === '/works/finish') && request.method === 'POST') {
      return handleWorks(request, env, path);
    }

    /* --- Durable Object へ渡すデータ --- */
    const route = findDataRoute(request.method, path);
    if (route) {
      if (route.admin && !(await isAdmin(request, env))) return forbidden();
      const store = env[route.binding].get(env[route.binding].idFromName('main'));
      return store.fetch(request);
    }

    if (path === '/health') {
      return Response.json({
        ok: true,
        service: 'blockly-chaser-shizuoka-do',
        rooms: Object.keys(maps).length,
        stages: Object.keys(tutorialData.tutorial).length,
        adminKey: hasAdminKey(env),
      });
    }

    if (path === '/status') {
      return new Response(statusPage(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    /* --- 画面 --- */
    const lng = pickLang(request);

    if (REDIRECTS[path]) return redirect(url, REDIRECTS[path]);

    if (PAGES[path] !== undefined) return page(request, env, lng, PAGES[path]);

    if (ADMIN_PAGES[path] !== undefined) {
      if (!(await isAdmin(request, env))) {
        const dest = new URL('/admin', url);
        dest.searchParams.set('next', path);
        return Response.redirect(dest.toString(), 302);
      }
      return page(request, env, lng, ADMIN_PAGES[path]);
    }

    // チュートリアルはステージごとに1ページある
    if (path === '/tutorial') {
      const stage = url.searchParams.get('stage');
      if (stage && tutorialData.tutorial[stage]) {
        return page(request, env, lng, 'tutorial/' + stage);
      }
      return page(request, env, lng, 'menu-tutorial');
    }

    // 動画の再生画面
    if (/^\/movies\/[^/]+$/.test(path)) return page(request, env, lng, 'movie-player');

    /* --- 静的ファイル --- */
    if (env.ASSETS) return env.ASSETS.fetch(request);

    return new Response('Not Found', { status: 404 });
  },
};
