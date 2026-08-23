/**
 * ボット対戦のメニュー。マップとレベルを選んで対戦画面へ。
 */
(function () {
  var maps = {};
  var levels = [];
  var selectedMap = null;
  var level = Number(localStorage['BOT_LEVEL'] || 10);

  var range = document.getElementById('level_range');
  var levelValue = document.getElementById('level_value');
  var levelDesc = document.getElementById('level_desc');
  var goButton = document.getElementById('go_button');

  function describe(L) {
    var found = levels.filter(function (x) { return x.level === L; })[0];
    return found ? found.description : '';
  }

  function setLevel(L) {
    level = Math.max(1, Math.min(30, L));
    range.value = level;
    levelValue.textContent = 'L ' + level;
    levelDesc.textContent = describe(level);
    localStorage['BOT_LEVEL'] = level;
    document.querySelectorAll('#level_quick button').forEach(function (b) {
      b.classList.toggle('on', Number(b.dataset.level) === level);
    });
    updateGo();
  }

  function updateGo() {
    if (!selectedMap) {
      goButton.disabled = true;
      goButton.textContent = 'マップを選んでください';
      return;
    }
    goButton.disabled = false;
    goButton.textContent = maps[selectedMap].name + ' で L' + level + ' と対戦する';
  }

  function selectMap(id) {
    selectedMap = id;
    document.querySelectorAll('#map_list .pick_item').forEach(function (el) {
      el.classList.toggle('on', el.dataset.id === id);
    });
    renderMapPreview(document.getElementById('map_preview'), maps[id]);
    document.getElementById('map_name').textContent = maps[id].name + ' (' + id + ', ' + maps[id].turn + 'ターン)';
    localStorage['BOT_MAP'] = id;
    updateGo();
  }

  function renderMaps() {
    var list = document.getElementById('map_list');
    list.innerHTML = '';
    // ボットが hot に入るので、CPU の無い対人ルームを使う。大会マップ(静岡)を先に並べる
    var ids = Object.keys(maps).sort(function (a, b) {
      var sa = String(maps[a].name).indexOf('静岡') === 0 ? 0 : 1;
      var sb = String(maps[b].name).indexOf('静岡') === 0 ? 0 : 1;
      return sa - sb || a.localeCompare(b);
    });
    ids.forEach(function (id) {
      var m = maps[id];
      if (m.cpu) return;
      if (String(m.name).indexOf('room_onetime') !== -1) return;
      var item = document.createElement('div');
      item.className = 'pick_item';
      item.dataset.id = id;
      item.innerHTML = '<span class="pick_item_name"></span><span class="pick_item_sub"></span>';
      item.querySelector('.pick_item_name').textContent = m.name;
      item.querySelector('.pick_item_sub').textContent = id + ' / ' + m.turn + 'ターン';
      item.onclick = function () { selectMap(id); };
      list.appendChild(item);
    });
  }

  function renderQuick() {
    var quick = document.getElementById('level_quick');
    [1, 3, 5, 8, 10, 12, 15, 20, 25, 30].forEach(function (L) {
      var b = document.createElement('button');
      b.textContent = 'L' + L;
      b.dataset.level = L;
      b.onclick = function () { setLevel(L); };
      quick.appendChild(b);
    });
  }

  function renderRanking(rows) {
    var box = document.getElementById('ranking');
    if (!rows.length) {
      box.innerHTML = '<div class="empty_note">まだ記録がありません。最初の勝者になろう！</div>';
      return;
    }
    var table = document.createElement('table');
    table.className = 'rank_table';
    table.innerHTML = '<tr><th>#</th><th>名前</th><th>倒したボット</th><th>マップ</th><th>点差</th></tr>';
    rows.slice(0, 20).forEach(function (r, i) {
      var tr = document.createElement('tr');
      var cells = [String(i + 1), r.name, 'L' + r.level, r.roomName, (r.scoreDiff > 0 ? '+' : '') + r.scoreDiff];
      cells.forEach(function (c, j) {
        var td = document.createElement('td');
        td.textContent = c;
        if (j === 0 || j === 4) td.className = 'num';
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    box.innerHTML = '';
    box.appendChild(table);
  }

  range.oninput = function () { setLevel(Number(range.value)); };

  goButton.onclick = function () {
    if (!selectedMap) return;
    var token = randomToken('bot');
    location.href = '/match?room_id=' + encodeURIComponent(selectedMap)
      + '&room_token=' + token + '&bot=' + level;
  };

  renderQuick();

  Promise.all([
    fetch('/api/game').then(function (r) { return r.json(); }),
    fetch('/api/bot-levels').then(function (r) { return r.json(); }),
    fetch('/records/ranking').then(function (r) { return r.json(); }).catch(function () { return { ranking: [] }; }),
  ]).then(function (res) {
    maps = res[0];
    levels = res[1];
    renderMaps();
    setLevel(level);
    var remembered = localStorage['BOT_MAP'];
    if (remembered && maps[remembered] && !maps[remembered].cpu) selectMap(remembered);
    renderRanking(res[2].ranking || []);
  });
})();
