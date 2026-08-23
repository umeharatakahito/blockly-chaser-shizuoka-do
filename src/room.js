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
  playCpuTurn, boardSnapshot, isTurnOf, CPU_DELAY_MS,
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
      const roomId = url.searchParams.get('room') || this.#read('room_id', null);
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

  async webSocketMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return this.#send(ws, { type: 'error', error: 'JSON として読めません' });
    }

    try {
      switch (msg.type) {
        case 'join': return await this.#onJoin(ws, msg);
        case 'get_ready': return await this.#onGetReady(ws);
        case 'walk':
        case 'look':
        case 'search':
        case 'put': return await this.#onAction(ws, msg.type, msg.direction);
        default:
          return this.#send(ws, { type: 'error', error: '不明な要求です: ' + msg.type });
      }
    } catch (e) {
      // ここで投げると接続が切れる。試合を続けられるよう握って知らせる
      return this.#send(ws, { type: 'error', error: String(e && e.message) });
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
    const roomId = String(msg.roomId || this.#read('room_id', '') || '');
    const mapDef = maps[roomId];

    if (!mapDef) {
      return this.#send(ws, { type: 'error', error: 'ルームが見つかりません: ' + roomId });
    }

    this.#write('room_id', roomId);

    // 盤面が空のルームはここで生成し、座標が未定のルームはここで配置する
    const prepared = prepareMap(JSON.parse(JSON.stringify(mapDef)));
    const match = startMatch(createMatch(prepared, { playerName: String(msg.name || 'player') }));
    this.#saveMatch(match);

    this.#send(ws, {
      type: 'joined',
      roomId,
      roomName: mapDef.name,
      sizeX: match.state.sizeX,
      sizeY: match.state.sizeY,
      yourSide: match.playerSide,
      ...boardSnapshot(match),
    });

    // 本家と同じく、少し置いてから盤面を配って開始する
    await this.timers.schedule(TIMER_START, START_DELAY_MS);
  }

  async #onGetReady(ws) {
    const match = this.#loadMatch();
    if (!match) return this.#send(ws, { type: 'error', error: 'まだ参加していません' });
    if (match.finished) return this.#send(ws, { type: 'finished', ...match.result });

    const cells = requestReady(match, match.playerSide);
    this.#saveMatch(match);

    // 自分の番でなければ本家と同じく中身のない応答を返す
    return this.#send(ws, cells ? { type: 'ready', cells } : { type: 'ready' });
  }

  async #onAction(ws, kind, direction) {
    const match = this.#loadMatch();
    if (!match) return this.#send(ws, { type: 'error', error: 'まだ参加していません' });
    if (match.finished) return this.#send(ws, { type: 'finished', ...match.result });

    const outcome = applyAction(match, match.playerSide, kind, String(direction || 'right'));
    if (!outcome) {
      // 自分の番でない、または get_ready がまだ。本家は無応答なので中身なしを返す
      this.#saveMatch(match);
      return this.#send(ws, { type: 'acted' });
    }

    this.#saveMatch(match);
    this.#send(ws, { type: 'acted', cells: outcome.cells });
    this.#broadcast({ type: 'board', ...boardSnapshot(match) });

    if (outcome.result) return await this.#finish(match);

    await this.#afterTurn(match);
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

    this.#broadcast({
      type: 'game_result',
      winner: match.result.winner,
      info: match.result.info,
      ...boardSnapshot(match),
    });
  }

  /* ---------------------------------------------- アラーム */

  async alarm() {
    for (const timer of await this.timers.due()) {
      const match = this.#loadMatch();
      if (!match || match.finished) continue;

      if (timer.name === TIMER_START) {
        this.#broadcast({ type: 'board', ...boardSnapshot(match) });
        await this.#afterTurn(match);
        continue;
      }

      if (timer.name === TIMER_CPU) {
        const move = playCpuTurn(match);
        this.#saveMatch(match);

        if (!move) continue;
        this.#broadcast({ type: 'board', ...boardSnapshot(match) });

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

  /* ---------------------------------------------- 送信 */

  #send(ws, payload) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (e) {
      // 切れかけの接続。ここで投げると試合が止まる
    }
  }

  #broadcast(payload) {
    const text = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch (e) {
        // 同上
      }
    }
  }
}
