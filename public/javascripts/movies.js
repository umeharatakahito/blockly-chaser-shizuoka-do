/**
 * 試合動画の一覧。
 *
 * Node 版はサーバー側で組み立てていたが、Workers では描画できないので
 * /movies/list を読んでブラウザ側で作る。見た目は本家と同じ。
 */
(function () {
  'use strict';

  var root = document.getElementById('movie_root');

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function empty(main, hint) {
    var box = el('div', 'movie_empty');
    box.appendChild(el('p', 'movie_empty_main', main));
    box.appendChild(el('p', 'movie_empty_hint', hint));
    return box;
  }

  fetch('/movies/list', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      root.innerHTML = '';

      if (data.available === false) {
        root.appendChild(empty(
          '動画機能は準備中です。',
          '運営が保存先を用意すると使えるようになります。'
        ));
        return;
      }

      if (!data.movies || data.movies.length === 0) {
        root.appendChild(empty(
          'まだ動画がありません。',
          '運営が動画を追加すると、ここに表示されます。'
        ));
        return;
      }

      var list = el('ul', 'movie_list');
      data.movies.forEach(function (m) {
        var li = el('li', 'movie_card');
        var a = el('a', 'movie_card_link');
        a.href = '/movies/' + encodeURIComponent(m.id);

        var body = el('div', 'movie_card_body');
        body.appendChild(el('div', 'movie_card_title', m.title));
        if (m.date) body.appendChild(el('div', 'movie_card_date', m.date));
        if (m.description) body.appendChild(el('div', 'movie_card_desc', m.description));

        a.appendChild(body);
        a.appendChild(el('div', 'movie_card_play', '▶'));
        li.appendChild(a);
        list.appendChild(li);
      });
      root.appendChild(list);
    })
    .catch(function () {
      root.innerHTML = '';
      root.appendChild(empty('動画一覧を読み込めませんでした。', '時間をおいて開き直してください。'));
    });
})();
