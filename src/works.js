/**
 * 作品部門の提出。
 *
 * ファイルは PC で作ったものなら何でもよく、1GB 近くになることもある。
 * Worker や Apps Script を通すと大きさの上限に当たるので、ファイル本体は
 * ブラウザから Google ドライブへ直接、分割して送る(Drive の再開可能アップロード)。
 *
 *   ブラウザ ─ /works/start ─→ Worker ─→ Apps Script (u16@sangi.jp として実行)
 *                                           └ Drive にアップロード枠を作り、URL を返す
 *   ブラウザ ─ PUT (分割) ────────────────→ Google ドライブ
 *   ブラウザ ─ /works/finish ─→ Worker ─→ Apps Script
 *                                           └ ファイルが届いたか確かめ、台帳に「完了」と書く
 *
 * Apps Script の URL と合言葉は secret に置く。画面には出さない。
 *   npx wrangler secret put WORKS_GAS_URL
 *   npx wrangler secret put WORKS_GAS_SECRET
 * 参加者に受付コードを配るときだけ、次も設定する(未設定なら誰でも出せる)。
 *   npx wrangler secret put WORKS_PASSCODE
 *
 * 連絡先メールは Apps Script 側の台帳にだけ残し、Durable Object には入れない。
 * Apps Script のコードは tool/gas/ にある。
 */

import { callGas, gasReady } from './gas.js';

/** 1ファイルの上限。Drive 自体は 5TB まで受けるが、回線と時間を考えてここで止める */
export const MAX_WORK_BYTES = 1024 ** 3;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clip(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

/**
 * 提出の申し込みを確かめる。
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function checkWorkRequest(body) {
  const value = {
    school: clip(body.school, 60),
    name: clip(body.name, 40),
    email: clip(body.email, 120),
    title: clip(body.title, 80),
    fileName: clip(body.fileName, 200),
    size: Number(body.size),
    mimeType: clip(body.mimeType, 120) || 'application/octet-stream',
  };
  if (!value.school) return { ok: false, error: '学校名を入れてください' };
  if (!value.name) return { ok: false, error: 'お名前を入れてください' };
  if (!EMAIL_RE.test(value.email)) return { ok: false, error: '連絡先メールアドレスを正しく入れてください' };
  if (!value.title) return { ok: false, error: '作品名を入れてください' };
  if (!value.fileName) return { ok: false, error: 'ファイルを選んでください' };
  if (!Number.isSafeInteger(value.size) || value.size <= 0) return { ok: false, error: 'ファイルが空です' };
  if (value.size > MAX_WORK_BYTES) return { ok: false, error: 'ファイルが大きすぎます (1GB まで)' };
  return { ok: true, value };
}

export const worksReady = gasReady;

/**
 * 運営向けの診断。Apps Script が JSON を返さないときに、どこで止まっているかを見る。
 * URL の中身(デプロイ ID)は伏せて返す
 */
export async function checkGas(env) {
  if (!worksReady(env)) return { ok: false, error: 'WORKS_GAS_URL か WORKS_GAS_SECRET が未設定です' };
  const mask = (u) => String(u).replace(/\/s\/[^/]+/, '/s/…').replace(/\?.*$/, '');
  const configured = String(env.WORKS_GAS_URL).trim();
  const report = {
    configuredUrl: mask(configured),
    looksLikeExec: /^https:\/\/script\.google\.com\/(a\/macros\/[^/]+|macros)\/s\/[^/]+\/exec$/.test(configured),
    hasSpaces: configured !== env.WORKS_GAS_URL,
  };
  try {
    const res = await fetch(configured, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ping', secret: env.WORKS_GAS_SECRET }),
      redirect: 'follow',
    });
    const text = await res.text();
    report.status = res.status;
    report.finalUrl = mask(res.url);
    report.contentType = res.headers.get('Content-Type');
    report.title = (/<title>([^<]*)<\/title>/i.exec(text) || [])[1] || '';
    try {
      report.json = JSON.parse(text);
    } catch {
      report.snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    }
  } catch (e) {
    report.fetchError = String(e && e.message);
  }
  return report;
}

function records(env) {
  return env.RECORDS.get(env.RECORDS.idFromName('main'));
}

function toRecords(env, path, body) {
  return records(env).fetch(new Request('https://records' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

/** /works/start と /works/finish */
export async function handleWorks(request, env, path) {
  if (!worksReady(env)) {
    return Response.json({ ok: false, error: '作品の受付はまだ始まっていません' }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));

  if (path === '/works/start') {
    if (env.WORKS_PASSCODE && String(body.passcode || '').trim() !== env.WORKS_PASSCODE) {
      return Response.json({ ok: false, error: '受付コードが違います' }, { status: 403 });
    }
    const checked = checkWorkRequest(body);
    if (!checked.ok) return Response.json(checked, { status: 400 });

    const w = checked.value;
    // Drive はアップロード枠を作った要求の Origin に対してだけ CORS を許す
    const origin = new URL(request.url).origin;
    const gas = await callGas(env, { action: 'start', origin, ...w });
    if (!gas.ok) return Response.json({ ok: false, error: gas.error || '受付に失敗しました' }, { status: 502 });

    const { email, mimeType, ...listed } = w;
    await toRecords(env, '/works/add', { id: gas.id, ...listed });
    return Response.json({ ok: true, id: gas.id, uploadUrl: gas.uploadUrl });
  }

  if (path === '/works/finish') {
    const id = clip(body.id, 64);
    const fileId = clip(body.fileId, 128);
    if (!id || !fileId) return Response.json({ ok: false, error: '提出の情報が足りません' }, { status: 400 });

    const gas = await callGas(env, { action: 'finish', id, fileId });
    if (!gas.ok) return Response.json({ ok: false, error: gas.error || '完了の確認に失敗しました' }, { status: 502 });

    await toRecords(env, '/works/done', { id, fileId, size: gas.size });
    return Response.json({ ok: true, size: gas.size });
  }

  return new Response('Not Found', { status: 404 });
}
