/**
 * デプロイ先(またはローカル)で、対戦画面と同じ手順で一通り動かす。
 *
 *   node tool/smoke.mjs [URL]
 *
 * 確かめること:
 *   1. ボット対戦: match_init(bot) → player_join_match → match_start → 決着 → 記録が残る
 *   2. 名前の登録: 卑猥な名前ははじかれ、ふつうの名前は通る
 *   3. ゴースト対戦: 記録した試合をゴーストにして match_init(ghost) できる
 *   4. 対人対戦: 2人が player_join で入ると始まり、決着する
 *   5. 観戦: looker_join で盤面が届く
 *   6. 運営の鍵: 鍵なしでは運営のデータを読めない(鍵が設定されている環境のみ)
 */

const BASE = process.argv[2] ?? 'http://localhost:8787';
const WS = BASE.replace(/^http/, 'ws');
const WALL = 2;
const DIR_INDEX = { top: 1, left: 3, right: 5, bottom: 7 };

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = () => Math.random().toString(36).slice(2, 10);

/** { event, data } でやりとりする薄い接続 */
function connect(roomId) {
  const ws = new WebSocket(`${WS}/room/${encodeURIComponent(roomId)}`);
  const handlers = {};
  const waiting = {};
  ws.addEventListener('message', (ev) => {
    const { event, data } = JSON.parse(ev.data);
    (handlers[event] || []).forEach((fn) => fn(data));
    (waiting[event] || []).splice(0).forEach((r) => r(data));
  });
  return {
    ws,
    open: () => new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); }),
    emit: (event, data = null) => ws.send(JSON.stringify({ event, data })),
    on: (event, fn) => { (handlers[event] = handlers[event] || []).push(fn); },
    wait: (event, ms = 15000) => new Promise((r, j) => {
      const t = setTimeout(() => j(new Error(`${event} が ${ms}ms 以内に来ません`)), ms);
      (waiting[event] = waiting[event] || []).push((d) => { clearTimeout(t); r(d); });
    }),
    close: () => ws.close(),
  };
}

/** 壁でない向きへ順に動くだけの選手 */
function autoPlay(client) {
  let turns = 0;
  const tick = setInterval(() => client.emit('get_ready'), 60);
  client.on('get_ready_rec', (data) => {
    if (!Array.isArray(data?.rec_data)) return;
    const cells = data.rec_data;
    const open = Object.keys(DIR_INDEX).filter((d) => cells[DIR_INDEX[d]] !== WALL);
    turns++;
    if (open.length) client.emit('move_player', open[turns % open.length]);
    else client.emit('search', 'top');
  });
  client.on('game_result', () => clearInterval(tick));
  return () => clearInterval(tick);
}

/* ------------------------------------------------------------ 1. ボット対戦 */
console.log('1. ボット対戦');
let recordId = null;
let recordName = null;
{
  const room = 'room_110?smoke-' + token();
  const host = connect(room);
  await host.open();
  host.emit('looker_join', room);
  await host.wait('joined_room');
  host.emit('match_init', { room_id: room, bot: { level: 1 } });
  const init = await host.wait('match_init_rec');
  check('match_init が鍵を返す', Boolean(init.key), init.error || '');
  check('hot がボットになる', init.hot_cpu === true && init.cool_cpu === false);

  const player = connect(room);
  await player.open();
  player.emit('player_join_match', { room_id: room, key: init.key, chara: 'cool', name: 'スモーク' });
  const joined = await player.wait('joined_room');
  check('cool として参加できる', joined.your_chara === 'cool' && /ボット L1/.test(joined.hot_name), JSON.stringify(joined));

  host.emit('match_start_check');
  check('両側そろった', (await host.wait('match_start_check_rec')) === true);

  const stop = autoPlay(player);
  host.emit('match_start', { room_id: room, key: init.key });
  await host.wait('new_board');
  const result = await host.wait('game_result', 120000);
  stop();
  check('決着した', ['cool', 'hot', 'draw'].includes(result.winer), `${result.winer} (${result.info})`);
  check('記録IDが返る', typeof result.record_id === 'string', result.record_id);
  recordId = result.record_id;
  recordName = result.record_name;
  host.close();
  player.close();
}

/* ------------------------------------------------------------ 2. 名前 */
console.log('2. 名前の登録');
{
  const post = (name) => fetch(`${BASE}/records/name`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: recordId, name }),
  });
  const bad = await post('ちんこマン');
  check('卑猥な名前ははじく', bad.status === 400, String(bad.status));
  const good = await post('スモーク太郎');
  check('ふつうの名前は通る', good.ok, String(good.status));
  const again = await post('別の名前');
  check('二度目の名前変更はできない', again.status === 409, String(again.status));
  const list = await (await fetch(`${BASE}/records/ghosts?all=1`)).json();
  const mine = (list.ghosts || []).find((g) => g.id === recordId);
  check('一覧に載る', mine && mine.name === 'スモーク太郎', mine ? mine.name : '見つからない');
}

/* ------------------------------------------------------------ 3. ゴースト */
console.log('3. ゴースト対戦');
{
  const room = 'room_110?smoke-' + token();
  const host = connect(room);
  await host.open();
  host.emit('looker_join', room);
  await host.wait('joined_room');
  host.emit('match_init', { room_id: room, ghost: { id: recordId } });
  const init = await host.wait('match_init_rec');
  check('ゴーストが cool に入る', init.cool_cpu === true && init.hot_cpu === false, init.error || '');

  const player = connect(room);
  await player.open();
  player.emit('player_join_match', { room_id: room, key: init.key, chara: 'hot', name: '挑戦者' });
  const joined = await player.wait('joined_room');
  check('相手の名前がゴーストになる', /ゴースト: スモーク太郎/.test(joined.cool_name), joined.cool_name);
  const stop = autoPlay(player);
  host.emit('match_start', { room_id: room, key: init.key });
  const result = await host.wait('game_result', 120000);
  stop();
  check('ゴースト戦が決着する', Boolean(result.winer), `${result.winer} (${result.info})`);
  check('ゴースト戦は記録しない', result.record_id === undefined);
  host.close();
  player.close();
}

/* ------------------------------------------------------------ 4. 対人 + 5. 観戦 */
console.log('4. 対人対戦と観戦');
{
  const room = 'room_110?smoke-' + token();
  const a = connect(room);
  await a.open();
  a.emit('player_join', { room_id: room, name: '選手A' });
  const ja = await a.wait('joined_room');
  check('1人目は cool で待つ', ja.your_chara === 'cool' && ja.hot_name === '接続待機中', JSON.stringify(ja));

  let boardBeforeB = false;
  a.on('new_board', () => { boardBeforeB = true; });
  await sleep(1200);
  check('1人では始まらない', boardBeforeB === false);

  const b = connect(room);
  await b.open();
  b.emit('player_join', { room_id: room, name: '選手B' });
  const jb = await b.wait('joined_room');
  check('2人目は hot', jb.your_chara === 'hot' && jb.cool_name === '選手A', JSON.stringify(jb));

  const stopA = autoPlay(a);
  const stopB = autoPlay(b);
  await a.wait('new_board');

  const looker = connect(room);
  await looker.open();
  looker.emit('looker_join', room);
  const lj = await looker.wait('joined_room');
  check('観戦で両者の名前が見える', lj.cool_name === '選手A' && lj.hot_name === '選手B', JSON.stringify(lj));
  const board = await looker.wait('new_board');
  check('観戦に盤面が届く', Array.isArray(board.map_data));

  const result = await a.wait('game_result', 120000);
  stopA(); stopB();
  check('対人戦が決着する', Boolean(result.winer), `${result.winer} (${result.info})`);
  a.close(); b.close(); looker.close();
}

/* ------------------------------------------------------------ 6. 運営の鍵 */
console.log('6. 運営の鍵');
{
  const st = await (await fetch(`${BASE}/admin/status`)).json();
  const res = await fetch(`${BASE}/entry/admin-list`);
  if (st.keyConfigured) {
    check('鍵なしでは運営データを読めない', res.status === 403, String(res.status));
  } else {
    check('鍵が未設定 (localhost なら素通し)', st.localhost ? res.ok : res.status === 403, `localhost=${st.localhost} status=${res.status}`);
    if (!st.localhost) console.log('    ! 公開環境で ADMIN_KEY が未設定です。npx wrangler secret put ADMIN_KEY を実行してください');
  }
}

console.log(failed ? `\n✗ ${failed} 件失敗` : '\n✓ すべて通りました');
process.exit(failed ? 1 : 0);
