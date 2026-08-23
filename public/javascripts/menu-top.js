/**
 * トップメニュー。
 *
 * 運営モードは普段隠しておき、画面上部のバーを5回押すと出る。
 * 参加者に押させないための隠しであって、鍵の代わりではない。
 * 運営ページ自体は ADMIN_KEY で守られている。
 */
(function () {
  var section = document.getElementById('admin_mode');
  if (!section) return;

  var header = document.querySelector('.header');
  var NEEDED = 5;
  var RESET_MS = 5000;   // 間が空いたら数え直す。誤操作で出ないように
  var count = 0;
  var timer = null;

  function reveal() {
    section.hidden = false;
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    sessionStorage['ADMIN_MODE_SHOWN'] = '1';
  }

  // 同じタブでは開いたままにしておく。運営が行き来するため
  if (sessionStorage['ADMIN_MODE_SHOWN'] === '1') section.hidden = false;

  header.addEventListener('click', function (e) {
    // 設定ボタンなど、押すもののクリックは数えない
    if (e.target.closest('button, a, input, select')) return;

    count++;
    clearTimeout(timer);
    timer = setTimeout(function () { count = 0; }, RESET_MS);

    if (count >= NEEDED) {
      count = 0;
      reveal();
    }
  });
})();
