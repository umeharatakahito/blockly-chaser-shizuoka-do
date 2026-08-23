/**
 * 複数のタイマーを、Durable Objects の「1オブジェクトに1つ」のアラームへ畳み込む。
 *
 * Node 版の chaser/server.js は setTimeout を14箇所で使っている。
 *   - 相手が動かないまま一定時間が過ぎたら時間切れにする
 *   - CPU が少し間を置いてから指す
 * Durable Objects にはアラームが1つしかないため、そのままでは移せない。
 *
 * ここでは予定を SQLite に並べ、「最も早い予定」だけをアラームに設定する。
 * アラームが鳴ったら期限の来た予定をすべて実行し、残りの中の最も早いものを
 * 改めて設定し直す。これで任意の本数のタイマーを1本で賄える。
 *
 * 予定を SQLite に置くのは、オブジェクトが眠って起き直しても消えないようにするため。
 */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS timers (
    name    TEXT PRIMARY KEY,
    due_at  INTEGER NOT NULL,
    payload TEXT
  );
  CREATE INDEX IF NOT EXISTS timers_due_at ON timers (due_at);
`;

export class TimerQueue {
  /** @param {DurableObjectState} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.sql = ctx.storage.sql;
    this.sql.exec(SCHEMA);
  }

  /**
   * 予定を入れる。同じ name が既にあれば上書きする。
   * 上書きできることが重要で、「相手が動いたので時間切れタイマーを引き直す」
   * という操作が1行で書ける。
   */
  async schedule(name, delayMs, payload = null) {
    const dueAt = Date.now() + delayMs;
    this.sql.exec(
      'INSERT INTO timers (name, due_at, payload) VALUES (?, ?, ?) ' +
      'ON CONFLICT(name) DO UPDATE SET due_at = excluded.due_at, payload = excluded.payload',
      name, dueAt, payload === null ? null : JSON.stringify(payload)
    );
    await this.#syncAlarm();
  }

  /** 予定を取り消す。存在しなくてもエラーにしない */
  async cancel(name) {
    this.sql.exec('DELETE FROM timers WHERE name = ?', name);
    await this.#syncAlarm();
  }

  /** 入っている予定の一覧。デバッグと検査のため */
  list() {
    return this.sql.exec('SELECT name, due_at, payload FROM timers ORDER BY due_at').toArray();
  }

  /**
   * 期限の来た予定を取り出して削除する。アラームから呼ぶ。
   * @returns {Array<{name: string, payload: any}>}
   */
  async due(now = Date.now()) {
    const rows = this.sql
      .exec('SELECT name, payload FROM timers WHERE due_at <= ? ORDER BY due_at', now)
      .toArray();

    for (const row of rows) {
      this.sql.exec('DELETE FROM timers WHERE name = ?', row.name);
    }
    await this.#syncAlarm();

    return rows.map((r) => ({ name: r.name, payload: r.payload ? JSON.parse(r.payload) : null }));
  }

  /**
   * 残っている予定のうち最も早いものにアラームを合わせる。
   * 予定が無ければアラームを消す。
   */
  async #syncAlarm() {
    const next = this.sql.exec('SELECT MIN(due_at) AS at FROM timers').one().at;

    if (next === null || next === undefined) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    const current = await this.ctx.storage.getAlarm();
    if (current !== next) {
      await this.ctx.storage.setAlarm(next);
    }
  }
}
