/**
 * 対戦表の描画。
 *
 * Node 版はサーバー側で EJS を展開していたが、Workers では描画できないので
 * /tournament/data を読んでブラウザ側で組み立てる。見た目は本家と同じにしてある。
 */
(function () {
  'use strict';

  var root = document.getElementById('bracket_root');
  var titleEl = document.getElementById('bracket_title');
  var current = null;

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function playerName(data, id) {
    if (!id) return null;
    for (var i = 0; i < data.players.length; i++) {
      if (data.players[i].id === id) return data.players[i];
    }
    return null;
  }

  function slot(data, match, side) {
    var player = playerName(data, side === 'cool' ? match.coolId : match.hotId);
    var score = side === 'cool' ? match.coolScore : match.hotScore;

    var box = el('div', 'bracket_slot bracket_slot_' + side);
    if (player && match.winnerId === player.id) box.classList.add('is_winner');
    else if (player && match.winnerId) box.classList.add('is_loser');

    box.appendChild(el('span', 'bracket_slot_name', player ? player.name : '―'));
    if (score !== null && score !== undefined) {
      box.appendChild(el('span', 'bracket_slot_score', String(score)));
    }
    return box;
  }

  function draw(data) {
    titleEl.textContent = data.title || '';
    root.innerHTML = '';

    if (!data.rounds || data.rounds.length === 0) {
      var empty = el('div', 'bracket_empty');
      empty.appendChild(el('p', 'bracket_empty_main', '対戦表はまだ作られていません。'));
      empty.appendChild(el('p', 'bracket_empty_hint', '運営が組み合わせを決めると、ここに表示されます。'));
      root.appendChild(empty);
      return;
    }

    if (data.champion) {
      var champ = el('div', 'bracket_champion');
      champ.appendChild(el('div', 'bracket_champion_label', '優勝'));
      champ.appendChild(el('div', 'bracket_champion_name', data.champion.name));
      if (data.champion.school) champ.appendChild(el('div', 'bracket_champion_school', data.champion.school));
      root.appendChild(champ);
    }

    var scroll = el('div', 'bracket_scroll');
    var bracket = el('div', 'bracket');

    data.rounds.forEach(function (round, ri) {
      var col = el('div', 'bracket_round');
      col.appendChild(el('div', 'bracket_round_name', round.name));

      var list = el('div', 'bracket_matches');
      round.matches.forEach(function (match) {
        var wrap = el('div', 'bracket_match' + (ri < data.rounds.length - 1 ? ' has_next' : ''));
        var card = el('div', 'bracket_card');

        card.appendChild(slot(data, match, 'cool'));
        card.appendChild(slot(data, match, 'hot'));

        if (match.note) {
          var meta = el('div', 'bracket_meta');
          meta.appendChild(el('span', 'bracket_note', match.note));
          card.appendChild(meta);
        }

        wrap.appendChild(card);
        list.appendChild(wrap);
      });

      col.appendChild(list);
      bracket.appendChild(col);
    });

    scroll.appendChild(bracket);
    root.appendChild(scroll);
  }

  function poll() {
    fetch('/tournament/data', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data) return;
        var next = JSON.stringify(data);
        if (next === current) return;
        current = next;
        draw(data);
      })
      .catch(function () { /* 通信が切れても画面は保ちたい */ });
  }

  poll();
  setInterval(poll, 30000);
})();
