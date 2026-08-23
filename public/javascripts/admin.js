/** 運営メニュー。鍵の状態を見て、ログインかメニューを出す */
(function () {
  var notice = document.getElementById('notice');
  var next = (/[?&]next=([^&]+)/.exec(location.search) || [])[1];

  function say(kind, text) {
    notice.innerHTML = '';
    var p = document.createElement('p');
    p.className = kind === 'ok' ? 'admin_ok' : 'admin_error';
    p.textContent = text;
    notice.appendChild(p);
  }

  function refresh() {
    fetch('/admin/status').then(function (r) { return r.json(); }).then(function (st) {
      if (st.admin) {
        if (next) { location.href = decodeURIComponent(next); return; }
        document.getElementById('menu').style.display = '';
        document.getElementById('login_card').style.display = 'none';
        document.getElementById('key_status').textContent = st.keyConfigured
          ? '鍵で運営モードに入っています。'
          : '鍵 (ADMIN_KEY) が未設定のため、localhost からは鍵なしで開けています。公開環境では必ず設定してください。';
        return;
      }
      document.getElementById('menu').style.display = 'none';
      document.getElementById('login_card').style.display = '';
      document.getElementById('login_help').textContent = st.keyConfigured
        ? ''
        : '鍵 (ADMIN_KEY) が設定されていません。Cloudflare 側で "npx wrangler secret put ADMIN_KEY" を実行して鍵を決めてください。';
    });
  }

  document.getElementById('login').onclick = function () {
    var key = document.getElementById('key').value;
    fetch('/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: key }),
    }).then(function (r) {
      if (r.ok) { refresh(); return; }
      return r.json().then(function (j) { say('error', j.error || '鍵が違います'); });
    });
  };
  document.getElementById('key').onkeydown = function (e) {
    if (e.key === 'Enter') document.getElementById('login').onclick();
  };

  document.getElementById('logout').onclick = function () {
    fetch('/admin/logout', { method: 'POST' }).then(function () { location.href = '/'; });
  };

  refresh();
})();
