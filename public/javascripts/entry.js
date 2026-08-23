/** エントリー画面 */
(function () {
  var notice = document.getElementById('notice');

  function say(kind, text) {
    notice.innerHTML = '';
    var p = document.createElement('p');
    p.className = kind === 'ok' ? 'admin_ok' : 'admin_error';
    p.textContent = text;
    notice.appendChild(p);
  }

  function load() {
    fetch('/entry/list').then(function (r) { return r.json(); }).then(function (json) {
      var rows = json.entries || [];
      document.getElementById('entry_count').textContent = rows.length ? '(' + rows.length + '人)' : '';
      var box = document.getElementById('entry_list');
      if (!rows.length) {
        box.innerHTML = '<p class="admin_note">まだエントリーはありません。</p>';
        return;
      }
      var table = document.createElement('table');
      table.className = 'admin_table';
      table.innerHTML = '<tr><th>#</th><th>選手名</th><th>学校・所属</th></tr>';
      rows.forEach(function (r, i) {
        var tr = document.createElement('tr');
        [String(i + 1), r.name, r.school || ''].forEach(function (c, j) {
          var td = document.createElement('td');
          td.textContent = c;
          if (j === 0) td.className = 'num';
          tr.appendChild(td);
        });
        table.appendChild(tr);
      });
      box.innerHTML = '';
      box.appendChild(table);
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
        say('ok', json.name + ' さんをエントリーしました。プログラムの提出は「データアップロード」から行えます。');
        localStorage['ENTRY_NAME'] = json.name;
        document.getElementById('note').value = '';
        load();
      } else {
        say('error', json.error || 'エントリーできませんでした');
      }
    }).catch(function () { say('error', '通信に失敗しました'); });
  };

  if (localStorage['ENTRY_NAME']) document.getElementById('name').value = localStorage['ENTRY_NAME'];
  load();
})();
