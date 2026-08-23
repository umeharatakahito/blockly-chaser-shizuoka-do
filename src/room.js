/**
 * 対戦ルーム1つ = Durable Object 1つ。
 *
 * Node 版が server_store[room_id] に持っていた状態を、このオブジェクトが持つ。
 * ルームIDでインスタンスが分かれるので、他の試合と混ざらない。
 *
 * 状態は毎回 SQLite に書き戻す。WebSocket hibernation で眠っている間に
 * メモリ上の値は失われるため、handler の入口で読み直し、出口で保存する。
 */

import { DurableObject } from 'cloudflare:workers';
import { TimerQueue } from './timers.js';
import maps from './data/maps.json' with { type: 'json' };
import { prepareMap } from './game/generate.js';
import {
  createMatch, startMatch, requestReady, applyAction, timeout,
  playCpuTurn, boardSnapshot, isTurnOf, CPU_DELAY_MS, REC_EVENT,
} from './game/match.js';

/** 試合が始まるまでの間。本家と同じ */
const START_DELAY_MS = 500;

const TIMER_TURN = 'turn_timeout';
const TIMER_CPU = 'cpu_move';
const TIMER_START = 'game_start';

export class MatchRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.timers = new TimerQueue(ctx);
    this.sql = ctx.storage.sql;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS room_state (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  /* ---------------------------------------------- 保存 */

  #read(key, fallback = null) {
    const row = this.sql.exec('SELECT value FROM room_state WHERE key = ?', key).toArray()[0];
    return row ? JSON.parse(row.value) : fallback;
  }

  #write(key, value) {
    this.sql.exec(
      'INSERT INTO room_state (key, value) VALUES (?, ?) '
      + 'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key, JSON.stringify(value)
    );
  }

  #loadMatch() {
    return this.#read('match', null);
  }

  #saveMatch(match) {
    this.#write('match', match);
  }

  /* ---------------------------------------------- HTTP */

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') {
      // パスからルームID(合言葉つきを含む)を取り出しておく
      const m = /\/room\/([^/?]+)/.exec(url.pathname);
      const roomId = (m ? decodeURIComponent(m[1]) : null)
        || url.searchParams.get('room')
        || this.#read('room_id', null);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.ctx.acceptWebSocket(server);
      if (roomId) this.#write('room_id', roomId);

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname.endsWith('/state')) {
      const match = this.#loadMatch();
      return Response.json({
        roomId: this.#read('room_id', null),
        started: Boolean(match),
        finished: match ? match.finished : false,
        result: match ? match.result : null,
        board: match ? boardSnapshot(match) : null,
        connections: this.ctx.getWebSockets().length,
        timers: this.timers.list(),
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  /* ---------------------------------------------- WebSocket */

  /**
   * 受け取るのは { event, data } の形。event 名は Node 版の Socket.IO と同じにしてある。
   * こうしておくと、クライアント側は薄い変換をかぶせるだけで済む。
   */
  async webSocketMessage(ws, raw) {
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch (e) {
      return this.#emit(ws, 'error', 'JSON として読めません');
    }

    const { event, data } = frame || {};

    try {
      switch (event) {
        case 'player_join': return await this.#onJoin(ws, data || {});
        case 'get_ready': return await this.#onGetReady(ws);
        case 'move_player':
        case 'look':
        case 'search':
        case 'put_wall': return await this.#onAction(ws, event, data);
        case 'leave_room': return await this.#onLeave();
        default:
          return this.#emit(ws, 'error', '不明な要求です: ' + event);
      }
    } catch (e) {
      // ここで投げると接続が切れる。試合を続けられるよう握って知らせる
      return this.#emit(ws, 'error', String(e && e.message));
    }
  }

  async webSocketClose() {
    if (this.ctx.getWebSockets().length === 0) {
      await this.timers.cancel(TIMER_TURN);
      await this.timers.cancel(TIMER_CPU);
      await this.timers.cancel(TIMER_START);
    }
  }

  /* ---------------------------------------------- 要求の処理 */

  async #onJoin(ws, msg) {
    const roomId = String(msg.room_id || this.#read('room_id', '') || '');
    // 合言葉つきルーム (room_010?ab12cd) は、? の前のマップを使う。
    // 本家の copyMapByID と同じ扱い
    const baseId = roomId.split('?')[0];
    const mapDef = maps[baseId];

    if (!mapDef) {
      return this.#emit(ws, 'error', 'サーバーIDが存在しません');
    }

    this.#write('room_id', roomId);

    // 盤面が空のルームはここで生成し、座標が未定のルームはここで配置する
    const prepared = prepareMap(JSON.parse(JSON.stringify(mapDef)));
    const match = startMatch(createMatch(prepared, { playerName: String(msg.name || 'player') }));
    this.#saveMatch(match);

    this.#emit(ws, 'joined_room', {
      x_size: match.state.sizeX,
      y_size: match.state.sizeY,
      cool_name: match.state.cool.name,
      hot_name: match.state.hot.name,
      // 本家には無いが、どちら側を担当するか分からないと困るので足している
      your_chara: match.playerSide,
      room_name: mapDef.name,
    });

    // 本家と同じく、少し置いてから盤面を配って開始する
    await this.timers.schedule(TIMER_START, START_DELAY_MS);
  }

  async #onGetReady(ws) {
    const match = this.#loadMatch();
    if (!match || match.finished) return this.#emit(ws, 'get_ready_rec', {});

    const cells = requestReady(match, match.playerSide);
    this.#saveMatch(match);

    // 自分の番でなければ本家と同じく中身のない応答を返す
    return this.#emit(ws, 'get_ready_rec', cells ? { rec_data: cells } : {});
  }

  async #onAction(ws, kind, direction) {
    const rec = REC_EVENT[kind];
    const match = this.#loadMatch();
    if (!match || match.finished) return this.#emit(ws, rec, {});

    const outcome = applyAction(match, match.playerSide, kind, String(direction || 'right'));
    if (!outcome) {
      // 自分の番でない、または get_ready がまだ。本家は無応答なので中身なしを返す
      this.#saveMatch(match);
      return this.#emit(ws, rec, {});
    }

    this.#saveMatch(match);
    this.#emit(ws, rec, { rec_data: outcome.cells });
    this.#board('updata_board', match, outcome.effect);

    if (outcome.result) return await this.#finish(match);
    await this.#afterTurn(match);
  }

  async #onLeave() {
    await this.timers.cancel(TIMER_TURN);
    await this.timers.cancel(TIMER_CPU);
    await this.timers.cancel(TIMER_START);
    this.sql.exec('DELETE FROM room_state WHERE key = ?', 'match');
  }

  /**
   * 手番が移ったあとの段取り。
   * CPU の番なら少し置いてから指させ、そうでなければ時間切れタイマーを張る。
   */
  async #afterTurn(match) {
    await this.timers.cancel(TIMER_TURN);
    await this.timers.cancel(TIMER_CPU);

    if (match.cpu && isTurnOf(match, match.cpu.side)) {
      await this.timers.schedule(TIMER_CPU, CPU_DELAY_MS);
      return;
    }

    // 動かなかった側の負け。勝つのは直前に動いた側
    const waiting = isTurnOf(match, 'cool') ? 'cool' : 'hot';
    const winner = waiting === 'cool' ? 'hot' : 'cool';
    await this.timers.schedule(TIMER_TURN, match.timeoutMs, { winner });
  }

  async #finish(match) {
    await this.timers.cancel(TIMER_TURN);
    await this.timers.cancel(TIMER_CPU);
    this.#saveMatch(match);

    // 大会側へ結果を送る。失敗しても試合の進行には影響させない
    this.ctx.waitUntil(this.#reportResult(match).catch(() => {}));

    // 本家の綴りに合わせる (winer)。クライアントがこの名前で読んでいる
    this.#broadcastEvent('game_result', {
      winer: match.result.winner,
      info: match.result.info,
    });
  }

  /* ---------------------------------------------- アラーム */

  async alarm() {
    for (const timer of await this.timers.due()) {
      const match = this.#loadMatch();
      if (!match || match.finished) continue;

      if (timer.name === TIMER_START) {
        this.#board('new_board', match);
        await this.#afterTurn(match);
        continue;
      }

      if (timer.name === TIMER_CPU) {
        const move = playCpuTurn(match);
        this.#saveMatch(match);

        if (!move) continue;
        this.#board('updata_board', match, move.effect);

        if (move.result) await this.#finish(match);
        else await this.#afterTurn(match);
        continue;
      }

      if (timer.name === TIMER_TURN) {
        timeout(match, timer.payload?.winner ?? 'draw');
        await this.#finish(match);
      }
    }
  }

  /**
   * 試合結果を大会データへ記録する。
   * トーナメント表には自動で反映しない。運営が取り込む候補になるだけ。
   */
  async #reportResult(match) {
    if (!this.env.TOURNAMENT) return;

    const store = this.env.TOURNAMENT.get(this.env.TOURNAMENT.idFromName('main'));
    await store.fetch('https://do/tournament/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: this.#read('room_id', ''),
        roomName: match.state.name || '',
        coolName: match.state.cool.name,
        hotName: match.state.hot.name,
        coolScore: match.state.cool.score,
        hotScore: match.state.hot.score,
        winner: match.result.winner,
        info: match.result.info,
      }),
    });
  }

  /* ---------------------------------------------- 送信 */

  /** 1つの接続へ送る */
  #emit(ws, event, data) {
    try {
      ws.send(JSON.stringify({ event, data }));
    } catch (e) {
      // 切れかけの接続。ここで投げると試合が止まる
    }
  }

  /** ルームの全接続へ送る */
  #broadcastEvent(event, data) {
    const text = JSON.stringify({ event, data });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch (e) {
        // 同上
      }
    }
  }

  /** 盤面を配る。本家の new_board / updata_board と同じ形 */
  #board(event, match, effect = null) {
    const snap = boardSnapshot(match);
    const payload = {
      map_data: snap.map,
      cool_score: snap.coolScore,
      hot_score: snap.hotScore,
      turn: snap.turn,
    };
    if (effect) payload.effect = effect;
    this.#broadcastEvent(event, payload);
  }
}
