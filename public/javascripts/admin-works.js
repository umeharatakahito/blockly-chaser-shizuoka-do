/** 作品部門の提出一覧(運営) */
(function () {
  var works = [];

  function fmtDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  function fmtSize(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return Math.ceil(bytes / 1024) + ' KB';
  }

  function render() {
    var doneOnly = document.getElementById('done_only').checked;
    var rows = doneOnly ? works.filter(function (w) { return w.status === 'done'; }) : works;
    var box = document.getElementById('works_list');
    document.getElementById('works_count').textContent = '(' + works.filter(function (w) { return w.status === 'done'; }).length + '件)';
    if (!rows.length) { box.innerHTML = '<p class="admin_note">まだ提出はありません。</p>'; return; }

    var table = document.createElement('table');
    table.className = 'admin_table';
    table.innerHTML = '<tr><th>学校名</th><th>お名前</th><th>作品名</th><th>ファイル</th><th>サイズ</th><th>状態</th><th>日時</th><th></th></tr>';
    rows.forEach(function (w) {
      var tr = document.createElement('tr');
      var done = w.status === 'done';
      [w.school, w.name, w.title, w.file_name, fmtSize(w.size), done ? '完了' : '送信中', fmtDate(w.done_at || w.created_at)].forEach(function (c, j) {
        var td = document.createElement('td');
        td.textContent = c || '';
        if (j === 4) td.className = 'num';
        if (j === 5 && !done) td.style.color = '#a3271d';
        tr.appendChild(td);
      });
      var ops = document.createElement('td');
      if (w.drive_file_id) {
        var open = document.createElement('a');
        open.className = 'admin_small_button';
        open.href = 'https://drive.google.com/file/d/' + encodeURIComponent(w.drive_file_id) + '/view';
        open.target = '_blank';
        open.rel = 'noopener';
        open.textContent = 'ドライブで開く';
        ops.appendChild(open);
      }
      var rm = document.createElement('button');
      rm.className = 'admin_small_button danger';
      rm.textContent = '削除';
      rm.onclick = function () {
        if (!confirm(w.name + ' の「' + w.title + '」を一覧から削除しますか? (ドライブのファイルは残ります)')) return;
        fetch('/works/remove', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: w.id }),
        }).then(load);
      };
      ops.appendChild(rm);
      tr.appendChild(ops);
      table.appendChild(tr);
    });
    box.innerHTML = '';
    box.appendChild(table);
  }

  function load() {
    fetch('/works/admin-list').then(function (r) {
      if (r.status === 403) { location.href = '/admin?next=' + encodeURIComponent(location.pathname); return { works: [] }; }
      return r.json();
    }).then(function (json) { works = json.works || []; render(); });
  }

  document.getElementById('done_only').onchange = render;
  load();
})();
