/**
 * 対人対戦のメニュー。マップと合言葉を選んで対戦画面へ。
 *
 * 出すのは対人ルーム(cpu を持たないもの)だけ。
 * CPU 入りのルームは「ボット対戦」に置き換わったので、ここには並べない。
 */
(function () {
  var maps = {};
  var selectedMap = null;

  var goButton = document.getElementById('go_button');
  var watchButton = document.getElementById('watch_button');
  var tokenInput = document.getElementById('token_input');

  function updateGo() {
    if (!selectedMap) {
      goButton.disabled = true;
      watchButton.disabled = true;
      goButton.textContent = 'マップを選んでください';
      return;
    }
    goButton.disabled = false;
    watchButton.disabled = false;
    goButton.textContent = maps[selectedMap].name + ' で対戦する';
  }

  function selectMap(id) {
    selectedMap = id;
    document.querySelectorAll('#map_list .pick_item').forEach(function (el) {
      el.classList.toggle('on', el.dataset.id === id);
    });
    renderMapPreview(document.getElementById('map_preview'), maps[id]);
    document.getElementById('map_name').textContent = maps[id].name + ' (' + id + ', ' + maps[id].turn + 'ターン)';
    updateGo();
  }

  function renderMaps() {
    var list = document.getElementById('map_list');
    list.innerHTML = '';

    // 大会マップ(静岡)を先に並べる
    var ids = Object.keys(maps).filter(function (id) {
      return !maps[id].cpu && String(maps[id].name).indexOf('room_onetime') === -1;
    }).sort(function (a, b) {
      var sa = String(maps[a].name).indexOf('静岡') === 0 ? 0 : 1;
      var sb = String(maps[b].name).indexOf('静岡') === 0 ? 0 : 1;
      return sa - sb || a.localeCompare(b);
    });

    ids.forEach(function (id) {
      var m = maps[id];
      var item = document.createElement('div');
      item.className = 'pick_item';
      item.dataset.id = id;
      item.innerHTML = '<span class="pick_item_name"></span><span class="pick_item_sub"></span>';
      item.querySelector('.pick_item_name').textContent = m.name;
      item.querySelector('.pick_item_sub').textContent = id + ' / ' + m.turn + 'ターン';
      item.onclick = function () { selectMap(id); };
      list.appendChild(item);
    });

    if (ids.length) selectMap(ids[0]);
  }

  /** 合言葉。空らんのときは本家と同じ no_token を使う */
  function token() {
    var t = tokenInput.value.replace(/[^\x21-\x7E]/g, '');
    return t || 'no_token';
  }

  tokenInput.addEventListener('input', function () {
    // 合言葉はURLに載るので、半角だけに絞る
    this.value = this.value.replace(/[^\x21-\x7E]/g, '');
  });

  goButton.onclick = function () {
    if (!selectedMap) return;
    location.href = '/match?room_id=' + encodeURIComponent(selectedMap)
      + '&room_token=' + encodeURIComponent(token());
  };

  watchButton.onclick = function () {
    if (!selectedMap) return;
    location.href = '/watching?room_id=' + encodeURIComponent(selectedMap)
      + '&room_token=' + encodeURIComponent(token());
  };

  fetch('/api/game').then(function (r) { return r.json(); }).then(function (json) {
    maps = json;
    renderMaps();
  });
})();
