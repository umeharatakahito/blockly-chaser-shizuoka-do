import test from 'node:test';
import assert from 'node:assert';
import { checkName, autoName, normalizeForCheck } from '../src/names.js';

const bad = (name) => assert.strictEqual(checkName(name).ok, false, `${name} を通してしまいました`);
const good = (name) => assert.strictEqual(checkName(name).ok, true, `${name} をはじいてしまいました: ${checkName(name).reason}`);

test('ふつうの名前は通る', () => {
  for (const n of ['ゆうき', 'たろう', 'Taro', 'チーム静岡', 'あおい#1', 'よしねこ', 'ちょんまげ', 'class', 'Sussex', 'analysis', 'peacock', 'せいしん', 'おおきなカワウソ #0123']) good(n);
});

test('卑猥な語を含む名前ははじく', () => {
  for (const n of ['ちんこ', 'チンコ', 'ちんこマン', 'マンコ', 'おっぱい', 'うんこ', 'fuck', 'FUCK', 'shithead', 'penis', 'chinko']) bad(n);
});

test('表記ゆれで抜けられない', () => {
  for (const n of ['ち ん こ', 'ち・ん・こ', 'ﾁﾝｺ', 'ちんんんこ', 'ちんこー', 'f u c k', 'fuuuck', 'ｆｕｃｋ', 'sh1t', 'p3nis', 'ゔんこ', 'ヂンコ']) bad(n);
});

test('短い英単語は語としての一致だけ見る', () => {
  bad('ass');
  bad('Ass Man');
  bad('sex');
  good('Cassandra');
  good('Essex');
});

test('空や長すぎる名前ははじく', () => {
  bad('');
  bad('   ');
  bad('あ'.repeat(21));
  good('あ'.repeat(20));
});

test('正規化はカタカナ・全角・濁点を潰す', () => {
  assert.strictEqual(normalizeForCheck('ガギグ'), 'かきく');
  assert.strictEqual(normalizeForCheck('ＡＢＣ'), 'abc');
  assert.strictEqual(normalizeForCheck('ちっちゃい'), 'ちつちやい');
});

test('自動の名前は毎回それらしく、検査を通る', () => {
  let seed = 1;
  const rng = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 50; i++) {
    const n = autoName(rng);
    assert.match(n, /^.+ #\d{4}$/);
    good(n);
  }
});
