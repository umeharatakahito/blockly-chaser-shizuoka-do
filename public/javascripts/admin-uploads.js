/** 提出プログラム一覧(運営) と 一括データの取り込み */
(function () {
  var notice = document.getElementById('notice');
  var uploads = [];

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

  function render() {
    var latestOnly = document.getElementById('latest_only').checked;
    var box = document.getElementById('upload_list');
    document.getElementById('upload_count').textContent = '(' + uploads.length + '件)';
    if (!uploads.length) { box.innerHTML = '<p class="admin_note">まだ提出はありません。</p>'; return; }

    var latest = {};
    uploads.forEach(function (u) {
      if (!latest[u.entry_name] || latest[u.entry_name].created_at < u.created_at) latest[u.entry_name] = u;
    });

    var rows = latestOnly ? Object.keys(latest).sort().map(function (k) { return latest[k]; }) : uploads;

    var table = document.createElement('table');
    table.className = 'admin_table';
    table.innerHTML = '<tr><th>選手名</th><th>ファイル</th><th>サイズ</th><th>メモ</th><th>提出日時</th><th></th></tr>';
    rows.forEach(function (u) {
      var tr = document.createElement('tr');
      var isLatest = latest[u.entry_name].id === u.id;
      [u.entry_name, u.file_name, Math.ceil(u.size / 1024) + ' KB', u.note, fmtDate(u.created_at)].forEach(function (c, j) {
        var td = document.createElement('td');
        td.textContent = c || '';
        if (j === 2) td.className = 'num';
        if (isLatest && j < 2) td.style.fontWeight = 'bold';
        tr.appendChild(td);
      });
      var ops = document.createElement('td');
      var dl = document.createElement('a');
      dl.className = 'admin_small_button';
      dl.href = '/upload/file?id=' + encodeURIComponent(u.id);
      dl.textContent = 'ダウンロード';
      ops.appendChild(dl);
      var rm = document.createElement('button');
      rm.className = 'admin_small_button danger';
      rm.textContent = '削除';
      rm.onclick = function () {
        if (!confirm(u.entry_name + ' の ' + u.file_name + ' を削除しますか?')) return;
        post('/upload/remove', { id: u.id }).then(load);
      };
      ops.appendChild(rm);
      tr.appendChild(ops);
      table.appendChild(tr);
    });
    box.innerHTML = '';
    box.appendChild(table);
  }

  function load() {
    fetch('/upload/admin-list').then(function (r) {
      if (r.status === 403) { location.href = '/admin?next=' + encodeURIComponent(location.pathname); return { uploads: [] }; }
      return r.json();
    }).then(function (json) { uploads = json.uploads || []; render(); });
  }

  document.getElementById('latest_only').onchange = render;

  /* --- 一括データ --- */

  function parseCsv(text) {
    var lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });
    return lines.map(function (line) {
      var out = [];
      var cur = '';
      var q = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (q) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') q = false;
          else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out.map(function (s) { return s.trim(); });
    });
  }

  document.getElementById('bulk_import').onclick = function () {
    var file = document.getElementById('bulk_file').files[0];
    if (!file) { say('error', 'ファイルを選んでください'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result);
      if (/\.json$/i.test(file.name)) {
        var data;
        try { data = JSON.parse(text); } catch (e) { say('error', 'JSON として読めません'); return; }
        if (!confirm('対戦表をこの JSON の内容で置き換えます。よろしいですか?')) return;
        post('/tournament/import', { tournament: data.tournament || data }).then(function (j) {
          if (j.ok) say('ok', '対戦表を取り込みました'); else say('error', j.error || '取り込めませんでした');
        });
        return;
      }
      var rows = parseCsv(text).filter(function (r) { return r[0]; });
      if (rows.length && /名前|選手|name/i.test(rows[0][0])) rows.shift();
      if (!rows.length) { say('error', '取り込める行がありません'); return; }
      if (!confirm(rows.length + '人をエントリーと対戦表の参加者に追加します。よろしいですか?')) return;
      var chain = Promise.resolve();
      var added = 0;
      rows.forEach(function (r) {
        chain = chain.then(function () {
          return post('/entry/add', { name: r[0], school: r[1] || '', grade: r[2] || '' });
        }).then(function () {
          return post('/tournament/players/add', { name: r[0], school: r[1] || '' });
        }).then(function () { added++; });
      });
      chain.then(function () { say('ok', added + '人を追加しました'); });
    };
    reader.readAsText(file);
  };

  load();
})();
