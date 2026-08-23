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
export { TournamentStore } from './tournament_do.js';
export { MovieStore } from './movies_do.js';

import { statusPage } from './status_page.js';
import maps from './data/maps.json' with { type: 'json' };
import tutorialData from './data/tutorial.json' with { type: 'json' };
import { isAllowedFile, mimeTypeFor, sanitizeFileName, sanitizeId } from './movies_do.js';

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

/**
 * 試合動画。
 *
 * 動画そのものは R2、目録は Durable Object という分担にしている。
 * R2 が有効になっていない間は一覧が空になるだけで、画面は壊れない。
 */
async function handleMovies(request, env, path, url) {
  const store = env.MOVIES_META.get(env.MOVIES_META.idFromName('main'));

  /* 動画ファイルの配信 */
  const file = /^\/movies\/file\/(.+)$/.exec(path);
  if (file) {
    if (!env.MOVIES) return new Response('動画の保存先が未設定です', { status: 503 });

    const meta = await store.fetch('https://do/movies/item/' + encodeURIComponent(file[1]));
    if (!meta.ok) return new Response('Not Found', { status: 404 });

    const movie = await meta.json();
    const object = await env.MOVIES.get(movie.objectKey, {
      range: request.headers,
      onlyIf: request.headers,
    });
    if (!object) return new Response('Not Found', { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Type', mimeTypeFor(movie.objectKey));
    headers.set('Accept-Ranges', 'bytes');
    headers.set('etag', object.httpEtag);

    if (object.range && object.size !== undefined) {
      const start = object.range.offset ?? 0;
      const end = start + (object.range.length ?? object.size) - 1;
      headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`);
      return new Response(object.body, { status: 206, headers });
    }
    return new Response(object.body, { headers });
  }

  /* アップロード。運営だけが使う */
  if (path === '/movies/upload' && request.method === 'POST') {
    if (!env.MOVIES) {
      return Response.json({ ok: false, error: 'R2 が有効になっていません' }, { status: 503 });
    }

    const form = await request.formData();
    const upload = form.get('movie');
    if (!upload || typeof upload === 'string') {
      return Response.json({ ok: false, error: 'ファイルが選ばれていません' }, { status: 400 });
    }

    const fileName = sanitizeFileName(upload.name);
    if (!isAllowedFile(fileName)) {
      return Response.json({ ok: false, error: 'mp4 / webm / m4v のいずれかを選んでください' }, { status: 400 });
    }

    const objectKey = Date.now() + '-' + fileName;
    await env.MOVIES.put(objectKey, upload.stream(), {
      httpMetadata: { contentType: mimeTypeFor(fileName) },
    });

    const id = sanitizeId(String(form.get('id') || fileName.replace(/\.[^.]+$/, '')));
    await store.fetch('https://do/movies/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        objectKey,
        title: form.get('title') || fileName,
        description: form.get('description') || '',
        date: form.get('date') || '',
        order: form.get('order'),
      }),
    });

    return Response.json({ ok: true, id });
  }

  /* 目録の読み書き */
  if (path === '/movies/list' || path === '/movies/admin-list'
      || (request.method === 'POST' && /^\/movies\/(register|update|hide|show)$/.test(path))) {
    if (!env.MOVIES && path === '/movies/list') {
      return Response.json({ movies: [], available: false });
    }
    return store.fetch(request);
  }

  /* 画面 */
  const lng = pickLang(request);
  if (path === '/movies') return page(request, env, lng, 'movies');
  if (path === '/movies/admin') return page(request, env, lng, 'movies-admin');

  const player = /^\/movies\/([^/]+)$/.exec(path);
  if (player) return page(request, env, lng, 'movie-player');

  return null;
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

    /* --- 対戦表 --- */
    if (path.startsWith('/tournament')) {
      const store = env.TOURNAMENT.get(env.TOURNAMENT.idFromName('main'));

      // データのやりとりは Durable Object へ渡す
      if (path === '/tournament/data' || path === '/tournament/admin-data'
          || (request.method === 'POST' && path.startsWith('/tournament/'))) {
        return store.fetch(request);
      }

      // 画面
      const lngT = pickLang(request);
      if (path === '/tournament') return page(request, env, lngT, 'tournament');
      if (path === '/tournament/admin') return page(request, env, lngT, 'tournament-admin');
    }

    /* --- 試合動画 --- */
    if (path.startsWith('/movies')) {
      const res = await handleMovies(request, env, path, url);
      if (res) return res;
    }

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
