/**
 * 動画URLの判定。
 *
 * 動画そのものはこちらで預からず、YouTube などに置いてもらって URL だけを保存する。
 * R2 を使わずに済み、Cloudflare 側にクレジットカードを登録する必要もない。
 *
 * 埋め込み先は決まったサービスだけに限る。
 * 任意のURLを iframe に入れると、運営以外が登録できるようになったときに
 * 何でも埋め込める穴になるため。
 */

/** 対応するサービスと、埋め込み用URLの作り方 */
const PROVIDERS = [
  {
    kind: 'youtube',
    label: 'YouTube',
    // youtu.be/xxxx  youtube.com/watch?v=xxxx  /embed/xxxx  /live/xxxx  /shorts/xxxx
    match: (u) => {
      if (/^(www\.)?youtu\.be$/.test(u.hostname)) return u.pathname.slice(1) || null;
      if (!/^(www\.|m\.)?youtube(-nocookie)?\.com$/.test(u.hostname)) return null;
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = /^\/(embed|live|shorts|v)\/([^/]+)/.exec(u.pathname);
      return m ? m[2] : null;
    },
    embed: (id) => 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id),
  },
  {
    kind: 'drive',
    label: 'Google ドライブ',
    match: (u) => {
      if (u.hostname !== 'drive.google.com') return null;
      const m = /^\/file\/d\/([^/]+)/.exec(u.pathname);
      return m ? m[1] : u.searchParams.get('id');
    },
    embed: (id) => 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/preview',
  },
  {
    kind: 'vimeo',
    label: 'Vimeo',
    match: (u) => {
      if (!/^(www\.)?vimeo\.com$/.test(u.hostname)) return null;
      const m = /^\/(\d+)/.exec(u.pathname);
      return m ? m[1] : null;
    },
    embed: (id) => 'https://player.vimeo.com/video/' + encodeURIComponent(id),
  },
];

/** ブラウザの <video> がそのまま再生できる形式 */
const VIDEO_EXT = /\.(mp4|webm|m4v)$/i;

/**
 * URL を判定する。
 *
 * @returns {{kind: string, label: string, src: string}|null}
 *          kind が 'file' なら <video> で、それ以外は iframe で再生する。
 *          対応していない URL は null
 */
export function parseMovieUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  let u;
  try {
    u = new URL(text);
  } catch (e) {
    return null;
  }

  // http/https 以外は受け付けない。javascript: などを弾く
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;

  for (const provider of PROVIDERS) {
    const id = provider.match(u);
    if (id) return { kind: provider.kind, label: provider.label, src: provider.embed(id) };
  }

  if (VIDEO_EXT.test(u.pathname)) {
    return { kind: 'file', label: '動画ファイル', src: u.toString() };
  }

  return null;
}

/** 対応しているサービスの名前。案内文に使う */
export const SUPPORTED_LABELS = PROVIDERS.map((p) => p.label).concat('mp4 / webm への直リンク');
