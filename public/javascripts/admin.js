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
        loadDriveStatus();
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

  /* --- ドライブへの書き出し --- */

  var driveStatus = document.getElementById('drive_status');
  var driveButton = document.getElementById('drive_sync');

  function showDrive(st) {
    var left = st.entries + st.uploads;
    if (!st.ready) {
      driveStatus.textContent = 'Apps Script (WORKS_GAS_URL / WORKS_GAS_SECRET) が未設定のため、ドライブへは写していません。';
      driveButton.disabled = true;
      return;
    }
    driveStatus.textContent = left
      ? '未書き出し: エントリー ' + st.entries + '件 / 提出プログラム ' + st.uploads + '件'
      : 'すべてドライブへ書き出し済みです。';
    driveButton.disabled = left === 0;
  }

  function loadDriveStatus() {
    fetch('/drive/status').then(function (r) { return r.json(); }).then(showDrive).catch(function () {
      driveStatus.textContent = '状態を取得できませんでした。';
    });
  }

  // 1回に数件ずつ送るので、残りが無くなるまで繰り返す
  driveButton.onclick = function () {
    driveButton.disabled = true;
    var total = 0;
    function round() {
      return fetch('/drive/sync', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (j) {
        total += j.sent || 0;
        if (j.errors && j.errors.length) {
          showDrive(j);
          say('error', total + '件を書き出しましたが、失敗がありました: ' + j.errors.join(' / '));
          return;
        }
        if (j.ok === false) { say('error', j.error || '書き出せませんでした'); loadDriveStatus(); return; }
        driveStatus.textContent = total + '件を書き出しました。残り ' + (j.entries + j.uploads) + '件…';
        if (j.entries + j.uploads > 0 && j.sent > 0) return round();
        showDrive(j);
        say('ok', total + '件をドライブへ書き出しました。');
      });
    }
    round().catch(function () { say('error', '通信に失敗しました'); loadDriveStatus(); });
  };

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
