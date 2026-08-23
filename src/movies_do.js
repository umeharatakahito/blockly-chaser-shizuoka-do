/**
 * 試合動画の目録を持つ Durable Object。
 *
 * 動画そのものは預からない。YouTube などに置いてもらい、ここには URL だけを持つ。
 * Cloudflare 側に保存領域(R2)を用意する必要がなく、支払い方法の登録もいらない。
 *
 * Node 版はファイルと movies.json を突き合わせていたが、
 * Workers にファイルシステムが無いのでこの形にした。
 */

import { DurableObject } from 'cloudflare:workers';
import { parseMovieUrl } from './movies/url.js';

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
    this.#migrate();
  }

  /**
   * 表を今の形に合わせる。
   *
   * CREATE TABLE IF NOT EXISTS は既にある表を変えない。
   * 途中で列の構成を変えたとき、古いまま残っていると書き込みで落ちる。
   * 実際に、動画を R2 に置く案から URL を持つ案へ変えたときにこれで落ちた。
   */
  #migrate() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS movies (
        id          TEXT PRIMARY KEY,
        url         TEXT NOT NULL,
        title       TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        date        TEXT NOT NULL DEFAULT '',
        sort_order  INTEGER NOT NULL DEFAULT 999,
        hidden      INTEGER NOT NULL DEFAULT 0
      );
    `);

    const columns = this.sql.exec('PRAGMA table_info(movies)').toArray().map((c) => c.name);

    // url が無いのは、動画を R2 に置いていた頃の表。
    // その頃のデータは実運用で使っていないので作り直す
    if (!columns.includes('url')) {
      this.sql.exec('DROP TABLE movies');
      this.sql.exec(`
        CREATE TABLE movies (
          id          TEXT PRIMARY KEY,
          url         TEXT NOT NULL,
          title       TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          date        TEXT NOT NULL DEFAULT '',
          sort_order  INTEGER NOT NULL DEFAULT 999,
          hidden      INTEGER NOT NULL DEFAULT 0
        );
      `);
    }
  }

  /**
   * 一覧を作る。保存してある URL をその場で判定し、再生用の情報を添える。
   * 判定に失敗した(対応していないサービスに変わった等)ものは再生できない印を付ける。
   */
  #list(includeHidden = false) {
    const where = includeHidden ? '' : 'WHERE hidden = 0';
    return this.sql
      .exec(`SELECT * FROM movies ${where} ORDER BY sort_order, date DESC, title`)
      .toArray()
      .map((r) => {
        const parsed = parseMovieUrl(r.url);
        return {
          id: r.id,
          url: r.url,
          title: r.title,
          description: r.description,
          date: r.date,
          order: r.sort_order,
          hidden: r.hidden === 1,
          kind: parsed ? parsed.kind : null,
          embedSrc: parsed ? parsed.src : null,
        };
      });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.replace(/^.*\/movies\/?/, '') || 'list';

    if (request.method === 'GET') {
      if (action === 'list') return Response.json({ movies: this.#list() });
      if (action === 'admin-list') return Response.json({ movies: this.#list(true) });
      return new Response('Not Found', { status: 404 });
    }

    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const body = await request.json().catch(() => ({}));

    switch (action) {
      case 'save': {
        const parsed = parseMovieUrl(body.url);
        if (!parsed) {
          return Response.json({
            ok: false,
            error: 'この URL には対応していません。YouTube・Google ドライブ・Vimeo か、mp4 への直リンクを指定してください',
          }, { status: 400 });
        }

        const title = String(body.title || '').trim();
        if (!title) {
          return Response.json({ ok: false, error: 'タイトルを入力してください' }, { status: 400 });
        }

        const id = sanitizeId(body.id || title);
        this.sql.exec(
          'INSERT INTO movies (id, url, title, description, date, sort_order) '
          + 'VALUES (?, ?, ?, ?, ?, ?) '
          + 'ON CONFLICT(id) DO UPDATE SET url = excluded.url, title = excluded.title, '
          + 'description = excluded.description, date = excluded.date, '
          + 'sort_order = excluded.sort_order',
          id,
          String(body.url).trim(),
          title,
          String(body.description || '').trim(),
          String(body.date || '').trim(),
          Number.isFinite(Number(body.order)) ? Number(body.order) : 999
        );
        return Response.json({ ok: true, id });
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

      case 'remove': {
        this.sql.exec('DELETE FROM movies WHERE id = ?', sanitizeId(body.id));
        return Response.json({ ok: true });
      }

      default:
        return new Response('Not Found', { status: 404 });
    }
  }
}
