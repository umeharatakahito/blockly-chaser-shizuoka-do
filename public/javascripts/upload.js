/** データアップロード画面(参加者向け) */
(function () {
  var notice = document.getElementById('notice');

  function say(kind, text) {
    notice.innerHTML = '';
    var p = document.createElement('p');
    p.className = kind === 'ok' ? 'admin_ok' : 'admin_error';
    p.textContent = text;
    notice.appendChild(p);
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  function loadEntries() {
    return fetch('/entry/list').then(function (r) { return r.json(); }).then(function (json) {
      var sel = document.getElementById('entry_name');
      sel.innerHTML = '';
      var rows = json.entries || [];
      if (!rows.length) {
        var o = document.createElement('option');
        o.value = '';
        o.textContent = '先にエントリーしてください';
        sel.appendChild(o);
        return;
      }
      rows.forEach(function (r) {
        var o = document.createElement('option');
        o.value = r.name;
        o.textContent = r.name + (r.school ? ' (' + r.school + ')' : '');
        sel.appendChild(o);
      });
      if (localStorage['ENTRY_NAME']) sel.value = localStorage['ENTRY_NAME'];
    });
  }

  function loadUploads() {
    fetch('/upload/list').then(function (r) { return r.json(); }).then(function (json) {
      var rows = json.uploads || [];
      document.getElementById('upload_count').textContent = rows.length ? '(' + rows.length + '件)' : '';
      var box = document.getElementById('upload_list');
      if (!rows.length) {
        box.innerHTML = '<p class="admin_note">まだ提出はありません。</p>';
        return;
      }
      var table = document.createElement('table');
      table.className = 'admin_table';
      table.innerHTML = '<tr><th>選手名</th><th>ファイル</th><th>サイズ</th><th>提出日時</th></tr>';
      rows.forEach(function (r) {
        var tr = document.createElement('tr');
        [r.entry_name, r.file_name, Math.ceil(r.size / 1024) + ' KB', fmtDate(r.created_at)].forEach(function (c, j) {
          var td = document.createElement('td');
          td.textContent = c;
          if (j === 2) td.className = 'num';
          tr.appendChild(td);
        });
        table.appendChild(tr);
      });
      box.innerHTML = '';
      box.appendChild(table);
    });
  }

  document.getElementById('submit').onclick = function () {
    var name = document.getElementById('entry_name').value;
    var file = document.getElementById('file').files[0];
    if (!name) { say('error', '先にエントリーしてください'); return; }
    if (!file) { say('error', 'ファイルを選んでください'); return; }

    var form = new FormData();
    form.append('entry_name', name);
    form.append('note', document.getElementById('note').value);
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

  loadEntries().then(loadUploads);
})();
