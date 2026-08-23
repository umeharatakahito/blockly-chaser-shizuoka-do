/**
 * ボット対戦の記録・エントリー・アップロードを持つ Durable Object。
 *
 *   bot_records : ボット対戦の結果と、人間側の手の記録(ゴーストの元)
 *   entries     : 大会へのエントリー
 *   uploads     : 参加者が提出したプログラム(.blch)
 *
 * どれも量は知れているので1つのオブジェクトにまとめてある。
 * .blch は zip で数KB〜数十KB。SQLite の1行に収まる(上限は 1MB に絞る)。
 */

import { DurableObject } from 'cloudflare:workers';
import { checkName, autoName } from './names.js';

/** ゴーストとして残す記録の上限。古い・名前なしのものから消す */
const MAX_BOT_RECORDS = 500;
/** 提出ファイルの上限 */
export const MAX_UPLOAD_BYTES = 1024 * 1024;

const now = () => new Date().toISOString();

export class RecordStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS bot_records (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        named       INTEGER NOT NULL DEFAULT 0,
        room_id     TEXT NOT NULL,
        room_name   TEXT NOT NULL DEFAULT '',
        level       INTEGER NOT NULL,
        side        TEXT NOT NULL,
        winner      TEXT NOT NULL,
        info        TEXT NOT NULL DEFAULT '',
        cool_score  INTEGER NOT NULL DEFAULT 0,
        hot_score   INTEGER NOT NULL DEFAULT 0,
        turns_left  INTEGER NOT NULL DEFAULT 0,
        actions     TEXT NOT NULL DEFAULT '[]',
        hidden      INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entries (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        school      TEXT NOT NULL DEFAULT '',
        grade       TEXT NOT NULL DEFAULT '',
        note        TEXT NOT NULL DEFAULT '',
        hidden      INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS uploads (
        id          TEXT PRIMARY KEY,
        entry_name  TEXT NOT NULL,
        file_name   TEXT NOT NULL,
        size        INTEGER NOT NULL,
        content     BLOB NOT NULL,
        note        TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL
      );
    `);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === 'GET') return this.#get(path, url);
      if (request.method === 'POST') return await this.#post(path, request);
    } catch (e) {
      return Response.json({ ok: false, error: String(e && e.message) }, { status: 400 });
    }
    return new Response('Not Found', { status: 404 });
  }

  /* ---------------------------------------------- GET */

  #get(path, url) {
    switch (path) {
      /* --- ボット対戦 --- */
      case '/records/ghosts': {
        const room = url.searchParams.get('room');
        const all = url.searchParams.get('all') === '1';
        const rows = this.sql.exec(
          `SELECT id, name, named, room_id, room_name, level, side, winner, info, cool_score, hot_score, turns_left, created_at
             FROM bot_records WHERE hidden = 0 ${room ? 'AND room_id = ?' : ''}
             ORDER BY created_at DESC LIMIT 300`,
          ...(room ? [room] : [])
        ).toArray().map(this.#publicRecord);
        // 既定では「勝った記録」だけをゴーストとして出す
        return Response.json({ ghosts: all ? rows : rows.filter((r) => r.won) });
      }

      case '/records/ranking': {
        const rows = this.sql.exec(
          `SELECT id, name, named, room_id, room_name, level, side, winner, info, cool_score, hot_score, turns_left, created_at
             FROM bot_records WHERE hidden = 0 ORDER BY level DESC, created_at DESC LIMIT 500`
        ).toArray().map(this.#publicRecord).filter((r) => r.won);
        // 同じ名前は最高レベルだけ残す
        const best = new Map();
        for (const r of rows) {
          const prev = best.get(r.name);
          if (!prev || r.level > prev.level || (r.level === prev.level && r.scoreDiff > prev.scoreDiff)) best.set(r.name, r);
        }
        const ranking = [...best.values()].sort((a, b) => b.level - a.level || b.scoreDiff - a.scoreDiff || a.created_at.localeCompare(b.created_at));
        return Response.json({ ranking: ranking.slice(0, 100) });
      }

      case '/records/ghost': {
        const id = url.searchParams.get('id') || '';
        const row = this.sql.exec('SELECT * FROM bot_records WHERE id = ? AND hidden = 0', id).toArray()[0];
        if (!row) return Response.json({ ghost: null }, { status: 404 });
        return Response.json({
          ghost: {
            id: row.id,
            name: row.name,
            level: row.level,
            side: row.side,
            roomId: row.room_id,
            roomName: row.room_name,
            actions: JSON.parse(row.actions),
          },
        });
      }

      case '/records/admin-list': {
        const rows = this.sql.exec(
          `SELECT id, name, named, room_id, room_name, level, side, winner, info, cool_score, hot_score, turns_left, hidden, created_at,
                  length(actions) AS actions_bytes
             FROM bot_records ORDER BY created_at DESC LIMIT 1000`
        ).toArray();
        return Response.json({ records: rows });
      }

      /* --- エントリー --- */
      case '/entry/list': {
        const rows = this.sql.exec(
          'SELECT id, name, school, created_at FROM entries WHERE hidden = 0 ORDER BY created_at'
        ).toArray();
        return Response.json({ entries: rows });
      }

      case '/entry/admin-list': {
        const rows = this.sql.exec('SELECT * FROM entries ORDER BY created_at').toArray();
        return Response.json({ entries: rows });
      }

      /* --- アップロード --- */
      case '/upload/list': {
        const rows = this.sql.exec(
          'SELECT id, entry_name, file_name, size, created_at FROM uploads ORDER BY created_at DESC'
        ).toArray();
        return Response.json({ uploads: rows });
      }

      case '/upload/admin-list': {
        const rows = this.sql.exec(
          'SELECT id, entry_name, file_name, size, note, created_at FROM uploads ORDER BY entry_name, created_at DESC'
        ).toArray();
        return Response.json({ uploads: rows });
      }

      case '/upload/file': {
        const id = url.searchParams.get('id') || '';
        const row = this.sql.exec('SELECT file_name, content FROM uploads WHERE id = ?', id).toArray()[0];
        if (!row) return new Response('Not Found', { status: 404 });
        return new Response(row.content, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
          },
        });
      }

      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  #publicRecord = (r) => ({
    id: r.id,
    name: r.name,
    named: Boolean(r.named),
    roomId: r.room_id,
    roomName: r.room_name,
    level: r.level,
    side: r.side,
    winner: r.winner,
    info: r.info,
    coolScore: r.cool_score,
    hotScore: r.hot_score,
    turnsLeft: r.turns_left,
    won: r.winner === r.side,
    scoreDiff: r.side === 'cool' ? r.cool_score - r.hot_score : r.hot_score - r.cool_score,
    created_at: r.created_at,
  });

  /* ---------------------------------------------- POST */

  async #post(path, request) {
    // アップロードだけ multipart。それ以外は JSON
    if (path === '/upload/add') return this.#addUpload(request);

    const body = await request.json().catch(() => ({}));

    switch (path) {
      /* --- ボット対戦 --- */
      case '/records/bot-result': {
        const id = crypto.randomUUID();
        const level = Math.max(1, Math.min(30, Number(body.level) || 1));
        const actions = Array.isArray(body.actions) ? body.actions : [];
        const name = autoName();
        this.sql.exec(
          `INSERT INTO bot_records (id, name, named, room_id, room_name, level, side, winner, info, cool_score, hot_score, turns_left, actions, created_at)
           VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id, name, String(body.roomId || ''), String(body.roomName || ''), level,
          body.side === 'hot' ? 'hot' : 'cool', String(body.winner || 'draw'), String(body.info || ''),
          Number(body.coolScore) || 0, Number(body.hotScore) || 0, Number(body.turnsLeft) || 0,
          JSON.stringify(actions), now()
        );
        this.#prune();
        return Response.json({ id, name });
      }

      case '/records/name': {
        const id = String(body.id || '');
        const row = this.sql.exec('SELECT named FROM bot_records WHERE id = ?', id).toArray()[0];
        if (!row) return Response.json({ ok: false, error: '記録が見つかりません' }, { status: 404 });
        if (row.named) return Response.json({ ok: false, error: '名前はもうついています' }, { status: 409 });

        const name = String(body.name || '').trim();
        const verdict = checkName(name);
        if (!verdict.ok) return Response.json({ ok: false, error: verdict.reason }, { status: 400 });

        this.sql.exec('UPDATE bot_records SET name = ?, named = 1 WHERE id = ?', name, id);
        return Response.json({ ok: true, name });
      }

      case '/records/hide':
      case '/records/show': {
        this.sql.exec('UPDATE bot_records SET hidden = ? WHERE id = ?', path.endsWith('hide') ? 1 : 0, String(body.id || ''));
        return Response.json({ ok: true });
      }

      case '/records/remove': {
        this.sql.exec('DELETE FROM bot_records WHERE id = ?', String(body.id || ''));
        return Response.json({ ok: true });
      }

      /* --- エントリー --- */
      case '/entry/add': {
        const name = String(body.name || '').trim();
        const verdict = checkName(name);
        if (!verdict.ok) return Response.json({ ok: false, error: verdict.reason }, { status: 400 });

        const dup = this.sql.exec('SELECT id FROM entries WHERE name = ?', name).toArray()[0];
        if (dup) return Response.json({ ok: false, error: 'その名前はもうエントリーされています' }, { status: 409 });

        const id = crypto.randomUUID();
        this.sql.exec(
          'INSERT INTO entries (id, name, school, grade, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          id, name, clip(body.school, 50), clip(body.grade, 20), clip(body.note, 200), now()
        );
        return Response.json({ ok: true, id, name });
      }

      case '/entry/update': {
        const id = String(body.id || '');
        const name = String(body.name || '').trim();
        const verdict = checkName(name);
        if (!verdict.ok) return Response.json({ ok: false, error: verdict.reason }, { status: 400 });
        this.sql.exec(
          'UPDATE entries SET name = ?, school = ?, grade = ?, note = ? WHERE id = ?',
          name, clip(body.school, 50), clip(body.grade, 20), clip(body.note, 200), id
        );
        return Response.json({ ok: true });
      }

      case '/entry/hide':
      case '/entry/show': {
        this.sql.exec('UPDATE entries SET hidden = ? WHERE id = ?', path.endsWith('hide') ? 1 : 0, String(body.id || ''));
        return Response.json({ ok: true });
      }

      case '/entry/remove': {
        this.sql.exec('DELETE FROM entries WHERE id = ?', String(body.id || ''));
        return Response.json({ ok: true });
      }

      /* --- アップロード --- */
      case '/upload/remove': {
        this.sql.exec('DELETE FROM uploads WHERE id = ?', String(body.id || ''));
        return Response.json({ ok: true });
      }

      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  async #addUpload(request) {
    const form = await request.formData();
    const entryName = String(form.get('entry_name') || '').trim();
    const note = clip(form.get('note'), 200);
    const file = form.get('file');

    if (!entryName) return Response.json({ ok: false, error: '名前を入れてください' }, { status: 400 });
    if (!file || typeof file === 'string') return Response.json({ ok: false, error: 'ファイルを選んでください' }, { status: 400 });
    if (file.size > MAX_UPLOAD_BYTES) return Response.json({ ok: false, error: 'ファイルが大きすぎます (1MB まで)' }, { status: 400 });

    const fileName = String(file.name || 'program.blch');
    if (!/\.(blch|zip|json|xml)$/i.test(fileName)) {
      return Response.json({ ok: false, error: '.blch / .zip / .json / .xml のファイルだけ受け付けます' }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const content = new Uint8Array(await file.arrayBuffer());
    this.sql.exec(
      'INSERT INTO uploads (id, entry_name, file_name, size, content, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, entryName, fileName, content.byteLength, content, note, now()
    );
    return Response.json({ ok: true, id, fileName, size: content.byteLength });
  }

  /** 記録が増えすぎたら、名前のない古いものから消す */
  #prune() {
    const count = this.sql.exec('SELECT COUNT(*) AS n FROM bot_records').toArray()[0].n;
    if (count <= MAX_BOT_RECORDS) return;
    const over = count - MAX_BOT_RECORDS;
    this.sql.exec(
      `DELETE FROM bot_records WHERE id IN (
         SELECT id FROM bot_records ORDER BY named ASC, created_at ASC LIMIT ?
       )`,
      over
    );
  }
}

function clip(value, max) {
  return String(value || '').trim().slice(0, max);
}
