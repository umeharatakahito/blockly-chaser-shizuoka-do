/**
 * 作品部門の提出。
 *
 * ファイル本体は Google ドライブへ直接、分割して送る(再開可能アップロード)。
 * 流れは src/works.js の説明を参照。
 *
 * 大きなファイルは途中で切れることがあるので、アップロード先の URL を localStorage に覚えておき、
 * 同じファイルを選び直したら続きから送る(Drive の URL は1週間有効)。
 */
(function () {
  /** 1回に送る大きさ。Drive の決まりで 256KiB の倍数にする */
  var CHUNK = 16 * 1024 * 1024;
  var RESUME_KEY = 'WORKS_RESUME';
  var RESUME_TTL = 6 * 24 * 60 * 60 * 1000;
  var FIELDS = ['school', 'name', 'email', 'title'];

  var notice = document.getElementById('notice');
  var submitButton = document.getElementById('submit');
  var config = { ready: false, passcode: false, maxBytes: 1024 * 1024 * 1024 };
  var busy = false;

  function $(id) { return document.getElementById(id); }

  function say(kind, text) {
    notice.innerHTML = '';
    var p = document.createElement('p');
    p.className = kind === 'ok' ? 'admin_ok' : 'admin_error';
    p.textContent = text;
    notice.appendChild(p);
    notice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function fmtSize(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return Math.ceil(bytes / 1024) + ' KB';
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec <= 0) return '';
    if (sec < 60) return '残り約' + Math.ceil(sec) + '秒';
    return '残り約' + Math.ceil(sec / 60) + '分';
  }

  function postJson(path, body) {
    return fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: '通信に失敗しました (' + r.status + ')' }; });
    });
  }

  function sleep(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  /* ------------------------------------------------------------ 続きから送るための記憶 */

  function fileKey(file) { return [file.name, file.size, file.lastModified].join('|'); }

  function loadResume(file) {
    try {
      var saved = JSON.parse(localStorage[RESUME_KEY] || 'null');
      if (saved && saved.key === fileKey(file) && Date.now() - saved.at < RESUME_TTL) return saved;
    } catch (e) { /* 読めなければ最初から */ }
    return null;
  }

  function saveResume(file, id, uploadUrl) {
    try { localStorage[RESUME_KEY] = JSON.stringify({ key: fileKey(file), id: id, uploadUrl: uploadUrl, at: Date.now() }); } catch (e) { /* 覚えられなくても送れる */ }
  }

  function clearResume() {
    try { delete localStorage[RESUME_KEY]; } catch (e) { /* 何もしない */ }
  }

  /* ------------------------------------------------------------ Drive への送信 */

  /**
   * Drive へ PUT する。XHR を使うのは送信の進み具合を取るため。
   * 途中の分割を受け取ると Drive は 308 を返す(Location が無いのでリダイレクトにはならない)
   */
  function put(uploadUrl, blob, range, onProgress) {
    return new Promise(function (resolve) {
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Range', range);
      if (onProgress) xhr.upload.onprogress = function (e) { onProgress(e.loaded); };
      xhr.onload = function () {
        resolve({ status: xhr.status, range: xhr.getResponseHeader('Range'), text: xhr.responseText });
      };
      xhr.onerror = xhr.ontimeout = function () { resolve({ status: 0 }); };
      xhr.send(blob);
    });
  }

  /** "bytes=0-1234" → 次に送る位置 1235。無ければ 0 */
  function nextOffset(range) {
    var m = /bytes=0-(\d+)/.exec(range || '');
    return m ? Number(m[1]) + 1 : 0;
  }

  function doneFileId(res) {
    try { return JSON.parse(res.text).id || ''; } catch (e) { return ''; }
  }

  /** Drive がどこまで受け取ったかを聞く。{done, fileId} か {offset} か {expired} */
  function askStatus(uploadUrl, size) {
    return put(uploadUrl, null, 'bytes */' + size).then(function (res) {
      if (res.status === 200 || res.status === 201) return { done: true, fileId: doneFileId(res) };
      if (res.status === 308) return { offset: nextOffset(res.range) };
      if (res.status === 404 || res.status === 410) return { expired: true };
      return { error: res.status };
    });
  }

  function sendFile(file, uploadUrl, offset, onProgress) {
    var retries = 0;

    function step(pos) {
      if (pos >= file.size && file.size > 0) return askStatus(uploadUrl, file.size).then(afterStatus);
      var end = Math.min(pos + CHUNK, file.size);
      var range = 'bytes ' + pos + '-' + (end - 1) + '/' + file.size;
      return put(uploadUrl, file.slice(pos, end), range, function (loaded) { onProgress(pos + loaded); })
        .then(function (res) {
          if (res.status === 200 || res.status === 201) return doneFileId(res);
          if (res.status === 308) {
            retries = 0;
            onProgress(res.range ? nextOffset(res.range) : end);
            return step(res.range ? nextOffset(res.range) : end);
          }
          if (res.status === 404 || res.status === 410) throw new Error('EXPIRED');
          return retry();
        });
    }

    // 回線が切れたり Drive が 5xx を返したりしたら、少し待って受け取り済みの位置から続ける
    function retry() {
      retries++;
      if (retries > 8) throw new Error('送信に何度も失敗しました。回線を確かめて、もう一度「提出する」を押してください(続きから送ります)');
      onProgress(null, '通信が切れました。' + Math.min(60, 2 << retries) + '秒後にやり直します…');
      return sleep(Math.min(60, 2 << retries) * 1000)
        .then(function () { return askStatus(uploadUrl, file.size); })
        .then(afterStatus);
    }

    function afterStatus(st) {
      if (st.done) return st.fileId;
      if (st.expired) throw new Error('EXPIRED');
      if (st.error !== undefined) return retry();
      return step(st.offset);
    }

    return step(offset);
  }

  /* ------------------------------------------------------------ 提出 */

  function setBusy(on) {
    busy = on;
    submitButton.disabled = on;
    submitButton.textContent = on ? '送信中…' : '提出する';
    FIELDS.concat(['file', 'passcode']).forEach(function (id) { $(id).disabled = on; });
  }

  function showProgress(file) {
    var box = $('progress_box');
    var bar = $('progress');
    var text = $('progress_text');
    var started = Date.now();
    var startBytes = null;
    box.hidden = false;
    return function (bytes, message) {
      if (message) { text.textContent = message; return; }
      if (startBytes === null) startBytes = bytes;
      var pct = file.size ? Math.min(100, bytes / file.size * 100) : 100;
      bar.value = pct;
      var elapsed = (Date.now() - started) / 1000;
      var rate = elapsed > 2 ? (bytes - startBytes) / elapsed : 0;
      text.textContent = pct.toFixed(1) + '%  (' + fmtSize(bytes) + ' / ' + fmtSize(file.size) + ')  ' +
        (rate > 0 ? fmtTime((file.size - bytes) / rate) : '');
    };
  }

  function start(file, form) {
    return postJson('/works/start', form).then(function (json) {
      if (!json.ok) throw new Error(json.error || '受付できませんでした');
      saveResume(file, json.id, json.uploadUrl);
      return { id: json.id, uploadUrl: json.uploadUrl, offset: 0 };
    });
  }

  /** 前回の続きがあればそこから。無ければ新しく受付する */
  function openSession(file, form) {
    var saved = loadResume(file);
    if (!saved) return start(file, form);
    return askStatus(saved.uploadUrl, file.size).then(function (st) {
      if (st.expired || st.error !== undefined) { clearResume(); return start(file, form); }
      if (st.done) return { id: saved.id, uploadUrl: saved.uploadUrl, fileId: st.fileId };
      return { id: saved.id, uploadUrl: saved.uploadUrl, offset: st.offset, resumed: true };
    });
  }

  function onBeforeUnload(e) { e.preventDefault(); e.returnValue = ''; }

  submitButton.onclick = function () {
    if (busy) return;
    if (!config.ready) { say('error', '作品の受付はまだ始まっていません'); return; }

    var file = $('file').files[0];
    var form = { passcode: $('passcode').value };
    FIELDS.forEach(function (id) { form[id] = $(id).value.trim(); });

    if (!form.school) { say('error', '学校名を入れてください'); return; }
    if (!form.name) { say('error', 'お名前を入れてください'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { say('error', '連絡先メールアドレスを正しく入れてください'); return; }
    if (!form.title) { say('error', '作品名を入れてください'); return; }
    if (!file) { say('error', 'ファイルを選んでください'); return; }
    if (!file.size) { say('error', 'ファイルが空です'); return; }
    if (file.size > config.maxBytes) { say('error', 'ファイルが大きすぎます (' + fmtSize(config.maxBytes) + ' まで)'); return; }
    if (config.passcode && !form.passcode.trim()) { say('error', '受付コードを入れてください'); return; }

    form.fileName = file.name;
    form.size = file.size;
    form.mimeType = file.type || 'application/octet-stream';
    try { localStorage['WORKS_FORM'] = JSON.stringify({ school: form.school, name: form.name, email: form.email }); } catch (e) { /* 何もしない */ }

    notice.innerHTML = '';
    $('done_card').hidden = true;
    setBusy(true);
    window.addEventListener('beforeunload', onBeforeUnload);
    var progress = showProgress(file);
    progress(0);
    var session;

    function upload(s) {
      session = s;
      if (s.fileId) return s.fileId;
      if (s.resumed) progress(s.offset, '前回の続き (' + fmtSize(s.offset) + ') から送ります…');
      return sendFile(file, s.uploadUrl, s.offset, progress);
    }

    openSession(file, form)
      .then(upload)
      .catch(function (e) {
        // 1週間たって URL が切れていたら、受付からやり直す
        if (e.message !== 'EXPIRED') throw e;
        clearResume();
        return start(file, form).then(upload);
      })
      .then(function (fileId) {
        progress(null, '送信が終わりました。受付を確認しています…');
        return postJson('/works/finish', { id: session.id, fileId: fileId });
      })
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || '受付の確認に失敗しました');
        clearResume();
        $('progress').value = 100;
        $('progress_text').textContent = '完了しました。';
        notice.innerHTML = '';
        $('done_text').textContent = '「' + form.title + '」(' + file.name + ', ' + fmtSize(file.size) + ') を受け付けました。ありがとうございました。';
        $('done_card').hidden = false;
        $('done_card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        $('file').value = '';
        $('title').value = '';
      })
      .catch(function (e) {
        say('error', e.message || '送信に失敗しました');
      })
      .then(function () {
        setBusy(false);
        window.removeEventListener('beforeunload', onBeforeUnload);
      });
  };

  /* ------------------------------------------------------------ 初期化 */

  try {
    var saved = JSON.parse(localStorage['WORKS_FORM'] || 'null');
    if (saved) ['school', 'name', 'email'].forEach(function (id) { if (saved[id]) $(id).value = saved[id]; });
  } catch (e) { /* 何もしない */ }

  fetch('/works/config').then(function (r) { return r.json(); }).then(function (c) {
    config = c;
    $('max_size').textContent = fmtSize(c.maxBytes).replace('.00 ', '');
    $('passcode_field').hidden = !c.passcode;
    if (!c.ready) say('error', '作品の受付はまだ始まっていません。');
  });

})();
