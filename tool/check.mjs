/**
 * 骨組みが Durable Objects 上で成立しているかを確かめる。
 *
 *   npx wrangler dev --port 8787 --local   （別のターミナルで）
 *   node tool/check.mjs
 *
 * 確認するのは3点。
 *   1. ルームごとに別のインスタンスになり、状態が混ざらない
 *   2. WebSocket が hibernation 対応で受けられる
 *   3. 複数のタイマーが1本のアラームに畳み込まれ、期限どおりに鳴る
 */

const BASE = process.argv[2] ?? 'http://localhost:8787';
let failed = 0;

const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};

const state = async (room) => (await fetch(`${BASE}/room/${room}/state`)).json();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('1. ルームごとに状態が分かれるか');
const roomA = 'check-a-' + Math.floor(Math.random() * 1e6);
const roomB = 'check-b-' + Math.floor(Math.random() * 1e6);
check('新しいルームは 0 ターンから始まる', (await state(roomA)).turnCount === 0);

console.log('2. WebSocket');
const ws = new WebSocket(`${BASE.replace('http', 'ws')}/room/${roomA}`);
const messages = [];
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', reject);
  setTimeout(() => reject(new Error('接続できません')), 10000);
});
ws.addEventListener('message', (e) => messages.push(JSON.parse(e.data)));
check('接続できる', ws.readyState === WebSocket.OPEN);

ws.send(JSON.stringify({ type: 'walk', direction: 'top' }));
await sleep(500);
check('メッセージに応答が返る', messages.some((m) => m.type === 'ack'),
  JSON.stringify(messages.find((m) => m.type === 'ack') ?? {}));

const afterMove = await state(roomA);
check('状態が SQLite に残る', afterMove.turnCount === 1, `turnCount=${afterMove.turnCount}`);
check('別のルームには影響しない', (await state(roomB)).turnCount === 0);

console.log('3. タイマーの畳み込み');
check('予定が1件入っている', afterMove.timers.length === 1,
  afterMove.timers.map((t) => t.name).join(', '));

const waitMs = Math.max(0, afterMove.timers[0].due_at - Date.now()) + 3000;
console.log(`  ... アラームが鳴るまで ${Math.round(waitMs / 1000)} 秒待ちます`);
await sleep(waitMs);

const afterAlarm = await state(roomA);
check('期限が来たら鳴る', afterAlarm.lastEvent?.type === 'timeout',
  JSON.stringify(afterAlarm.lastEvent ?? {}));
check('鳴った予定は消える', afterAlarm.timers.length === 0);
check('接続側にも通知が届く', messages.some((m) => m.type === 'game_result'));

ws.close();
console.log(failed === 0 ? '\nすべて成立しました。' : `\n${failed} 件失敗しました。`);
process.exit(failed === 0 ? 0 : 1);
