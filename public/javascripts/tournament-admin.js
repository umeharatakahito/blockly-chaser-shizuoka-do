/**
 * トーナメント管理画面。
 *
 * Node 版はフォームを POST してサーバー側で描画し直していたが、
 * Workers では描画できないので、fetch で操作して画面を組み直す。
 * できることは本家と同じ。自動記録された結果を対戦表へ自動反映しない点も変えていない。
 */
(function () {
  'use strict';

  var state = null;

  var $ = function (id) { return document.getElementById(id); };

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function notice(message, isError) {
    var box = $('notice');
    box.innerHTML = '';
    if (!message) return;
    box.appendChild(el('div', isError ? 'admin_error' : 'admin_ok', message));
  }

  function post(action, body) {
    return fetch('/tournament/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
      .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, json: j }; }); })
      .then(function (r) {
        if (!r.ok || r.json.ok === false) {
          notice(r.json.error || '操作できませんでした', true);
          return null;
        }
        return r.json;
      });
  }

  function playerOf(id) {
    if (!id || !state) return null;
    for (var i = 0; i < state.tournament.players.length; i++) {
      if (state.tournament.players[i].id === id) return state.tournament.players[i];
    }
    return null;
  }

  /* --- 参加者 --- */

  function drawPlayers() {
    var players = state.tournament.players;
    $('player_count').textContent = '(' + players.length + ')';

    var host = $('player_list');
    host.innerHTML = '';

    if (players.length === 0) {
      host.appendChild(el('p', 'admin_note', 'まだ参加者がいません。'));
      return;
    }

    var table = el('table', 'admin_table');
    var head = el('tr');
    ['順', '名前', '所属', ''].forEach(function (t) { head.appendChild(el('th', null, t)); });
    table.appendChild(head);

    players.forEach(function (p, i) {
      var tr = el('tr');
      tr.appendChild(el('td', null, String(i + 1)));
      tr.appendChild(el('td', null, p.name));
      tr.appendChild(el('td', null, p.school || ''));

      var td = el('td');
      var btn = el('button', 'admin_button_small admin_button_danger', '外す');
      btn.onclick = function () {
        if (!confirm(p.name + ' を名簿から外します。よろしいですか？')) return;
        post('players/remove', { id: p.id }).then(reload);
      };
      td.appendChild(btn);
      tr.appendChild(td);
      table.appendChild(tr);
    });

    host.appendChild(table);
  }

  /* --- 勝敗の入力 --- */

  function drawMatches() {
    var host = $('matches');
    host.innerHTML = '';

    var rounds = state.tournament.rounds;
    $('matches_card').style.display = rounds.length ? '' : 'none';

    rounds.forEach(function (round) {
      host.appendChild(el('h3', 'admin_round_name', round.name));

      round.matches.forEach(function (m) {
        var cool = playerOf(m.coolId);
        var hot = playerOf(m.hotId);
        var ready = cool && hot;

        var box = el('div', 'admin_match' + (ready ? '' : ' is_waiting'));
        var head = el('div', 'admin_match_head');
        head.appendChild(el('span', 'admin_match_players',
          (cool ? cool.name : '（勝者待ち）') + ' vs ' + (hot ? hot.name : '（勝者待ち）')));
        head.appendChild(el('span', 'admin_movie_badge', m.id));
        box.appendChild(head);

        if (!ready) {
          box.appendChild(el('p', 'admin_note', '前の回戦の勝者が決まると入力できます。'));
          host.appendChild(box);
          return;
        }

        var row = el('div', 'admin_field_row');

        var winnerField = el('div', 'admin_field');
        winnerField.appendChild(el('label', null, '勝者'));
        var select = el('select', 'admin_text');
        [['', '未定'], [cool.id, cool.name], [hot.id, hot.name]].forEach(function (opt) {
          var o = el('option', null, opt[1]);
          o.value = opt[0];
          if ((m.winnerId || '') === opt[0]) o.selected = true;
          select.appendChild(o);
        });
        winnerField.appendChild(select);
        row.appendChild(winnerField);

        var coolField = el('div', 'admin_field');
        coolField.appendChild(el('label', null, cool.name + ' のスコア'));
        var coolScore = el('input', 'admin_text');
        coolScore.type = 'number';
        coolScore.value = m.coolScore === null ? '' : m.coolScore;
        coolField.appendChild(coolScore);
        row.appendChild(coolField);

        var hotField = el('div', 'admin_field');
        hotField.appendChild(el('label', null, hot.name + ' のスコア'));
        var hotScore = el('input', 'admin_text');
        hotScore.type = 'number';
        hotScore.value = m.hotScore === null ? '' : m.hotScore;
        hotField.appendChild(hotScore);
        row.appendChild(hotField);

        box.appendChild(row);

        var noteField = el('div', 'admin_field');
        noteField.appendChild(el('label', null, '備考'));
        var note = el('input', 'admin_text');
        note.type = 'text';
        note.value = m.note || '';
        note.placeholder = 'アタックにより';
        noteField.appendChild(note);
        box.appendChild(noteField);

        var save = el('button', 'admin_button', '記録する');
        save.onclick = function () {
          post('result', {
            matchId: m.id,
            winnerId: select.value,
            coolScore: coolScore.value,
            hotScore: hotScore.value,
            note: note.value,
          }).then(function (r) { if (r) { notice('結果を記録しました'); reload(); } });
        };
        box.appendChild(save);

        host.appendChild(box);
      });
    });
  }

  /* --- 自動記録された結果 --- */

  function selectableMatches() {
    var list = [];
    state.tournament.rounds.forEach(function (round) {
      round.matches.forEach(function (m) {
        if (!m.coolId || !m.hotId) return;
        var cool = playerOf(m.coolId);
        var hot = playerOf(m.hotId);
        list.push({ id: m.id, label: round.name + ': ' + (cool ? cool.name : '?') + ' vs ' + (hot ? hot.name : '?') });
      });
    });
    return list;
  }

  var clearButton = $('clear_results');
  if (clearButton) {
    clearButton.onclick = function () {
      if (!confirm('記録した試合結果をすべて消します。対戦表には影響しません。よろしいですか?')) return;
      post('results/clear', {}).then(function (r) { if (r) { notice('試合結果を消しました'); reload(); } });
    };
  }

  function drawResults() {
    var host = $('results');
    host.innerHTML = '';
    $('result_count').textContent = '(' + state.recent.length + ')';

    if (state.recent.length === 0) {
      host.appendChild(el('p', 'admin_note', 'まだ試合が行われていません。'));
      return;
    }

    var options = selectableMatches();
    var table = el('table', 'admin_table');
    var head = el('tr');
    ['マップ', '対戦', '結果', '取り込み先'].forEach(function (t) { head.appendChild(el('th', null, t)); });
    table.appendChild(head);

    // 名前を直すときの候補。対戦表の選手名
    var names = document.getElementById('player_names');
    if (!names) {
      names = el('datalist');
      names.id = 'player_names';
      document.body.appendChild(names);
    }
    names.innerHTML = '';
    state.tournament.players.forEach(function (p) {
      var o = el('option');
      o.value = p.name;
      names.appendChild(o);
    });

    state.recent.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', null, r.roomName || r.roomId || ''));

      // 対戦: 名前と点数。プログラムの名前(NoName など)のままなら「名前を直す」で対戦表の選手名にそろえる
      var vs = el('td');
      var label = el('div', null,
        r.coolName + (r.coolScore === null ? '' : ' (' + r.coolScore + ')')
        + ' vs ' + r.hotName + (r.hotScore === null ? '' : ' (' + r.hotScore + ')'));
      vs.appendChild(label);
      if (r.originalCoolName || r.originalHotName) {
        vs.appendChild(el('div', 'admin_dim', '元の名前: ' + (r.originalCoolName || r.coolName) + ' vs ' + (r.originalHotName || r.hotName)));
      }
      var fix = el('button', 'admin_button_small', '名前を直す');
      fix.onclick = function () {
        fix.style.display = 'none';
        var form = el('div', 'admin_import_row');
        var coolIn = el('input', 'admin_text');
        coolIn.value = r.coolName; coolIn.setAttribute('list', 'player_names'); coolIn.title = 'cool(先攻)';
        var hotIn = el('input', 'admin_text');
        hotIn.value = r.hotName; hotIn.setAttribute('list', 'player_names'); hotIn.title = 'hot(後攻)';
        var save = el('button', 'admin_button_small', '保存');
        save.onclick = function () {
          post('results/rename', { resultId: r.id, coolName: coolIn.value, hotName: hotIn.value })
            .then(function (res) { if (res) { notice('名前を直しました'); reload(); } });
        };
        form.appendChild(el('span', 'admin_dim', 'cool'));
        form.appendChild(coolIn);
        form.appendChild(el('span', 'admin_dim', 'hot'));
        form.appendChild(hotIn);
        form.appendChild(save);
        vs.appendChild(form);
        coolIn.focus();
      };
      vs.appendChild(fix);
      tr.appendChild(vs);

      var outcome = r.winner === 'draw' ? '引き分け'
        : r.winner === 'cool' ? r.coolName + ' の勝ち'
          : r.winner === 'hot' ? r.hotName + ' の勝ち' : '―';
      tr.appendChild(el('td', null, outcome + (r.info ? ' (' + r.info + ')' : '')));

      var td = el('td');
      if (options.length === 0) {
        td.appendChild(el('span', 'admin_dim', '対戦表がありません'));
      } else {
        var wrap = el('div', 'admin_import_row');
        var select = el('select', 'admin_text');
        options.forEach(function (o) {
          var opt = el('option', null, o.label);
          opt.value = o.id;
          select.appendChild(opt);
        });
        var btn = el('button', 'admin_button_small', '取り込む');
        btn.onclick = function () {
          post('import', { resultId: r.id, matchId: select.value })
            .then(function (res) { if (res) { notice('結果を取り込みました'); reload(); } });
        };
        wrap.appendChild(select);
        wrap.appendChild(btn);
        td.appendChild(wrap);
      }
      tr.appendChild(td);
      table.appendChild(tr);
    });

    host.appendChild(table);
  }

  /* --- 全体 --- */

  function draw() {
    $('title_input').value = state.tournament.title || '';
    $('champion').innerHTML = '';
    if (state.champion) {
      $('champion').appendChild(el('p', 'admin_ok', '優勝: ' + state.champion.name));
    }
    drawPlayers();
    drawMatches();
    drawResults();
  }

  function reload() {
    return fetch('/tournament/admin-data', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) { state = data; draw(); });
  }

  $('title_save').onclick = function () {
    post('title', { title: $('title_input').value }).then(function (r) {
      if (r) { notice('大会名を変更しました'); reload(); }
    });
  };

  $('player_add').onclick = function () {
    var name = $('player_name').value;
    post('players/add', { name: name, school: $('player_school').value }).then(function (r) {
      if (r) {
        notice(name + ' を追加しました');
        $('player_name').value = '';
        $('player_school').value = '';
        reload();
      }
    });
  };

  $('build').onclick = function () {
    if (!confirm('対戦表を作成します。これまでの勝敗は消えます。よろしいですか？')) return;
    post('build').then(function (r) { if (r) { notice('対戦表を作りました'); reload(); } });
  };

  $('reset').onclick = function () {
    if (!confirm('対戦表を破棄します。よろしいですか？')) return;
    post('reset').then(function (r) { if (r) { notice('対戦表を破棄しました'); reload(); } });
  };

  reload();
})();
