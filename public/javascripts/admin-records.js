/** ボット対戦の記録(運営) */
(function () {
  var records = [];

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
    var box = document.getElementById('record_list');
    document.getElementById('record_count').textContent = '(' + records.length + '件)';
    if (!records.length) { box.innerHTML = '<p class="admin_note">記録はまだありません。</p>'; return; }

    var table = document.createElement('table');
    table.className = 'admin_table';
    table.innerHTML = '<tr><th>名前</th><th>ボット</th><th>マップ</th><th>結果</th><th>スコア</th><th>日時</th><th></th></tr>';
    records.forEach(function (r) {
      var tr = document.createElement('tr');
      if (r.hidden) tr.className = 'hidden_row';
      var won = r.winner === r.side;
      var result = r.winner === 'draw' ? '引き分け' : won ? '勝ち' : '負け';
      [r.name + (r.named ? '' : ' (自動)'), 'L' + r.level, r.room_name, result + ' (' + r.info + ')', r.cool_score + ' - ' + r.hot_score, fmtDate(r.created_at)].forEach(function (c, j) {
        var td = document.createElement('td');
        td.textContent = c;
        if (j === 4) td.className = 'num';
        tr.appendChild(td);
      });
      var ops = document.createElement('td');
      var hide = document.createElement('button');
      hide.className = 'admin_small_button';
      hide.textContent = r.hidden ? '表示' : '非表示';
      hide.onclick = function () { post(r.hidden ? '/records/show' : '/records/hide', { id: r.id }).then(load); };
      var rm = document.createElement('button');
      rm.className = 'admin_small_button danger';
      rm.textContent = '削除';
      rm.onclick = function () {
        if (!confirm(r.name + ' の記録を削除しますか?')) return;
        post('/records/remove', { id: r.id }).then(load);
      };
      ops.appendChild(hide);
      ops.appendChild(rm);
      tr.appendChild(ops);
      table.appendChild(tr);
    });
    box.innerHTML = '';
    box.appendChild(table);
  }

  function load() {
    fetch('/records/admin-list').then(function (r) {
      if (r.status === 403) { location.href = '/admin?next=' + encodeURIComponent(location.pathname); return { records: [] }; }
      return r.json();
    }).then(function (json) { records = json.records || []; render(); });
  }

  load();
})();
