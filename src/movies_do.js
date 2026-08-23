/**
 * 試合動画のメタデータを持つ Durable Object。
 *
 * 動画そのものは R2 に置き、ここにはタイトルや並び順だけを持つ。
 * Node 版は load_data/movie_data/ のファイルと movies.json を突き合わせていたが、
 * Workers にファイルシステムが無いので、実体は R2、目録はここ、という分け方にした。
 *
 * R2 が使えない間もこのオブジェクトは動く。一覧が空になるだけで、画面は壊れない。
 */

import { DurableObject } from 'cloudflare:workers';

/** ブラウザの <video> がそのまま再生できる形式だけを扱う */
export const ALLOWED_EXT = ['.mp4', '.webm', '.m4v'];

const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm' };

export const extensionOf = (name) => {
  const m = /\.[A-Za-z0-9]+$/.exec(String(name || ''));
  return m ? m[0].toLowerCase() : '';
};

export const isAllowedFile = (name) => ALLOWED_EXT.includes(extensionOf(name));
export const mimeTypeFor = (name) => MIME[extensionOf(name)] || 'application/octet-stream';

/**
 * 名前を安全な形に直す。
 * Node 版 movies/store.js の sanitizeFileName と同じ考え方。
 */
export function sanitizeFileName(name) {
  const raw = String(name || '');
  // パス区切りを含む名前をそのまま使わせない
  const base = raw.split(/[\\/]/).pop().replace(/^\.+/, '');
  const ext = extensionOf(base);
  const stem = ext ? base.slice(0, -ext.length) : base;

  const safe = stem
    .replace(/[^\w\-ぁ-んァ-ヶー一-龠]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');

  return (safe || 'movie') + ext;
}

export function sanitizeId(id) {
  const safe = String(id || '')
    .replace(/[^\w\-ぁ-んァ-ヶー一-龠]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
  return safe || 'movie';
}

export class MovieStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS movies (
        id          TEXT PRIMARY KEY,
        object_key  TEXT NOT NULL,
        title       TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        date        TEXT NOT NULL DEFAULT '',
        sort_order  INTEGER NOT NULL DEFAULT 999,
        hidden      INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  #list(includeHidden = false) {
    const where = includeHidden ? '' : 'WHERE hidden = 0';
    return this.sql
      .exec(`SELECT * FROM movies ${where} ORDER BY sort_order, date DESC, title`)
      .toArray()
      .map((r) => ({
        id: r.id,
        objectKey: r.object_key,
        title: r.title,
        description: r.description,
        date: r.date,
        order: r.sort_order,
        hidden: r.hidden === 1,
      }));
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.replace(/^.*\/movies\/?/, '') || 'list';

    if (request.method === 'GET') {
      if (action === 'list') return Response.json({ movies: this.#list() });
      if (action === 'admin-list') return Response.json({ movies: this.#list(true) });

      const m = /^item\/(.+)$/.exec(action);
      if (m) {
        const row = this.#list(true).find((x) => x.id === decodeURIComponent(m[1]));
        return row ? Response.json(row) : new Response('Not Found', { status: 404 });
      }
      return new Response('Not Found', { status: 404 });
    }

    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const body = await request.json().catch(() => ({}));

    switch (action) {
      case 'register': {
        const id = sanitizeId(body.id);
        this.sql.exec(
          'INSERT INTO movies (id, object_key, title, description, date, sort_order) '
          + 'VALUES (?, ?, ?, ?, ?, ?) '
          + 'ON CONFLICT(id) DO UPDATE SET object_key = excluded.object_key, '
          + 'title = excluded.title, description = excluded.description, '
          + 'date = excluded.date, sort_order = excluded.sort_order, hidden = 0',
          id,
          String(body.objectKey || ''),
          String(body.title || '').trim() || id,
          String(body.description || '').trim(),
          String(body.date || '').trim(),
          Number.isFinite(Number(body.order)) ? Number(body.order) : 999
        );
        return Response.json({ ok: true, id });
      }

      case 'update': {
        this.sql.exec(
          'UPDATE movies SET title = ?, description = ?, date = ?, sort_order = ? WHERE id = ?',
          String(body.title || '').trim() || String(body.id),
          String(body.description || '').trim(),
          String(body.date || '').trim(),
          Number.isFinite(Number(body.order)) ? Number(body.order) : 999,
          sanitizeId(body.id)
        );
        return Response.json({ ok: true });
      }

      case 'hide': {
        // 消さずに隠す。誤操作から戻せるようにするため
        this.sql.exec('UPDATE movies SET hidden = 1 WHERE id = ?', sanitizeId(body.id));
        return Response.json({ ok: true });
      }

      case 'show': {
        this.sql.exec('UPDATE movies SET hidden = 0 WHERE id = ?', sanitizeId(body.id));
        return Response.json({ ok: true });
      }

      default:
        return new Response('Not Found', { status: 404 });
    }
  }
}
