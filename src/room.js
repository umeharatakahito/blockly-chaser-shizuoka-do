/**
 * 対戦ルーム1つ = Durable Object 1つ。
 *
 * Node 版が server_store[room_id] に持っていた状態を、そのままこのオブジェクトが持つ。
 * 「どのルームか」でインスタンスが分かれるので、他の試合と混ざらない。
 *
 * 現時点では試合ロジックは入っていない。以下の3点が Durable Objects 上で
 * 成立することを確かめるための骨組みである。
 *
 *   1. WebSocket を hibernation 対応で受けられる
 *   2. 複数のタイマーを1本のアラームへ畳み込める（timers.js）
 *   3. 状態が SQLite に残り、オブジェクトが眠って起きても失われない
 */

import { DurableObject } from 'cloudflare:workers';
import { TimerQueue } from './timers.js';

// 相手が動かないまま放置された場合に試合を打ち切るまでの時間。
// Node 版の既定値(10秒)に合わせている
const TURN_TIMEOUT_MS = 10000;

export class MatchRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.timers = new TimerQueue(ctx);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS room_state (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  /* ---------------------------------------------- 状態 */

  #get(key, fallback = null) {
    const row = this.ctx.storage.sql
      .exec('SELECT value FROM room_state WHERE key = ?', key)
      .toArray()[0];
    return row ? JSON.parse(row.value) : fallback;
  }

  #set(key, value) {
    this.ctx.storage.sql.exec(
      'INSERT INTO room_state (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key, JSON.stringify(value)
    );
  }

  /* ---------------------------------------------- HTTP */

  async fetch(request) {
    const url = new URL(request.url);

    // WebSocket で参加する
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // acceptWebSocket を使うと、通信が無い間オブジェクトが眠れる。
      // 接続は保たれたまま課金対象から外れる
      this.ctx.acceptWebSocket(server);

      this.#set('turn_count', this.#get('turn_count', 0));
      await this.timers.schedule('turn_timeout', TURN_TIMEOUT_MS, { reason: 'タイムアウトより' });

      return new Response(null, { status: 101, webSocket: client });
    }

    // 状態を覗く。検証とデバッグのため
    if (url.pathname.endsWith('/state')) {
      return Response.json({
        turnCount: this.#get('turn_count', 0),
        lastEvent: this.#get('last_event', null),
        connections: this.ctx.getWebSockets().length,
        timers: this.timers.list(),
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  /* ---------------------------------------------- WebSocket */

  async webSocketMessage(ws, message) {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', error: 'JSON として読めません' }));
      return;
    }

    // 相手が動いたので時間切れタイマーを引き直す。
    // 同じ name で schedule すると上書きされる
    await this.timers.schedule('turn_timeout', TURN_TIMEOUT_MS, { reason: 'タイムアウトより' });

    const turnCount = this.#get('turn_count', 0) + 1;
    this.#set('turn_count', turnCount);
    this.#set('last_event', { type: msg.type ?? 'unknown', at: Date.now() });

    ws.send(JSON.stringify({ type: 'ack', received: msg.type ?? null, turnCount }));
  }

  async webSocketClose(ws, code, reason, wasClean) {
    // 接続が全部切れたら時間切れタイマーは不要
    if (this.ctx.getWebSockets().length === 0) {
      await this.timers.cancel('turn_timeout');
    }
  }

  /* ---------------------------------------------- アラーム */

  /**
   * Durable Objects のアラームは1オブジェクトに1つしかない。
   * ここでは期限の来た予定をまとめて処理し、残りは timers 側が再設定する。
   */
  async alarm() {
    for (const timer of await this.timers.due()) {
      if (timer.name === 'turn_timeout') {
        this.#set('last_event', { type: 'timeout', at: Date.now(), reason: timer.payload?.reason });
        this.#broadcast({ type: 'game_result', winner: null, info: timer.payload?.reason ?? null });
      }
    }
  }

  #broadcast(payload) {
    const text = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch (e) {
        // 切れかけの接続で例外が出ても、他への配信は続ける
      }
    }
  }
}
