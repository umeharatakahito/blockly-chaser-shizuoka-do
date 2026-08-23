/**
 * デプロイ先(またはローカル)で実際に CPU と1試合戦う。
 *
 *   node tool/play.mjs [URL] [ルームID]
 *
 * Node 版のクライアントと同じイベント名でやりとりする。
 * 決着まで進めば移植が成立している。
 */

const BASE = process.argv[2] ?? 'http://localhost:8787';
// 合言葉つき (room_110?abc) も受け付ける。URL には encodeURIComponent して載せる
const ROOM = decodeURIComponent(process.argv[3] ?? 'room_010');
const WALL = 2;
const DIR_INDEX = { top: 1, left: 3, right: 5, bottom: 7 };

const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/room/${encodeURIComponent(ROOM)}`);
let turns = 0;
let finished = false;
const t0 = Date.now();

const emit = (event, data = null) => ws.send(JSON.stringify({ event, data }));
const bail = (msg, code) => { if (msg) console.log(msg); ws.close(); process.exit(code); };

setTimeout(() => { if (!finished) bail(`✗ 90秒で決着しませんでした (${turns}手)`, 1); }, 90000);

ws.addEventListener('error', (e) => bail('✗ 接続できません: ' + (e.message ?? ''), 1));

ws.addEventListener('open', () => {
  console.log('  接続しました');
  emit('player_join', { room_id: ROOM, name: '移植テスト' });
});

ws.addEventListener('message', (ev) => {
  const { event, data } = JSON.parse(ev.data);

  if (event === 'error') bail('✗ ' + data, 1);

  if (event === 'joined_room') {
    console.log(`  ${data.room_name} に参加 (自分は ${data.your_chara} / ${data.x_size}x${data.y_size})`);
    setInterval(() => { if (!finished) emit('get_ready'); }, 60);
  }

  if (event === 'get_ready_rec' && Array.isArray(data?.rec_data)) {
    const cells = data.rec_data;
    const open = Object.keys(DIR_INDEX).filter((d) => cells[DIR_INDEX[d]] !== WALL);
    turns++;
    if (open.length) emit('move_player', open[turns % open.length]);
    else emit('search', 'top');
  }

  if (event === 'game_result') {
    finished = true;
    console.log(`  ✓ 決着 winer=${data.winer} (${data.info}) / ${turns}手 / ${((Date.now() - t0) / 1000).toFixed(1)}秒`);
    bail('', 0);
  }
});
