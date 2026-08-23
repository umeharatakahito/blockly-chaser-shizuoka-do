/**
 * Socket.IO のクライアント API を、生の WebSocket の上に用意する。
 *
 * Node 版のクライアント (public/javascripts/encode.js など) は
 * socket.emit(...) / socket.on(...) を49箇所で使っている。
 * Socket.IO サーバーは Workers で動かないが、呼び出し側を書き換えると
 * 練習環境との差が大きくなるため、同じ形の窓口をこちらで用意する。
 *
 * やりとりする中身は { event, data } の JSON だけ。
 * Socket.IO の再接続や名前空間までは真似ていない。必要なのは
 * 「イベント名で送って、イベント名で受ける」ところだけなので、そこに絞ってある。
 *
 * 使い方は Socket.IO と同じ。
 *   var socket = io();
 *   socket.emit('player_join', { room_id: 'room_010', name: 'あおい' });
 *   socket.on('get_ready_rec', function (msg) { ... });
 *
 * 接続はどのルームかが分かってから張る。Durable Objects は URL でインスタンスが
 * 決まるため、ルームIDを知らないうちにつなぐと行き先を選べない。
 * player_join などルームIDを含む最初のイベントを送った時点で接続し、
 * それまでの送信は溜めておく。
 */

(function (global) {
  'use strict';

  function ChaserSocket(origin) {
    this._handlers = {};
    this._queue = [];
    this.connected = false;

    this._origin = origin;
    this._ws = null;
  }

  /** ルームが決まってから呼ぶ */
  ChaserSocket.prototype._open = function (roomId) {
    if (this._ws) return;

    var self = this;
    var ws = new WebSocket(this._origin + '/room/' + encodeURIComponent(roomId));
    this._ws = ws;

    ws.addEventListener('open', function () {
      self.connected = true;
      // つながる前に送ろうとしたぶんを流す
      var queued = self._queue;
      self._queue = [];
      for (var i = 0; i < queued.length; i++) ws.send(queued[i]);
      self._fire('connect');
    });

    ws.addEventListener('message', function (ev) {
      var frame;
      try {
        frame = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (frame && frame.event) self._fire(frame.event, frame.data);
    });

    ws.addEventListener('close', function () {
      self.connected = false;
      self._fire('disconnect');
    });

    ws.addEventListener('error', function (e) {
      self._fire('connect_error', e);
    });
  };

  ChaserSocket.prototype._fire = function (event, data) {
    var list = this._handlers[event];
    if (!list) return;
    // 実行中に off されても崩れないよう複製してから回す
    list.slice().forEach(function (fn) {
      try {
        fn(data);
      } catch (e) {
        console.error('handler error (' + event + '):', e);
      }
    });
  };

  ChaserSocket.prototype.on = function (event, handler) {
    (this._handlers[event] = this._handlers[event] || []).push(handler);
    return this;
  };

  ChaserSocket.prototype.off = function (event, handler) {
    if (!this._handlers[event]) return this;
    if (!handler) delete this._handlers[event];
    else this._handlers[event] = this._handlers[event].filter(function (f) { return f !== handler; });
    return this;
  };

  ChaserSocket.prototype.emit = function (event, data) {
    var text = JSON.stringify({ event: event, data: data === undefined ? null : data });

    // どのルームかは最初の参加イベントで初めて分かる。そこで接続を張る。
    //   player_join / player_join_match / match_init : { room_id }
    //   looker_join                                  : ルームIDの文字列
    var roomId = null;
    if (event === 'player_join' || event === 'player_join_match' || event === 'match_init') {
      if (data && data.room_id) roomId = String(data.room_id);
    } else if (event === 'looker_join') {
      roomId = typeof data === 'string' ? data : (data && data.room_id ? String(data.room_id) : null);
    }
    if (roomId && !this._ws) {
      this._queue.push(text);
      this._open(roomId);
      return this;
    }

    if (this.connected && this._ws && this._ws.readyState === WebSocket.OPEN) this._ws.send(text);
    else this._queue.push(text);
    return this;
  };

  ChaserSocket.prototype.close = function () {
    try {
      if (this._ws) this._ws.close();
    } catch (e) { /* 既に閉じている */ }
  };

  ChaserSocket.prototype.disconnect = ChaserSocket.prototype.close;

  /**
   * 接続元を決める。実際につなぐのは player_join のとき。
   * 引数を省略すると、このページを配っているホストにつなぐ。
   */
  function io(target) {
    var origin = target;

    if (!origin) {
      var proto = global.location.protocol === 'https:' ? 'wss:' : 'ws:';
      origin = proto + '//' + global.location.host;
    } else {
      origin = origin.replace(/^http/, 'ws').replace(/\/$/, '');
    }

    return new ChaserSocket(origin);
  }

  global.io = io;
  global.ChaserSocket = ChaserSocket;
})(typeof window !== 'undefined' ? window : globalThis);
