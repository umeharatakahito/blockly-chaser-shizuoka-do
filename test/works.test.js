import test from 'node:test';
import assert from 'node:assert';
import { checkWorkRequest, MAX_WORK_BYTES } from '../src/works.js';
import { toBase64 } from '../src/gas.js';

const base = { school: '静岡中学校', name: 'しずおか たろう', email: 'taro@example.jp', title: 'ぼくのゲーム', fileName: 'game.zip', size: 1234 };

test('そろった申し込みは通り、空白は詰める', () => {
  const r = checkWorkRequest({ ...base, school: '  静岡中学校 ' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.school, '静岡中学校');
  assert.strictEqual(r.value.mimeType, 'application/octet-stream');
});

test('必須の項目が欠けたらはじく', () => {
  for (const key of ['school', 'name', 'email', 'title', 'fileName']) {
    assert.strictEqual(checkWorkRequest({ ...base, [key]: ' ' }).ok, false, key);
  }
  assert.strictEqual(checkWorkRequest({ ...base, email: 'taro@example' }).ok, false);
});

test('大きさは 1B〜1GB', () => {
  assert.strictEqual(checkWorkRequest({ ...base, size: 0 }).ok, false);
  assert.strictEqual(checkWorkRequest({ ...base, size: 'abc' }).ok, false);
  assert.strictEqual(checkWorkRequest({ ...base, size: MAX_WORK_BYTES }).ok, true);
  assert.strictEqual(checkWorkRequest({ ...base, size: MAX_WORK_BYTES + 1 }).ok, false);
});

test('プログラムの中身を Base64 にできる (1MB でも溢れない)', () => {
  const bytes = new Uint8Array(1024 * 1024 + 3).map((_, i) => i % 256);
  assert.strictEqual(toBase64(bytes), Buffer.from(bytes).toString('base64'));
  assert.strictEqual(toBase64(new Uint8Array(0)), '');
});
