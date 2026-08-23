/**
 * 対戦ルーム1つ = Durable Object 1つ。
 *
 * Node 版が server_store[room_id] に持っていた状態を、このオブジェクトが持つ。
 * ルームIDでインスタンスが分かれるので、他の試合と混ざらない。
 *
 * 接続の種類(役割)は WebSocket の attachment に持たせる。
 *   player : プログラムを動かしている側。cool か hot を担当する
 *   host   : 対戦画面(/match)。試合を用意して開始の合図を出す
 *   looker : 観戦。盤面を受け取るだけ
 *
 * 試合の始まり方は2通りある。
 *   1. プログラミング画面から player_join で入る(本家と同じ)。
 *      CPU ルームなら即開始、対人ルームなら2人揃ったら開始
 *   2. 対戦画面が match_init で用意し、player_join_match で両側が入ったら
 *      match_start で開始する。ボット対戦・ゴースト対戦もこの形
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

const WAITING = '接続待機中';

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

  #delete(key) {
    this.sql.exec('DELETE FROM room_state WHERE key = ?', key);
  }

  #loadMatch() {
    return this.#read('match', null);
  }

  #saveMatch(match) {
    this.#write('match', match);
  }

  /**
   * ルームの進行状態。試合そのもの(match)とは別に持つ。
   *   mode     'solo' = player_join で入る形 / 'match' = 対戦画面が仕切る形
   *   hostKey  対戦画面に渡した鍵。player_join_match と match_start で照合する
   *   slots    cool / hot それぞれ { status, name, cpu? }
   *   release  対戦画面が「開放」した側。プログラミング画面から入れる
   *   started  開始の合図が出たか
   *   options  { bot: {level} } / { ghost: {id, name, level} }
   */
  #loadRoom() {
    return this.#read('room', null);
  }

  #saveRoom(room) {
    this.#write('room', room);
  }

  #freshRoom(mode) {
    return {
      mode,
      hostKey: null,
      slots: { cool: { status: false, name: WAITING }, hot: { status: false, name: WAITING } },
      release: { cool: false, hot: false },
      started: false,
      options: {},
    };
  }

  /** 試合とルームを消して、次の試合を受け付けられるようにする */
  async #reset() {
    await this.timers.cancel(TIMER_TURN);
    await this.timers.cancel(TIMER_CPU);
    await this.timers.cancel(TIMER_START);
    this.#delete('match');
    this.#delete('room');
  }

  /* ---------------------------------------------- 接続の役割 */

  #attach(ws, data) {
    ws.serializeAttachment(data);
  }

  #role(ws) {
    try {
      return ws.deserializeAttachment() || {};
    } catch (e) {
      return {};
    }
  }

  /** 指定した側を担当している接続 */
  #playerSocket(chara) {
    return this.ctx.getWebSockets().find((ws) => {
      const r = this.#role(ws);
      return r.role === 'player' && r.chara === chara;
    }) || null;
  }

  #hostSocket() {
    return this.ctx.getWebSockets().find((ws) => this.#role(ws).role === 'host') || null;
  }

  /**
   * 担当者がいなくなった枠を空ける。
   * 切断の通知が来ないまま眠った場合に、枠が埋まったままになるのを防ぐ
   */
  #dropOrphanSlots(room) {
    for (const chara of ['cool', 'hot']) {
      const slot = room.slots[chara];
      if (!slot.status || slot.cpu) continue;
      if (!this.#playerSocket(chara)) {
        slot.status = false;
        slot.name = WAITING;
      }
    }
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
      this.#attach(server, { role: 'none' });
      if (roomId) this.#write('room_id', roomId);

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname.endsWith('/state')) {
      const match = this.#loadMatch();
      const room = this.#loadRoom();
      return Response.json({
        roomId: this.#read('room_id', null),
        mode: room ? room.mode : null,
        slots: room ? room.slots : null,
        started: Boolean(room && room.started),
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
        case 'player_join_match': return await this.#onJoinMatch(ws, data || {});
        case 'looker_join': return await this.#onLookerJoin(ws, data);
        case 'match_init': return await this.#onMatchInit(ws, data || {});
        case 'match_start_check': return this.#onMatchStartCheck(ws);
        case 'match_start': return await this.#onMatchStart(ws, data || {});
        case 'release': return this.#onRelease(ws, data || {});
        case 'match_end': return this.#onMatchEnd(ws);
        case 'get_ready': return await this.#onGetReady(ws);
        case 'move_player':
        case 'look':
        case 'search':
        case 'put_wall': return await this.#onAction(ws, event, data);
        case 'leave_room': return await this.#onLeave(ws);
        default:
          return this.#emit(ws, 'error', '不明な要求です: ' + event);
      }
    } catch (e) {
      // ここで投げると接続が切れる。試合を続けられるよう握って知らせる
      return this.#emit(ws, 'error', String(e && e.message));
    }
  }

  async webSocketClose(ws) {
    await this.#onLeave(ws);
  }

  async webSocketError(ws) {
    await this.#onLeave(ws);
  }

  /* ---------------------------------------------- マップ */

  #mapFor(roomId) {
    // 合言葉つきルーム (room_010?ab12cd) は、? の前のマップを使う。
    // 本家の copyMapByID と同じ扱い
    const baseId = String(roomId || '').split('?')[0];
    return maps[baseId] || null;
  }

  #prepared(mapDef) {
    // 盤面が空のルームはここで生成し、座標が未定のルームはここで配置する
    return prepareMap(JSON.parse(JSON.stringify(mapDef)));
  }

  /* ---------------------------------------------- 参加 (プログラミング画面) */

  async #onJoin(ws, msg) {
    const roomId = String(msg.room_id || this.#read('room_id', '') || '');
    const mapDef = this.#mapFor(roomId);
    if (!mapDef) return this.#emit(ws, 'error', 'サーバーIDが存在しません');

    this.#write('room_id', roomId);
    const name = String(msg.name || 'player');

    let room = this.#loadRoom();
    let match = this.#loadMatch();

    // 前の試合が終わっていれば片付ける
    if (match && match.finished) {
      await this.#reset();
      room = null;
      match = null;
    }
    if (room) this.#dropOrphanSlots(room);

    /* 対戦画面が仕切っているルーム: 開放された枠にだけ入れる */
    if (room && room.mode === 'match') {
      let chara = null;
      for (const c of ['cool', 'hot']) {
        if (room.release[c] && !room.slots[c].status) { chara = c; break; }
      }
      if (!chara || !match) return this.#emit(ws, 'error', '接続先サーバーは使用中です');

      room.slots[chara] = { status: true, name };
      match.state[chara].name = name;
      this.#attach(ws, { role: 'player', chara });
      this.#saveRoom(room);
      this.#saveMatch(match);
      return this.#broadcastJoined(room, match, mapDef);
    }

    /* 本家と同じ入り方 */
    if (!room) room = this.#freshRoom('solo');

    if (room.started && room.slots.cool.status && room.slots.hot.status) {
      return this.#emit(ws, 'error', '接続先サーバーは満室です');
    }

    let chara;
    if (mapDef.cpu) {
      // CPU ルーム。人間は CPU の反対側に入り、すぐ始まる
      match = createMatch(this.#prepared(mapDef), { playerName: name });
      chara = match.playerSide;
      room.slots[chara] = { status: true, name };
      room.slots[match.cpu.side] = { status: true, name: match.state[match.cpu.side].name, cpu: true };
    } else {
      if (!match) match = createMatch(this.#prepared(mapDef), { playerName: WAITING, playerSide: 'cool' });

      if (!room.slots.cool.status) chara = 'cool';
      else if (!room.slots.hot.status) chara = 'hot';
      else return this.#emit(ws, 'error', '接続先サーバーは満室です');

      room.slots[chara] = { status: true, name };
      match.state[chara].name = name;
    }

    this.#attach(ws, { role: 'player', chara });
    this.#saveRoom(room);
    this.#saveMatch(match);
    this.#broadcastJoined(room, match, mapDef);

    // 両側が揃ったら、本家と同じく少し置いてから盤面を配って開始する
    if (room.slots.cool.status && room.slots.hot.status) {
      room.started = true;
      this.#saveRoom(room);
      await this.timers.schedule(TIMER_START, START_DELAY_MS);
    }
  }

  #broadcastJoined(room, match, mapDef) {
    const payload = {
      x_size: match.state.sizeX,
      y_size: match.state.sizeY,
      cool_name: room.slots.cool.status ? room.slots.cool.name : WAITING,
      hot_name: room.slots.hot.status ? room.slots.hot.name : WAITING,
      room_name: mapDef ? mapDef.name : '',
    };
    for (const ws of this.ctx.getWebSockets()) {
      const r = this.#role(ws);
      if (r.role === 'none') continue;
      // 本家には無いが、どちら側を担当するか分からないと困るので足している
      this.#emit(ws, 'joined_room', r.role === 'player' ? { ...payload, your_chara: r.chara } : payload);
    }
  }

  /* ---------------------------------------------- 対戦画面 */

  /**
   * 対戦画面が試合を用意する。
   *   bot    { level }   ボット対戦。hot がボット
   *   ghost  { id }      ゴースト対戦。記録した側(cool)がゴースト
   *   record false       ボット対戦でも記録を残さない
   */
  async #onMatchInit(ws, msg) {
    const roomId = String(msg.room_id || this.#read('room_id', '') || '');
    const mapDef = this.#mapFor(roomId);
    if (!mapDef) return this.#emit(ws, 'error', 'サーバーIDが存在しません');
    this.#write('room_id', roomId);

    let room = this.#loadRoom();
    const match = this.#loadMatch();

    if (room) this.#dropOrphanSlots(room);
    if (match && match.finished) {
      room = null;
    } else if (room && room.started && (room.slots.cool.status || room.slots.hot.status)) {
      return this.#emit(ws, 'match_init_rec', { error: '接続先サーバーは使用中です' });
    } else if (room && room.mode === 'match' && this.#hostSocket() && this.#hostSocket() !== ws) {
      return this.#emit(ws, 'match_init_rec', { error: '他の画面がこのルームで対戦中です' });
    }

    await this.#reset();
    room = this.#freshRoom('match');
    room.hostKey = crypto.randomUUID();

    const opts = {};
    if (msg.ghost && msg.ghost.id) {
      const ghost = await this.#fetchGhost(String(msg.ghost.id));
      if (!ghost) return this.#emit(ws, 'match_init_rec', { error: 'ゴーストが見つかりません' });
      opts.ghost = { actions: ghost.actions, level: ghost.level, name: ghost.name, side: ghost.side || 'cool' };
      room.options.ghost = { id: ghost.id, name: ghost.name, level: ghost.level };
    } else if (msg.bot && msg.bot.level !== undefined) {
      opts.bot = { level: msg.bot.level, side: 'hot' };
      opts.record = msg.record !== false;
      room.options.bot = { level: Number(msg.bot.level) };
    }

    const fresh = createMatch(this.#prepared(mapDef), { playerName: WAITING, ...opts });
    if (fresh.cpu) {
      room.slots[fresh.cpu.side] = { status: true, name: fresh.state[fresh.cpu.side].name, cpu: true };
    }

    this.#attach(ws, { role: 'host', key: room.hostKey });
    this.#saveRoom(room);
    this.#saveMatch(fresh);

    this.#emit(ws, 'match_init_rec', {
      key: room.hostKey,
      cool_cpu: Boolean(fresh.cpu && fresh.cpu.side === 'cool'),
      hot_cpu: Boolean(fresh.cpu && fresh.cpu.side === 'hot'),
    });
    this.#broadcastJoined(room, fresh, mapDef);
  }

  async #fetchGhost(id) {
    if (!this.env.RECORDS) return null;
    const store = this.env.RECORDS.get(this.env.RECORDS.idFromName('main'));
    const res = await store.fetch('https://do/records/ghost?id=' + encodeURIComponent(id));
    if (!res.ok) return null;
    const json = await res.json();
    return json && json.ghost ? json.ghost : null;
  }

  async #onJoinMatch(ws, msg) {
    const room = this.#loadRoom();
    const match = this.#loadMatch();
    if (!room || room.mode !== 'match' || !match) return this.#emit(ws, 'error', '不正な操作です');
    if (String(msg.key || '') !== room.hostKey) return this.#emit(ws, 'error', '不正な操作です');

    const chara = msg.chara === 'hot' ? 'hot' : msg.chara === 'cool' ? 'cool' : null;
    if (!chara) return this.#emit(ws, 'error', '不正な操作です');

    this.#dropOrphanSlots(room);
    if (room.slots[chara].status) return this.#emit(ws, 'error', '接続先サーバーは使用中です');

    const name = String(msg.name || 'player');
    room.slots[chara] = { status: true, name };
    match.state[chara].name = name;
    this.#attach(ws, { role: 'player', chara });
    this.#saveRoom(room);
    this.#saveMatch(match);
    this.#broadcastJoined(room, match, this.#mapFor(this.#read('room_id', '')));
  }

  async #onLookerJoin(ws, data) {
    const roomId = String((data && data.room_id) || data || this.#read('room_id', '') || '');
    const mapDef = this.#mapFor(roomId);
    if (!mapDef) return this.#emit(ws, 'error', 'ルームが存在しません');
    this.#write('room_id', roomId);

    const current = this.#role(ws);
    if (current.role !== 'host') this.#attach(ws, { role: 'looker' });

    const room = this.#loadRoom();
    const match = this.#loadMatch();
    this.#emit(ws, 'joined_room', {
      x_size: match ? match.state.sizeX : mapDef.map_size_x,
      y_size: match ? match.state.sizeY : mapDef.map_size_y,
      cool_name: room && room.slots.cool.status ? room.slots.cool.name : WAITING,
      hot_name: room && room.slots.hot.status ? room.slots.hot.name : WAITING,
      room_name: mapDef.name,
    });

    // 進行中なら今の盤面をすぐ見せる
    if (match && room && room.started && !match.finished) this.#boardTo(ws, 'new_board', match);
  }

  #onMatchStartCheck(ws) {
    const room = this.#loadRoom();
    if (!room || room.mode !== 'match') return this.#emit(ws, 'match_start_check_rec', false);
    this.#dropOrphanSlots(room);
    this.#saveRoom(room);
    this.#emit(ws, 'match_start_check_rec', room.slots.cool.status && room.slots.hot.status);
  }

  async #onMatchStart(ws, msg) {
    const room = this.#loadRoom();
    const match = this.#loadMatch();
    if (!room || room.mode !== 'match' || !match) return this.#emit(ws, 'error', '不正な操作です');
    if (String(msg.key || '') !== room.hostKey) return this.#emit(ws, 'error', '不正な操作です');
    if (room.started) return;
    if (!(room.slots.cool.status && room.slots.hot.status)) return;

    room.started = true;
    this.#saveRoom(room);
    await this.timers.schedule(TIMER_START, START_DELAY_MS);
  }

  #onRelease(ws, msg) {
    const room = this.#loadRoom();
    if (!room || room.mode !== 'match') return this.#emit(ws, 'error', '不正な操作です');
    if (String(msg.key || '') !== room.hostKey) return this.#emit(ws, 'error', '不正な操作です');
    const chara = msg.chara === 'hot' ? 'hot' : msg.chara === 'cool' ? 'cool' : null;
    if (!chara) return;
    room.release[chara] = true;
    this.#saveRoom(room);
  }

  #onMatchEnd(ws) {
    // 対戦画面が結果を受け取った合図。次の match_init で片付けるので、ここでは役割だけ下ろす
    const r = this.#role(ws);
    if (r.role === 'host') this.#attach(ws, { role: 'looker' });
  }

  /* ---------------------------------------------- 試合の進行 */

  async #onGetReady(ws) {
    const r = this.#role(ws);
    if (r.role !== 'player') return this.#emit(ws, 'get_ready_rec', {});

    const match = this.#loadMatch();
    if (!match || match.finished) return this.#emit(ws, 'get_ready_rec', {});

    const cells = requestReady(match, r.chara);
    this.#saveMatch(match);

    // 自分の番でなければ本家と同じく中身のない応答を返す
    return this.#emit(ws, 'get_ready_rec', cells ? { rec_data: cells } : {});
  }

  async #onAction(ws, kind, direction) {
    const rec = REC_EVENT[kind];
    const r = this.#role(ws);
    if (r.role !== 'player') return this.#emit(ws, rec, {});

    const match = this.#loadMatch();
    if (!match || match.finished) return this.#emit(ws, rec, {});

    const outcome = applyAction(match, r.chara, kind, String(direction || 'right'));
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

  /**
   * 退室・切断。本家の leave_room / disconnect と同じ扱い。
   *   試合中の player が抜ける  → 相手の勝ち(切断より)
   *   開始前の player が抜ける  → 枠を空ける
   *   host が抜ける             → 試合を片付ける
   */
  async #onLeave(ws) {
    const r = this.#role(ws);
    this.#attach(ws, { role: 'none' });

    const room = this.#loadRoom();
    const match = this.#loadMatch();

    if (r.role === 'player' && room && match) {
      if (room.started && !match.finished && room.slots.cool.status && room.slots.hot.status) {
        const winner = r.chara === 'cool' ? 'hot' : 'cool';
        timeout(match, winner);
        match.result.info = '切断より';
        await this.#finish(match);
        return;
      }
      room.slots[r.chara] = { status: false, name: WAITING };
      match.state[r.chara].name = WAITING;
      this.#saveRoom(room);
      this.#saveMatch(match);
      if (room.mode === 'solo' && !room.slots.cool.status && !room.slots.hot.status) await this.#reset();
      return;
    }

    if (r.role === 'host' && room && room.mode === 'match') {
      if (!(match && match.finished)) {
        for (const other of this.ctx.getWebSockets()) {
          if (other !== ws && this.#role(other).role !== 'none') this.#emit(other, 'error', 'サーバー側から切断されました');
        }
      }
      await this.#reset();
    }
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

    const room = this.#loadRoom();
    const payload = {
      // 本家の綴りに合わせる (winer)。クライアントがこの名前で読んでいる
      winer: match.result.winner,
      info: match.result.info,
      cool_score: match.state.cool.score,
      hot_score: match.state.hot.score,
    };

    // ボット対戦は記録を残す。名前はあとから対戦画面がつける
    if (match.record && room && room.options.bot) {
      try {
        const saved = await this.#saveBotRecord(match, room);
        if (saved && saved.id) {
          payload.record_id = saved.id;
          payload.record_name = saved.name;
          payload.player_side = match.playerSide;
        }
      } catch (e) {
        // 記録できなくても試合の結果は伝える
      }
    }

    // 大会側へ結果を送る。ボット・ゴースト戦は大会と無関係なので送らない。
    // 失敗しても試合の進行には影響させない
    if (!(room && (room.options.bot || room.options.ghost))) {
      this.ctx.waitUntil(this.#reportResult(match).catch(() => {}));
    }

    this.#broadcastEvent('game_result', payload);
  }

  /* ---------------------------------------------- アラーム */

  async alarm() {
    for (const timer of await this.timers.due()) {
      const match = this.#loadMatch();
      if (!match || match.finished) continue;

      if (timer.name === TIMER_START) {
        startMatch(match);
        this.#saveMatch(match);
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

  /* ---------------------------------------------- 記録 */

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

  /** ボット対戦の記録を保存する。戻り値は { id, name } */
  async #saveBotRecord(match, room) {
    if (!this.env.RECORDS) return null;
    const humanSide = match.playerSide;
    const store = this.env.RECORDS.get(this.env.RECORDS.idFromName('main'));
    const res = await store.fetch('https://do/records/bot-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: String(this.#read('room_id', '')).split('?')[0],
        roomName: match.state.name || '',
        level: room.options.bot.level,
        side: humanSide,
        playerName: match.state[humanSide].name,
        winner: match.result.winner,
        info: match.result.info,
        coolScore: match.state.cool.score,
        hotScore: match.state.hot.score,
        turnsLeft: match.state.turn,
        actions: match.recording,
      }),
    });
    if (!res.ok) return null;
    return res.json();
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

  #boardPayload(match, effect) {
    const snap = boardSnapshot(match);
    const payload = {
      map_data: snap.map,
      cool_score: snap.coolScore,
      hot_score: snap.hotScore,
      turn: snap.turn,
    };
    if (effect) payload.effect = effect;
    return payload;
  }

  /** 盤面を配る。本家の new_board / updata_board と同じ形 */
  #board(event, match, effect = null) {
    this.#broadcastEvent(event, this.#boardPayload(match, effect));
  }

  #boardTo(ws, event, match) {
    this.#emit(ws, event, this.#boardPayload(match, null));
  }
}
