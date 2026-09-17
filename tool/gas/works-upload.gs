/**
 * U16静岡大会の提出をドライブに整理する Apps Script。u16@sangi.jp で作る。
 *
 * ブロックリーチェイサーの Worker から呼ばれる。
 *
 * 作品部門 (src/works.js)。保存先は「U16作品部門 提出」フォルダ
 *   start  : ドライブにアップロード枠を作り、ブラウザが直接送るための URL を返す
 *   finish : ファイルが届いたか確かめ、台帳のスプレッドシートに「完了」と書く
 *   ファイル本体はこのスクリプトを通らない。
 *
 * プログラム部門 (src/records_do.js)。保存先は「U16プログラム部門」フォルダ
 *   entry          : エントリー台帳に1行書く(同じ受付IDがあれば書き換える)
 *   program        : 提出された .blch を「提出プログラム」フォルダに保存し、台帳に書く
 *   program-status : 提出プログラム台帳の状態を書き換える(運営が削除したときなど)
 *
 * 使い方は同じフォルダの README.md を参照。
 */

var FOLDER_NAME = 'U16作品部門 提出';
var SHEET_NAME = 'U16作品部門 提出台帳';
var HEADERS = ['受付日時', '受付ID', '学校名', 'お名前', '連絡先メール', '作品名', 'ファイル名', 'サイズ(バイト)', '状態', '完了日時', 'ドライブのリンク'];
var MAX_BYTES = 1024 * 1024 * 1024;

var PROGRAM_FOLDER_NAME = 'U16プログラム部門';
var PROGRAM_FILES_NAME = '提出プログラム';
var ENTRY_SHEET_NAME = 'U16プログラム部門 エントリー台帳';
var ENTRY_HEADERS = ['受付ID', 'エントリー日時', '選手名', '学校・所属', '学年', '運営への連絡', '状態', '更新日時'];
var PROGRAM_SHEET_NAME = 'U16プログラム部門 提出プログラム台帳';
var PROGRAM_HEADERS = ['受付ID', '提出日時', '選手名', '元のファイル名', 'サイズ(バイト)', 'メモ', '状態', 'ドライブのリンク'];

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
  var programFolder = getProgramFolder_();
  getProgramFiles_();
  getEntrySheet_();
  getProgramSheet_();
  Logger.log('プログラム部門のフォルダ: ' + programFolder.getUrl());
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
    if (req.action === 'entry') return json_(entry_(req));
    if (req.action === 'program') return json_(program_(req));
    if (req.action === 'program-status') return json_(programStatus_(req));
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

/* ------------------------------------------------------------ プログラム部門 */

function entry_(req) {
  if (!req.id) return { ok: false, error: '受付IDがありません' };
  return withLock_(function () {
    var sheet = getEntrySheet_();
    var row = findRow_(sheet, req.id);
    if (!row) {
      // 台帳にないものの「削除」は何もしない
      if (req.name === undefined) return { ok: true };
      sheet.appendRow([req.id, toDate_(req.createdAt), req.name, req.school, req.grade, req.note, req.status, new Date()]);
      return { ok: true };
    }
    if (req.name === undefined) {
      sheet.getRange(row, 7, 1, 2).setValues([[req.status, new Date()]]);
    } else {
      sheet.getRange(row, 3, 1, 6).setValues([[req.name, req.school, req.grade, req.note, req.status, new Date()]]);
    }
    return { ok: true };
  });
}

function program_(req) {
  if (!req.id || !req.content) return { ok: false, error: 'プログラムの中身がありません' };
  return withLock_(function () {
    var sheet = getProgramSheet_();
    // 送り直しで二重にならないようにする
    if (findRow_(sheet, req.id)) return { ok: true, duplicate: true };
    var stamp = Utilities.formatDate(toDate_(req.createdAt), 'Asia/Tokyo', 'yyyyMMdd-HHmmss');
    var ext = (/\.[A-Za-z0-9]+$/.exec(req.fileName || '') || ['.blch'])[0];
    var blob = Utilities.newBlob(Utilities.base64Decode(req.content), 'application/octet-stream', safeName_(req.entryName + '_' + stamp + ext));
    var file = getProgramFiles_().createFile(blob);
    file.setDescription('選手名: ' + req.entryName + '\n元のファイル名: ' + req.fileName + (req.note ? '\nメモ: ' + req.note : ''));
    sheet.appendRow([req.id, toDate_(req.createdAt), req.entryName, req.fileName, Number(req.size), req.note, '有効', file.getUrl()]);
    return { ok: true };
  });
}

function programStatus_(req) {
  return withLock_(function () {
    var sheet = getProgramSheet_();
    var row = findRow_(sheet, req.id);
    if (row) sheet.getRange(row, 7).setValue(req.status);
    return { ok: true };
  });
}

/** 1列目が id の行番号。無ければ 0 */
function findRow_(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2;
  }
  return 0;
}

function toDate_(iso) {
  var d = new Date(iso);
  return isNaN(d.getTime()) ? new Date() : d;
}

function getProgramFolder_() {
  return getOrCreateFolder_('PROGRAM_FOLDER_ID', PROGRAM_FOLDER_NAME, null);
}

function getProgramFiles_() {
  return getOrCreateFolder_('PROGRAM_FILES_ID', PROGRAM_FILES_NAME, getProgramFolder_());
}

function getEntrySheet_() {
  return getOrCreateSheet_('ENTRY_SHEET_ID', ENTRY_SHEET_NAME, ENTRY_HEADERS, getProgramFolder_());
}

function getProgramSheet_() {
  return getOrCreateSheet_('PROGRAM_SHEET_ID', PROGRAM_SHEET_NAME, PROGRAM_HEADERS, getProgramFolder_());
}

/* ------------------------------------------------------------ 下回り */

function getOrCreateFolder_(prop, name, parent) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(prop);
  if (id) return DriveApp.getFolderById(id);
  var folder = parent ? parent.createFolder(name) : DriveApp.createFolder(name);
  props.setProperty(prop, folder.getId());
  return folder;
}

function getOrCreateSheet_(prop, name, headers, folder) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(prop);
  if (id) return SpreadsheetApp.openById(id).getSheets()[0];
  var ss = SpreadsheetApp.create(name);
  var sheet = ss.getSheets()[0];
  sheet.appendRow(headers);
  sheet.setFrozenRows(1);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  props.setProperty(prop, ss.getId());
  return sheet;
}

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
