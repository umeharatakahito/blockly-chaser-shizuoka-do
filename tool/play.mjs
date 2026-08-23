/**
 * デプロイ先(またはローカル)で実際に CPU と1試合戦う。
 *
 *   node tool/play.mjs [URL] [ルームID]
 *
 * 決着まで進めば移植が成立している。
 */

const BASE = process.argv[2] ?? 'http://localhost:8787';
const ROOM = process.argv[3] ?? 'room_010';
const WALL = 2;
const DIR_INDEX = { top: 1, left: 3, right: 5, bottom: 7 };

const ws = new WebSocket(`${BASE.replace('http', 'ws')}/room/${ROOM}`);
let turns = 0;
let finished = false;
const t0 = Date.now();

const send = (o) => ws.send(JSON.stringify(o));
const bail = (msg, code) => { console.log(msg); ws.close(); process.exit(code); };

setTimeout(() => { if (!finished) bail(`✗ 60秒で決着しませんでした (${turns}手)`, 1); }, 60000);

ws.addEventListener('error', (e) => bail('✗ 接続できません: ' + (e.message ?? ''), 1));

ws.addEventListener('open', () => {
  console.log('  接続しました');
  send({ type: 'join', roomId: ROOM, name: '移植テスト' });
});

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);

  if (msg.type === 'error') bail('✗ ' + msg.error, 1);

  if (msg.type === 'joined') {
    console.log(`  ${msg.roomName} に参加 (自分は ${msg.yourSide} / ${msg.sizeX}x${msg.sizeY})`);
    // 自分の番が来るまで get_ready を送り続ける
    setInterval(() => { if (!finished) send({ type: 'get_ready' }); }, 60);
  }

  if (msg.type === 'ready' && Array.isArray(msg.cells)) {
    const open = Object.keys(DIR_INDEX).filter((d) => msg.cells[DIR_INDEX[d]] !== WALL);
    turns++;
    if (open.length) send({ type: 'walk', direction: open[turns % open.length] });
    else send({ type: 'search', direction: 'top' });
  }

  if (msg.type === 'game_result') {
    finished = true;
    console.log(`  ✓ 決着 winner=${msg.winner} (${msg.info})`);
    console.log(`    スコア cool=${msg.coolScore} hot=${msg.hotScore} / 残りターン ${msg.turn}`);
    console.log(`    ${turns}手 / ${((Date.now() - t0) / 1000).toFixed(1)}秒`);
    bail('', 0);
  }
});
