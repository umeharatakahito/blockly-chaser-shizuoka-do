/**
 * デプロイ直後に開いたときの画面。
 *
 * 骨組みの段階では試合画面が無いので、代わりに「何が動いていて何が未実装か」を出す。
 * デプロイが成功したことをブラウザだけで確かめられるようにするのが目的。
 */

const DONE = [
  'ルームごとにインスタンスが分かれ、状態が混ざらない',
  'WebSocket を hibernation 対応で受けられる',
  '複数のタイマーが1本のアラームに畳み込まれ、期限どおりに鳴る',
  '状態が SQLite に残る',
];

const TODO = [
  '試合ロジック（盤面・移動・探索・設置・勝敗判定）',
  'CPU 対戦',
  'クライアント側の通信を Socket.IO から生の WebSocket へ',
  '画面（Node 版は EJS 4,237行）',
  '対戦表・試合動画',
];

const li = (items, mark) => items.map((t) => `<li><span class="m">${mark}</span>${t}</li>`).join('');

export function statusPage() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blockly CHaser (Durable Objects 版)</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: system-ui, -apple-system, "Hiragino Sans", sans-serif;
    max-width: 720px; margin: 0 auto; padding: 32px 20px 80px;
    line-height: 1.8; color: #333; background: #fff;
  }
  @media (prefers-color-scheme: dark) { body { color: #ddd; background: #1a1a1a; } }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .sub { color: #888; font-size: 14px; margin-top: 0; }
  .badge {
    display: inline-block; background: #00a0e6; color: #fff;
    border-radius: 999px; padding: 2px 12px; font-size: 13px; font-weight: bold;
  }
  h2 { font-size: 16px; margin-top: 32px; border-bottom: solid 2px #cfe8f7; padding-bottom: 6px; }
  ul { list-style: none; padding: 0; }
  li { padding: 4px 0; }
  .m { display: inline-block; width: 24px; font-weight: bold; }
  .done .m { color: #4CAF50; }
  .todo { color: #999; }
  code {
    background: rgba(128,128,128,0.15); padding: 2px 6px; border-radius: 4px;
    font-family: ui-monospace, Menlo, monospace; font-size: 13px;
  }
  .note { font-size: 14px; color: #888; margin-top: 32px; }
  a { color: #00a0e6; }
</style>
</head>
<body>
  <p><span class="badge">検証中</span></p>
  <h1>Blockly CHaser — Durable Objects 版</h1>
  <p class="sub">U-16プログラミングコンテスト静岡大会 / 第2案</p>

  <p>
    このページが見えていれば、Cloudflare へのデプロイは成功しています。
    大会本番で使うのは Node 版です。こちらは別案として検証を進めているものです。
  </p>

  <h2>動作を確認済み</h2>
  <ul class="done">${li(DONE, '✓')}</ul>

  <h2>未実装</h2>
  <ul class="todo">${li(TODO, '—')}</ul>

  <h2>確かめる</h2>
  <ul>
    <li><a href="/health">/health</a> — 稼働確認</li>
    <li><code>/room/&lt;ルームID&gt;/state</code> — ルームの状態</li>
    <li><code>/room/&lt;ルームID&gt;</code> — WebSocket で接続</li>
  </ul>

  <p class="note">
    コマンドから確認する場合は <code>node tool/check.mjs &lt;このURL&gt;</code> を実行してください。
    ルームの分離・WebSocket・タイマーの3点を検査します。
  </p>
</body>
</html>`;
}
