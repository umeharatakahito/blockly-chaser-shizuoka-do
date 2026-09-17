/**
 * u16@sangi.jp の Apps Script (tool/gas/works-upload.gs) を呼ぶ。
 * 作品部門の提出と、プログラム部門のドライブへの書き出しで使う。
 *
 *   npx wrangler secret put WORKS_GAS_URL
 *   npx wrangler secret put WORKS_GAS_SECRET
 */

export const gasReady = (env) => Boolean(env.WORKS_GAS_URL && env.WORKS_GAS_SECRET);

/** Apps Script は 302 で結果のページへ飛ばすので、そのまま追う */
export async function callGas(env, payload) {
  if (!gasReady(env)) return { ok: false, error: 'Apps Script が未設定です' };
  const res = await fetch(String(env.WORKS_GAS_URL).trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, secret: env.WORKS_GAS_SECRET }),
    redirect: 'follow',
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // 権限の設定が違うと、ログイン画面や「承認が必要です」の HTML が返ってくる
    const title = (/<title>([^<]*)<\/title>/i.exec(text) || [])[1] || '';
    console.log('GAS non-JSON', payload.action, res.status, res.url.replace(/\/s\/[^/]+/, '/s/…'), text.slice(0, 500));
    return {
      ok: false,
      error: `Apps Script から正しい応答がありません (${payload.action}, ${res.status}${title ? ', ' + title : ''})。公開設定(全員がアクセス可)を確認してください`,
    };
  }
}

/** ファイルの中身を JSON で送るための変換。大きな配列を一度に広げるとスタックが溢れるので区切る */
export function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
