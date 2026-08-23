/**
 * エントリーとプログラム提出。
 * 参加者から見ると「名前を登録して、プログラムを出す」という一続きの作業なので同じ画面にまとめてある。
 */
(function () {
  var notice = document.getElementById('notice');

  function say(kind, text) {
    notice.innerHTML = '';
    var p = document.createElement('p');
    p.className = kind === 'ok' ? 'admin_ok' : 'admin_error';
    p.textContent = text;
    notice.appendChild(p);
    notice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  /** 見出しつきの表を作る。cells は文字列の配列 */
  function table(headers, rows, numColumns) {
    var t = document.createElement('table');
    t.className = 'admin_table';
    var head = document.createElement('tr');
    headers.forEach(function (h) {
      var th = document.createElement('th');
      th.textContent = h;
      head.appendChild(th);
    });
    t.appendChild(head);
    rows.forEach(function (cells) {
      var tr = document.createElement('tr');
      cells.forEach(function (c, j) {
        var td = document.createElement('td');
        td.textContent = c || '';
        if (numColumns.indexOf(j) !== -1) td.className = 'num';
        tr.appendChild(td);
      });
      t.appendChild(tr);
    });
    return t;
  }

  /* ------------------------------------------------------------ エントリー */

  function loadEntries() {
    return fetch('/entry/list').then(function (r) { return r.json(); }).then(function (json) {
      var rows = json.entries || [];

      document.getElementById('entry_count').textContent = rows.length ? '(' + rows.length + '人)' : '';
      var box = document.getElementById('entry_list');
      if (!rows.length) {
        box.innerHTML = '<p class="admin_note">まだエントリーはありません。</p>';
      } else {
        box.innerHTML = '';
        box.appendChild(table(
          ['#', '選手名', '学校・所属'],
          rows.map(function (r, i) { return [String(i + 1), r.name, r.school]; }),
          [0]
        ));
      }

      // 提出のほうの選手名も同じ一覧から作る。
      // エントリーした直後はその人が選ばれていてほしいので、記憶した名前を優先する
      var sel = document.getElementById('entry_name');
      var keep = localStorage['ENTRY_NAME'] || sel.value;
      sel.innerHTML = '';
      if (!rows.length) {
        var o = document.createElement('option');
        o.value = '';
        o.textContent = '先に上でエントリーしてください';
        sel.appendChild(o);
      } else {
        rows.forEach(function (r) {
          var o = document.createElement('option');
          o.value = r.name;
          o.textContent = r.name + (r.school ? ' (' + r.school + ')' : '');
          sel.appendChild(o);
        });
        sel.value = rows.some(function (r) { return r.name === keep; }) ? keep : rows[0].name;
      }
    });
  }

  document.getElementById('submit').onclick = function () {
    var body = {
      name: document.getElementById('name').value,
      school: document.getElementById('school').value,
      grade: document.getElementById('grade').value,
      note: document.getElementById('note').value,
    };
    if (!body.name.trim()) { say('error', '選手名を入れてください'); return; }
    fetch('/entry/add', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(function (r) { return r.json(); }).then(function (json) {
      if (json.ok) {
        localStorage['ENTRY_NAME'] = json.name;
        say('ok', json.name + ' さんをエントリーしました。続けて下の「2. プログラムを提出する」から .blch を出してください。');
        document.getElementById('note').value = '';
        loadEntries().then(function () {
          document.getElementById('upload_card').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      } else {
        say('error', json.error || 'エントリーできませんでした');
      }
    }).catch(function () { say('error', '通信に失敗しました'); });
  };

  /* ------------------------------------------------------------ 提出 */

  function loadUploads() {
    return fetch('/upload/list').then(function (r) { return r.json(); }).then(function (json) {
      var rows = json.uploads || [];
      document.getElementById('upload_count').textContent = rows.length ? '(' + rows.length + '件)' : '';
      var box = document.getElementById('upload_list');
      if (!rows.length) {
        box.innerHTML = '<p class="admin_note">まだ提出はありません。</p>';
        return;
      }
      box.innerHTML = '';
      box.appendChild(table(
        ['選手名', 'ファイル', 'サイズ', '提出日時'],
        rows.map(function (r) { return [r.entry_name, r.file_name, Math.ceil(r.size / 1024) + ' KB', fmtDate(r.created_at)]; }),
        [2]
      ));
    });
  }

  document.getElementById('upload_submit').onclick = function () {
    var name = document.getElementById('entry_name').value;
    var file = document.getElementById('file').files[0];
    if (!name) { say('error', '先に上でエントリーしてください'); return; }
    if (!file) { say('error', 'ファイルを選んでください'); return; }

    var form = new FormData();
    form.append('entry_name', name);
    form.append('note', document.getElementById('upload_note').value);
    form.append('file', file, file.name);

    fetch('/upload/add', { method: 'POST', body: form })
      .then(function (r) { return r.json(); })
      .then(function (json) {
        if (json.ok) {
          say('ok', name + ' さんの ' + json.fileName + ' を受け付けました。');
          localStorage['ENTRY_NAME'] = name;
          document.getElementById('file').value = '';
          loadUploads();
        } else {
          say('error', json.error || '提出できませんでした');
        }
      }).catch(function () { say('error', '通信に失敗しました'); });
  };

  if (localStorage['ENTRY_NAME']) document.getElementById('name').value = localStorage['ENTRY_NAME'];
  loadEntries().then(loadUploads);
})();
