/**
 * 試合動画の管理。
 *
 * 動画そのものは預からず URL だけを登録する。
 * 非公開にしても消さない。誤操作から戻せるようにするため。
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function notice(message, isError) {
    var box = $('notice');
    box.innerHTML = '';
    if (!message) return;
    box.appendChild(el('div', isError ? 'admin_error' : 'admin_ok', message));
    window.scrollTo(0, 0);
  }

  function post(action, body) {
    return fetch('/movies/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
      .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, json: j }; }); })
      .then(function (r) {
        if (!r.ok || r.json.ok === false) {
          notice(r.json.error || '操作できませんでした', true);
          return null;
        }
        return r.json;
      });
  }

  var KIND_LABEL = {
    youtube: 'YouTube',
    drive: 'Google ドライブ',
    vimeo: 'Vimeo',
    file: '動画ファイル',
  };

  function row(movie) {
    var box = el('div', 'admin_movie');

    var head = el('div', 'admin_movie_head');
    head.appendChild(el('span', 'admin_match_players', movie.title));
    var badge = el('span', 'admin_movie_badge' + (movie.kind ? '' : ' is_new'),
      movie.kind ? KIND_LABEL[movie.kind] : '再生できません');
    head.appendChild(badge);
    box.appendChild(head);

    box.appendChild(el('div', 'admin_movie_file', movie.url));

    var row1 = el('div', 'admin_field_row');

    var titleField = el('div', 'admin_field');
    titleField.appendChild(el('label', null, 'タイトル'));
    var title = el('input', 'admin_text');
    title.type = 'text';
    title.value = movie.title;
    titleField.appendChild(title);
    row1.appendChild(titleField);

    var dateField = el('div', 'admin_field');
    dateField.appendChild(el('label', null, '日付'));
    var date = el('input', 'admin_text');
    date.type = 'date';
    date.value = movie.date || '';
    dateField.appendChild(date);
    row1.appendChild(dateField);

    var orderField = el('div', 'admin_field');
    orderField.appendChild(el('label', null, '並び順'));
    var order = el('input', 'admin_text');
    order.type = 'number';
    order.value = movie.order;
    orderField.appendChild(order);
    row1.appendChild(orderField);

    box.appendChild(row1);

    var descField = el('div', 'admin_field');
    descField.appendChild(el('label', null, '説明'));
    var desc = el('textarea', 'admin_textarea');
    desc.value = movie.description || '';
    descField.appendChild(desc);
    box.appendChild(descField);

    var actions = el('div', 'admin_actions');

    var save = el('button', 'admin_button', '保存');
    save.onclick = function () {
      post('save', {
        id: movie.id, url: movie.url, title: title.value,
        description: desc.value, date: date.value, order: order.value,
      }).then(function (r) { if (r) { notice('保存しました'); reload(); } });
    };
    actions.appendChild(save);

    var toggle = el('button', 'admin_button_small' + (movie.hidden ? '' : ' admin_button_danger'),
      movie.hidden ? '公開する' : '非公開にする');
    toggle.onclick = function () {
      post(movie.hidden ? 'show' : 'hide', { id: movie.id })
        .then(function (r) { if (r) { notice(movie.hidden ? '公開しました' : '非公開にしました'); reload(); } });
    };
    actions.appendChild(toggle);

    var open = el('a', 'admin_link', '再生ページを開く');
    open.href = '/movies/' + encodeURIComponent(movie.id);
    open.target = '_blank';
    actions.appendChild(open);

    box.appendChild(actions);

    if (movie.hidden) box.style.opacity = '0.55';
    return box;
  }

  function reload() {
    return fetch('/movies/admin-list', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var host = $('movie_list');
        host.innerHTML = '';
        $('movie_count').textContent = '(' + data.movies.length + ')';

        if (data.movies.length === 0) {
          host.appendChild(el('p', 'admin_note', 'まだ動画がありません。'));
          return;
        }
        data.movies.forEach(function (m) { host.appendChild(row(m)); });
      });
  }

  $('save').onclick = function () {
    post('save', {
      url: $('url').value,
      title: $('title').value,
      description: $('description').value,
      date: $('date').value,
      order: $('order').value,
    }).then(function (r) {
      if (!r) return;
      notice('追加しました');
      $('url').value = '';
      $('title').value = '';
      $('description').value = '';
      reload();
    });
  };

  reload();
})();
