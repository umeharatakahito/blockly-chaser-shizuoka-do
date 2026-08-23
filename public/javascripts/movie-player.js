/**
 * 試合動画の再生ページ。URL の末尾が動画の id になっている。
 */
(function () {
  'use strict';

  var root = document.getElementById('player_root');
  var titleEl = document.getElementById('movie_title');
  var id = decodeURIComponent(location.pathname.replace(/^\/movies\//, ''));

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function notFound() {
    root.innerHTML = '';
    var box = el('div', 'movie_empty');
    box.appendChild(el('p', 'movie_empty_main', 'その動画は見つかりませんでした。'));
    var hint = el('p', 'movie_empty_hint');
    var back = el('a', null, '一覧にもどる');
    back.href = '/movies';
    hint.appendChild(back);
    box.appendChild(hint);
    root.appendChild(box);
  }

  fetch('/movies/list', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var movie = (data.movies || []).find(function (m) { return m.id === id; });
      if (!movie) return notFound();

      titleEl.textContent = movie.title;
      root.innerHTML = '';

      var player = el('div', 'movie_player');
      var video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      video.src = '/movies/file/' + encodeURIComponent(movie.id);
      video.textContent = 'このブラウザでは動画を再生できません。';
      player.appendChild(video);
      root.appendChild(player);

      var meta = el('div', 'movie_meta');
      if (movie.date) meta.appendChild(el('div', 'movie_meta_date', movie.date));
      if (movie.description) meta.appendChild(el('p', 'movie_meta_desc', movie.description));
      var backWrap = el('p', 'movie_meta_back');
      var back = el('a', null, '一覧にもどる');
      back.href = '/movies';
      backWrap.appendChild(back);
      meta.appendChild(backWrap);
      root.appendChild(meta);
    })
    .catch(notFound);
})();
