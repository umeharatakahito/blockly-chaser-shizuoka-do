/**
 * 試合動画の再生ページ。URL の末尾が動画の id になっている。
 *
 * YouTube などは iframe、mp4 への直リンクは <video> で再生する。
 * どちらになるかはサーバー側の判定(kind)に従う。
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

  function message(main, hintText) {
    root.innerHTML = '';
    var box = el('div', 'movie_empty');
    box.appendChild(el('p', 'movie_empty_main', main));
    var hint = el('p', 'movie_empty_hint');
    if (hintText) hint.appendChild(document.createTextNode(hintText + ' '));
    var back = el('a', null, '一覧にもどる');
    back.href = '/movies';
    hint.appendChild(back);
    box.appendChild(hint);
    root.appendChild(box);
  }

  function playerFor(movie) {
    var wrap = el('div', 'movie_player');

    if (movie.kind === 'file') {
      var video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      video.src = movie.embedSrc;
      video.textContent = 'このブラウザでは動画を再生できません。';
      wrap.appendChild(video);
      return wrap;
    }

    // YouTube / Google ドライブ / Vimeo
    var frame = document.createElement('iframe');
    frame.src = movie.embedSrc;
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.setAttribute('frameborder', '0');
    wrap.appendChild(frame);
    return wrap;
  }

  fetch('/movies/list', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var movie = (data.movies || []).filter(function (m) { return m.id === id; })[0];
      if (!movie) return message('その動画は見つかりませんでした。', '');

      titleEl.textContent = movie.title;

      if (!movie.embedSrc) {
        return message('この動画は再生できません。', '登録された URL に対応していません。');
      }

      root.innerHTML = '';
      root.appendChild(playerFor(movie));

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
    .catch(function () { message('動画を読み込めませんでした。', '時間をおいて開き直してください。'); });
})();
