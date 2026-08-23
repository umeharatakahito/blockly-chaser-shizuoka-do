/**
 * 大会データ(対戦表と試合結果)を保持する Durable Object。
 *
 * 試合ルームと違い、大会ごとに1つだけあればよい。
 * Worker からは常に同じ名前で引くので、必ず同じインスタンスになる。
 *
 * Node 版は tournament.json と results.jsonl をファイルに書いていた。
 * ここでは SQLite に置く。無料プランで使えるのは SQLite 版の Durable Objects だけ。
 */

import { DurableObject } from 'cloudflare:workers';
import {
  emptyTournament, normalize, buildBracket, setResult, applyRecordedResult,
  addPlayer, removePlayer, findPlayer, champion, DEFAULT_TITLE,
} from './tournament/bracket.js';

/** 管理画面に出す試合結果の件数 */
const RECENT_LIMIT = 30;
/** ためておく試合結果の上限 */
const MAX_RESULTS = 200;

export class TournamentStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS store (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS results (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        recorded_at TEXT NOT NULL,
        payload     TEXT NOT NULL
      );
    `);
  }

  #load() {
    const row = this.sql.exec('SELECT value FROM store WHERE key = ?', 'tournament').toArray()[0];
    return row ? normalize(JSON.parse(row.value)) : emptyTournament();
  }

  #save(data) {
    const clean = normalize(data);
    this.sql.exec(
      'INSERT INTO store (key, value) VALUES (?, ?) '
      + 'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      'tournament', JSON.stringify(clean)
    );
    return clean;
  }

  #recent(limit = RECENT_LIMIT) {
    return this.sql
      .exec('SELECT id, payload FROM results ORDER BY id DESC LIMIT ?', limit)
      .toArray()
      .map((r) => ({ id: r.id, ...JSON.parse(r.payload) }));
  }

  /* -------------------------------------------------- 外向きのAPI */

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.replace(/^.*\/tournament\/?/, '') || 'data';

    if (request.method === 'GET') {
      if (action === 'data' || action === '') {
        const data = this.#load();
        return Response.json({ ...data, champion: champion(data) });
      }
      if (action === 'admin-data') {
        const data = this.#load();
        return Response.json({
          tournament: data,
          champion: champion(data),
          recent: this.#recent(),
        });
      }
      return new Response('Not Found', { status: 404 });
    }

    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const body = await request.json().catch(() => ({}));

    switch (action) {
      case 'record': {
        // 試合サーバーからの自動記録。失敗しても試合を止めない作りにする
        this.sql.exec(
          'INSERT INTO results (recorded_at, payload) VALUES (?, ?)',
          new Date().toISOString(), JSON.stringify(body)
        );
        this.sql.exec(
          'DELETE FROM results WHERE id <= (SELECT MAX(id) - ? FROM results)', MAX_RESULTS
        );
        return Response.json({ ok: true });
      }

      case 'title': {
        const data = this.#load();
        data.title = String(body.title || '').trim() || DEFAULT_TITLE;
        return Response.json({ ok: true, tournament: this.#save(data) });
      }

      case 'players/add': {
        const name = String(body.name || '').trim();
        if (!name) return Response.json({ ok: false, error: '名前を入力してください' }, { status: 400 });
        const data = this.#load();
        addPlayer(data, name, body.school);
        return Response.json({ ok: true, tournament: this.#save(data) });
      }

      case 'players/remove': {
        const data = this.#load();
        const player = findPlayer(data, String(body.id || ''));
        if (!player) return Response.json({ ok: false, error: 'その参加者は見つかりませんでした' }, { status: 404 });
        removePlayer(data, player.id);
        return Response.json({ ok: true, tournament: this.#save(data) });
      }

      case 'build': {
        const data = this.#load();
        if (data.players.length < 2) {
          return Response.json({ ok: false, error: '対戦表を作るには2人以上の参加者が必要です' }, { status: 400 });
        }
        return Response.json({ ok: true, tournament: this.#save(buildBracket(data)) });
      }

      case 'reset': {
        const data = this.#load();
        data.rounds = [];
        return Response.json({ ok: true, tournament: this.#save(data) });
      }

      // 練習や動作確認で溜まった試合結果を大会前に消す
      case 'results/clear': {
        this.sql.exec('DELETE FROM results');
        return Response.json({ ok: true });
      }

      case 'result': {
        const data = this.#load();
        const r = setResult(data, String(body.matchId || ''), body);
        if (!r.ok) return Response.json(r, { status: 400 });
        return Response.json({ ok: true, tournament: this.#save(data) });
      }

      case 'import': {
        const entry = this.#recent(MAX_RESULTS).find((e) => e.id === Number(body.resultId));
        if (!entry) return Response.json({ ok: false, error: 'その試合結果は見つかりませんでした' }, { status: 404 });

        const data = this.#load();
        const r = applyRecordedResult(data, String(body.matchId || ''), entry);
        if (!r.ok) return Response.json(r, { status: 400 });
        return Response.json({ ok: true, tournament: this.#save(data) });
      }

      default:
        return new Response('Not Found', { status: 404 });
    }
  }
}
