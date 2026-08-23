/**
 * 入口の Worker。
 *
 * ルームIDから Durable Object を1つ選び、そこへ丸ごと引き渡す。
 * 試合の状態は Worker 側には一切持たない。Worker はリクエストごとに使い捨てで、
 * 状態を持てないため。「どの試合か」を決めるだけの役割にとどめる。
 */

export { MatchRoom } from './room.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true });
    }

    // /room/<roomId>/... をそのルームの Durable Object へ渡す
    const match = /^\/room\/([A-Za-z0-9_-]+)(\/.*)?$/.exec(url.pathname);
    if (match) {
      const roomId = match[1];
      // 同じ roomId からは常に同じインスタンスが得られる。
      // これが「1ルーム = 1オブジェクト」を成り立たせている
      const id = env.ROOM.idFromName(roomId);
      return env.ROOM.get(id).fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
