/** エントリー一覧(運営) */
(function () {
  var notice = document.getElementById('notice');
  var entries = [];

  function say(kind, text) {
    notice.innerHTML = '';
    var p = document.createElement('p');
    p.className = kind === 'ok' ? 'admin_ok' : 'admin_error';
    p.textContent = text;
    notice.appendChild(p);
  }

  function post(path, body) {
    return fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json(); });
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  function button(label, cls, onclick) {
    var b = document.createElement('button');
    b.className = 'admin_small_button' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.onclick = onclick;
    return b;
  }

  function render() {
    var box = document.getElementById('entry_list');
    document.getElementById('entry_count').textContent = '(' + entries.length + '人)';
    if (!entries.length) { box.innerHTML = '<p class="admin_note">エントリーはまだありません。</p>'; return; }

    var table = document.createElement('table');
    table.className = 'admin_table';
    table.innerHTML = '<tr><th>#</th><th>選手名</th><th>学校・所属</th><th>学年</th><th>連絡</th><th>日時</th><th></th></tr>';
    entries.forEach(function (e, i) {
      var tr = document.createElement('tr');
      if (e.hidden) tr.className = 'hidden_row';
      [String(i + 1), e.name, e.school, e.grade, e.note, fmtDate(e.created_at)].forEach(function (c, j) {
        var td = document.createElement('td');
        td.textContent = c || '';
        if (j === 0) td.className = 'num';
        tr.appendChild(td);
      });
      var ops = document.createElement('td');
      ops.appendChild(button('名前を変更', '', function () {
        var name = prompt('新しい選手名', e.name);
        if (!name) return;
        post('/entry/update', { id: e.id, name: name, school: e.school, grade: e.grade, note: e.note }).then(function (j) {
          if (j.ok) load(); else say('error', j.error || '変更できませんでした');
        });
      }));
      ops.appendChild(button(e.hidden ? '表示' : '非表示', '', function () {
        post(e.hidden ? '/entry/show' : '/entry/hide', { id: e.id }).then(load);
      }));
      ops.appendChild(button('削除', 'danger', function () {
        if (!confirm(e.name + ' を削除しますか?')) return;
        post('/entry/remove', { id: e.id }).then(load);
      }));
      tr.appendChild(ops);
      table.appendChild(tr);
    });
    box.innerHTML = '';
    box.appendChild(table);
  }

  function load() {
    fetch('/entry/admin-list').then(function (r) {
      if (r.status === 403) { location.href = '/admin?next=' + encodeURIComponent(location.pathname); return { entries: [] }; }
      return r.json();
    }).then(function (json) { entries = json.entries || []; render(); });
  }

  document.getElementById('import_all').onclick = function () {
    fetch('/tournament/admin-data').then(function (r) { return r.json(); }).then(function (data) {
      var existing = {};
      ((data && data.tournament && data.tournament.players) || (data && data.players) || []).forEach(function (p) { existing[p.name] = true; });
      var targets = entries.filter(function (e) { return !e.hidden && !existing[e.name]; });
      if (!targets.length) { say('ok', '追加する人はいません(全員すでに対戦表にいます)'); return; }
      if (!confirm(targets.length + '人を対戦表の参加者に追加します。よろしいですか?')) return;
      var chain = Promise.resolve();
      targets.forEach(function (e) {
        chain = chain.then(function () { return post('/tournament/players/add', { name: e.name, school: e.school }); });
      });
      chain.then(function () { say('ok', targets.length + '人を追加しました。対戦表の管理でトーナメントを作ってください。'); });
    });
  };

  document.getElementById('download_csv').onclick = function () {
    var lines = ['選手名,学校・所属,学年,連絡,日時'];
    entries.forEach(function (e) {
      lines.push([e.name, e.school, e.grade, e.note, e.created_at].map(function (v) {
        return '"' + String(v || '').replace(/"/g, '""') + '"';
      }).join(','));
    });
    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'entries.csv';
    a.click();
  };

  document.getElementById('add').onclick = function () {
    post('/entry/add', {
      name: document.getElementById('add_name').value,
      school: document.getElementById('add_school').value,
      grade: document.getElementById('add_grade').value,
    }).then(function (j) {
      if (j.ok) { say('ok', j.name + ' を追加しました'); document.getElementById('add_name').value = ''; load(); }
      else say('error', j.error || '追加できませんでした');
    });
  };

  load();
})();
