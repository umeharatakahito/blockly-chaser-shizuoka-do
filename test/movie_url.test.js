import test from 'node:test';
import assert from 'node:assert';

import { parseMovieUrl, SUPPORTED_LABELS } from '../src/movies/url.js';

/* --- YouTube --- */

test('YouTube の各種URLから埋め込み先を作る', () => {
  const cases = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
  ];
  for (const url of cases) {
    const r = parseMovieUrl(url);
    assert.ok(r, url + ' を判定できません');
    assert.strictEqual(r.kind, 'youtube');
    assert.strictEqual(r.src, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', url);
  }
});

test('YouTube は nocookie ドメインで埋め込む', () => {
  // 参加者が中学生なので、追跡の少ないほうを既定にする
  assert.match(parseMovieUrl('https://youtu.be/abc').src, /youtube-nocookie\.com/);
});

/* --- その他のサービス --- */

test('Google ドライブの共有URLを判定する', () => {
  const r = parseMovieUrl('https://drive.google.com/file/d/1AbCdEf/view?usp=sharing');
  assert.strictEqual(r.kind, 'drive');
  assert.strictEqual(r.src, 'https://drive.google.com/file/d/1AbCdEf/preview');
});

test('Google ドライブの id 指定も判定する', () => {
  const r = parseMovieUrl('https://drive.google.com/open?id=1AbCdEf');
  assert.strictEqual(r.kind, 'drive');
});

test('Vimeo を判定する', () => {
  const r = parseMovieUrl('https://vimeo.com/123456789');
  assert.strictEqual(r.kind, 'vimeo');
  assert.strictEqual(r.src, 'https://player.vimeo.com/video/123456789');
});

test('動画ファイルへの直リンクを判定する', () => {
  for (const ext of ['mp4', 'webm', 'm4v', 'MP4']) {
    const r = parseMovieUrl('https://example.com/final.' + ext);
    assert.ok(r, ext + ' を判定できません');
    assert.strictEqual(r.kind, 'file');
  }
});

/* --- 受け付けないもの --- */

test('対応していないURLは null を返す', () => {
  const cases = [
    'https://example.com/notavideo',
    'https://example.com/page.html',
    'https://niconico.jp/watch/sm123',
    '',
    null,
    undefined,
    'ただの文字列',
  ];
  for (const url of cases) {
    assert.strictEqual(parseMovieUrl(url), null, String(url) + ' が通ってしまいます');
  }
});

test('javascript: を弾く', () => {
  // 運営しか登録しない想定だが、埋め込み先になる値なので念のため塞ぐ
  assert.strictEqual(parseMovieUrl('javascript:alert(1)'), null);
  assert.strictEqual(parseMovieUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.strictEqual(parseMovieUrl('file:///etc/passwd'), null);
});

test('YouTube に似せた別ドメインを弾く', () => {
  assert.strictEqual(parseMovieUrl('https://youtube.com.evil.example/watch?v=abc'), null);
  assert.strictEqual(parseMovieUrl('https://notyoutube.com/watch?v=abc'), null);
});

test('動画IDはURLエンコードされる', () => {
  const r = parseMovieUrl('https://youtu.be/ab%22cd');
  assert.ok(r);
  assert.ok(!r.src.includes('"'), '引用符がそのまま埋め込み先に入っています: ' + r.src);
});

/* --- 案内文 --- */

test('対応サービスの一覧が案内に使える', () => {
  assert.ok(SUPPORTED_LABELS.includes('YouTube'));
  assert.ok(SUPPORTED_LABELS.length >= 4);
});
