/**
 * ゴースト対戦のメニュー。記録の一覧から1つ選んで対戦画面へ。
 */
(function () {
  var maps = {};
  var ghosts = [];
  var selected = null;
  var goButton = document.getElementById('go_button');

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  function select(id) {
    selected = ghosts.filter(function (g) { return g.id === id; })[0] || null;
    document.querySelectorAll('#ghost_list .pick_item').forEach(function (el) {
      el.classList.toggle('on', el.dataset.id === id);
    });
    if (!selected) return;
    var map = maps[selected.roomId];
    if (map) renderMapPreview(document.getElementById('map_preview'), map);
    var myScore = selected.side === 'cool' ? selected.coolScore : selected.hotScore;
    var botScore = selected.side === 'cool' ? selected.hotScore : selected.coolScore;
    document.getElementById('ghost_info').textContent =
      selected.name + ' — ' + selected.roomName + ' でボット L' + selected.level + ' に'
      + (selected.won ? '勝利' : (selected.winner === 'draw' ? '引き分け' : '敗北'))
      + ' (' + myScore + ' 対 ' + botScore + ', ' + selected.info + ')';
    goButton.disabled = false;
    goButton.textContent = selected.name + ' のゴーストと対戦する';
  }

  function render() {
    var list = document.getElementById('ghost_list');
    list.innerHTML = '';
    if (!ghosts.length) {
      list.innerHTML = '<div class="empty_note">まだゴーストがいません。ボット対戦で勝つと、その記録がここに並びます。</div>';
      return;
    }
    ghosts.forEach(function (g) {
      var item = document.createElement('div');
      item.className = 'pick_item';
      item.dataset.id = g.id;
      var left = document.createElement('span');
      left.className = 'pick_item_name';
      var badge = document.createElement('span');
      badge.className = 'pick_badge ghost';
      badge.textContent = 'L' + g.level + (g.won ? ' 勝' : g.winner === 'draw' ? ' 分' : ' 負');
      left.appendChild(badge);
      left.appendChild(document.createTextNode(g.name));
      var right = document.createElement('span');
      right.className = 'pick_item_sub';
      right.textContent = g.roomName + ' ' + fmtDate(g.created_at);
      item.appendChild(left);
      item.appendChild(right);
      item.onclick = function () { select(g.id); };
      list.appendChild(item);
    });
  }

  function load() {
    var all = document.getElementById('show_all').checked;
    fetch('/records/ghosts' + (all ? '?all=1' : '')).then(function (r) { return r.json(); }).then(function (json) {
      ghosts = json.ghosts || [];
      render();
    });
  }

  document.getElementById('show_all').onchange = load;

  goButton.onclick = function () {
    if (!selected) return;
    var token = randomToken('ghost');
    location.href = '/match?room_id=' + encodeURIComponent(selected.roomId)
      + '&room_token=' + token + '&ghost=' + encodeURIComponent(selected.id);
  };

  fetch('/api/game').then(function (r) { return r.json(); }).then(function (json) {
    maps = json;
    load();
  });
})();
