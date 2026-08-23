/**
 * マップの盤面を小さな表にして出す。
 * セルの見た目(画像クラス)は menu-watching.css のものを使う。
 */
function renderMapPreview(container, map) {
  container.innerHTML = '';
  var data = map.map_data || [];
  var table = document.createElement('table');
  table.setAttribute('id', 'map_table');

  if (!data.length) {
    var note = document.createElement('div');
    note.className = 'empty_note';
    note.textContent = '試合のたびに自動生成されるマップです';
    container.appendChild(note);
    return;
  }

  var cls = { 0: 'field_img', 1: 'wall_img', 2: 'hart_img', 3: 'cool_img', 4: 'hot_img', 34: 'ch_img', 43: 'hc_img' };
  for (var i = 0; i < data.length; i++) {
    var row = table.insertRow(-1);
    for (var j = 0; j < data[i].length; j++) {
      var cell = row.insertCell(-1);
      cell.classList.add(cls[data[i][j]] || 'field_img');
    }
  }
  container.appendChild(table);
}

function randomToken(prefix) {
  var chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  var s = prefix || '';
  for (var i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
