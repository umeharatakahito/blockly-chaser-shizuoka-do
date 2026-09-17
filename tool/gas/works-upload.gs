/**
 * U16作品部門の提出を受ける Apps Script。u16@sangi.jp で作る。
 *
 * ブロックリーチェイサーの Worker (src/works.js) から呼ばれ、
 *   start  : ドライブにアップロード枠を作り、ブラウザが直接送るための URL を返す
 *   finish : ファイルが届いたか確かめ、台帳のスプレッドシートに「完了」と書く
 * を行う。ファイル本体はこのスクリプトを通らない。
 *
 * 使い方は同じフォルダの README.md を参照。
 */

var FOLDER_NAME = 'U16作品部門 提出';
var SHEET_NAME = 'U16作品部門 提出台帳';
var HEADERS = ['受付日時', '受付ID', '学校名', 'お名前', '連絡先メール', '作品名', 'ファイル名', 'サイズ(バイト)', '状態', '完了日時', 'ドライブのリンク'];
var MAX_BYTES = 1024 * 1024 * 1024;

/** 最初に1回だけ、エディタから実行する。フォルダ・台帳・合言葉を用意して、ログに出す */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var folder = getFolder_();
  var sheet = getSheet_();
  if (!props.getProperty('SECRET')) {
    props.setProperty('SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  }
  // Drive API を呼ぶ権限をここで承認してもらう
  UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
  });
  Logger.log('保存先フォルダ: ' + folder.getUrl());
  Logger.log('台帳: ' + sheet.getParent().getUrl());
  Logger.log('WORKS_GAS_SECRET に設定する合言葉: ' + props.getProperty('SECRET'));
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: '要求が読めません' });
  }
  var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || req.secret !== secret) return json_({ ok: false, error: '合言葉が違います' });

  try {
    if (req.action === 'start') return json_(start_(req));
    if (req.action === 'finish') return json_(finish_(req));
    if (req.action === 'ping') return json_({ ok: true, folder: getFolder_().getUrl() });
    return json_({ ok: false, error: '不明な操作です' });
  } catch (err) {
    return json_({ ok: false, error: 'Apps Script でエラー: ' + err.message });
  }
}

/** ブラウザから開かれたとき用。動いているかだけ分かるようにする */
function doGet() {
  return ContentService.createTextOutput('U16作品部門 提出の受付スクリプトです。');
}

function start_(req) {
  var size = Number(req.size);
  if (!req.school || !req.name || !req.email || !req.title || !req.fileName) return { ok: false, error: '入力が足りません' };
  if (!(size > 0) || size > MAX_BYTES) return { ok: false, error: 'ファイルの大きさが範囲外です' };

  var id = Utilities.getUuid();
  var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd-HHmmss');
  var driveName = safeName_([req.school, req.name, req.title, stamp].join('_') + '_' + req.fileName);

  var res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size', {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'X-Upload-Content-Type': req.mimeType || 'application/octet-stream',
      'X-Upload-Content-Length': String(size),
      // この Origin からのブラウザにだけ、アップロード URL への送信 (CORS) が許される
      Origin: req.origin,
    },
    payload: JSON.stringify({
      name: driveName,
      parents: [getFolder_().getId()],
      description: '学校名: ' + req.school + '\nお名前: ' + req.name + '\n作品名: ' + req.title,
      appProperties: { submissionId: id },
    }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    return { ok: false, error: 'ドライブの受付に失敗しました (' + res.getResponseCode() + ')' };
  }
  var headers = res.getAllHeaders();
  var uploadUrl = headers.Location || headers.location;
  if (!uploadUrl) return { ok: false, error: 'アップロード先を受け取れませんでした' };

  withLock_(function () {
    getSheet_().appendRow([new Date(), id, req.school, req.name, req.email, req.title, req.fileName, size, '送信中', '', '']);
  });
  return { ok: true, id: id, uploadUrl: uploadUrl };
}

function finish_(req) {
  var res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(req.fileId) + '?fields=id,size,parents,appProperties,webViewLink',
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) return { ok: false, error: 'ドライブにファイルが見つかりません' };
  var file = JSON.parse(res.getContentText());
  var props = file.appProperties || {};
  if (props.submissionId !== req.id || (file.parents || []).indexOf(getFolder_().getId()) === -1) {
    return { ok: false, error: '提出の情報が一致しません' };
  }

  var found = withLock_(function () {
    var sheet = getSheet_();
    var last = sheet.getLastRow();
    if (last < 2) return false;
    var ids = sheet.getRange(2, 2, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][0] === req.id) {
        sheet.getRange(i + 2, 8, 1, 4).setValues([[Number(file.size), '完了', new Date(), file.webViewLink]]);
        return true;
      }
    }
    return false;
  });
  if (!found) return { ok: false, error: '台帳に受付の記録がありません' };
  return { ok: true, size: Number(file.size) };
}

/* ------------------------------------------------------------ 下回り */

function getFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  var folder = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

function getSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id).getSheets()[0];
  var ss = SpreadsheetApp.create(SHEET_NAME);
  var sheet = ss.getSheets()[0];
  sheet.appendRow(HEADERS);
  sheet.setFrozenRows(1);
  DriveApp.getFileById(ss.getId()).moveTo(getFolder_());
  props.setProperty('SHEET_ID', ss.getId());
  return sheet;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** ドライブのファイル名に使えない文字を置き換える */
function safeName_(name) {
  return String(name).replace(/[\\/:*?"<>|\r\n\t]/g, '_').slice(0, 250);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
