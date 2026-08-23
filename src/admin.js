/**
 * 運営モードの鍵。
 *
 * 鍵は Wrangler の secret (ADMIN_KEY) に置く。
 *   npx wrangler secret put ADMIN_KEY
 *
 * 鍵を入れると Cookie にしるし(鍵から作った HMAC)を置き、以後はそれで通す。
 * 鍵そのものは Cookie に入れない。
 *
 * ADMIN_KEY が未設定のときは、localhost からの閲覧だけ運営モードを開く。
 * 手元で試すときに鍵を用意しなくて済むようにするため。公開環境では必ず設定すること。
 */

const COOKIE = 'chaser_admin';
const ONE_WEEK = 60 * 60 * 24 * 7;

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]+)').exec(cookie);
  return m ? decodeURIComponent(m[1]) : '';
}

export function isLocalhost(request) {
  const host = (request.headers.get('Host') || '').split(':')[0];
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/** 鍵が設定されているか */
export const hasAdminKey = (env) => typeof env.ADMIN_KEY === 'string' && env.ADMIN_KEY.length > 0;

/** この要求が運営として認められるか */
export async function isAdmin(request, env) {
  if (!hasAdminKey(env)) return isLocalhost(request);
  const token = readCookie(request, COOKIE);
  if (!token) return false;
  return token === await hmacHex(env.ADMIN_KEY, 'admin');
}

/**
 * 鍵を照合して、合っていれば Cookie を付けた応答を返す。
 * @returns {Response|null} 合っていなければ null
 */
export async function login(request, env, key) {
  if (!hasAdminKey(env)) return null;
  if (String(key || '') !== env.ADMIN_KEY) return null;

  const token = await hmacHex(env.ADMIN_KEY, 'admin');
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return new Response(null, {
    status: 204,
    headers: {
      'Set-Cookie': `${COOKIE}=${token}; Path=/; Max-Age=${ONE_WEEK}; HttpOnly; SameSite=Lax${secure}`,
    },
  });
}

export function logout() {
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` },
  });
}

/** データ要求に対する「権限がない」応答 */
export function forbidden() {
  return Response.json({ ok: false, error: '運営の鍵が必要です' }, { status: 403 });
}
