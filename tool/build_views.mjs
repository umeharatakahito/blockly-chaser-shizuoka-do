/**
 * EJS のビューを静的な HTML に変換する。
 *
 * Workers では EJS のサーバーサイド描画ができないため、ビルド時に済ませる。
 * 言語ごとに別ファイルを出し、実行時は Worker が Cookie を見て振り分ける。
 *
 *   node tool/build_views.mjs
 *
 * 出力先は public/pages/<言語>/<名前>.html
 * チュートリアルはステージごとに1ページずつ作る。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const viewsDir = path.join(root, 'views');
const outRoot = path.join(root, 'public', 'pages');

const LANGS = ['ja', 'ja-k'];

/** language/<lng>/<name>.json を読む。無ければ空 */
function lang(lng, name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'language', lng, name + '.json'), 'utf8'));
  } catch (e) {
    return {};
  }
}

/** 画面ごとの、言語ファイルと画面名の対応 */
const PAGES = [
  { view: 'index', lngFile: 'index', title: { ja: 'メニュー', 'ja-k': 'メニュー' } },
  { view: 'menu-tutorial', lngFile: 'menu-tutorial', title: { ja: 'ステージ選択', 'ja-k': 'ステージせんたく' } },
  { view: 'menu-programming', lngFile: 'menu-programming', title: { ja: 'データ選択', 'ja-k': 'データせんたく' } },
  { view: 'menu-programming-exp', lngFile: 'menu-programming', title: { ja: 'データ選択', 'ja-k': 'データせんたく' } },
  { view: 'menu-match', lngFile: 'menu-watching', title: { ja: 'ルーム選択', 'ja-k': 'ルームせんたく' } },
  { view: 'programming', lngFile: 'programming', title: { ja: 'プログラミング', 'ja-k': 'プログラミング' } },
  { view: 'programming-exp', lngFile: 'programming', title: { ja: 'プログラミング', 'ja-k': 'プログラミング' } },
  { view: 'match', lngFile: null, title: { ja: '対戦', 'ja-k': 'たいせん' } },
  { view: 'match-cpu', lngFile: null, title: { ja: '対戦', 'ja-k': 'たいせん' } },
  { view: 'match-player', lngFile: null, title: { ja: '対戦', 'ja-k': 'たいせん' } },
  { view: 'watching', lngFile: null, title: { ja: '観戦', 'ja-k': 'かんせん' } },
  { view: 'tournament', lngFile: null, title: { ja: '対戦表', 'ja-k': 'たいせんひょう' } },
  { view: 'tournament-admin', lngFile: null, title: { ja: 'トーナメントの管理', 'ja-k': 'トーナメントのかんり' } },
  { view: 'movies', lngFile: null, title: { ja: '動画一覧', 'ja-k': 'どうがいちらん' } },
  { view: 'movie-player', lngFile: null, title: { ja: '試合動画', 'ja-k': 'しあいどうが' } },
  { view: 'movies-admin', lngFile: null, title: { ja: '試合動画の管理', 'ja-k': 'しあいどうがのかんり' } },
];

/**
 * Socket.IO のクライアントを、こちらのシムに差し替える。
 * ビュー側の記述は本家のまま残しておきたいので、出力の段階で置き換える。
 */
function swapSocketClient(html) {
  return html.replace(
    /<script src=["']\/socket\.io\/socket\.io\.js["']><\/script>/g,
    '<script src="/javascripts/socket-shim.js"></script>'
  );
}

let written = 0;

function render(view, data, outPath) {
  const html = ejs.render(
    fs.readFileSync(path.join(viewsDir, view + '.ejs'), 'utf8'),
    data,
    { filename: path.join(viewsDir, view + '.ejs') }
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, swapSocketClient(html), 'utf8');
  written++;
}

for (const lng of LANGS) {
  const configLng = lang(lng, 'config');

  for (const page of PAGES) {
    const data = {
      title: page.title[lng],
      LNG: page.lngFile ? lang(lng, page.lngFile) : configLng,
      C_LNG: configLng,
    };

    try {
      render(page.view, data, path.join(outRoot, lng, page.view + '.html'));
    } catch (e) {
      console.error(`✗ ${lng}/${page.view}: ${e.message}`);
      process.exitCode = 1;
    }
  }

  // チュートリアルはステージごとに1ページ
  const tutorial = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'tutorial.json'), 'utf8'));
  for (const [stage, stagedata] of Object.entries(tutorial.tutorial)) {
    const xmlKey = String(stagedata.workspace_xml ?? '');
    try {
      render('tutorial', {
        title: stagedata.name,
        stagedata,
        blockly_xml: tutorial.workspace[xmlKey] ?? '',
        LNG: lang(lng, 'programming'),
        C_LNG: configLng,
      }, path.join(outRoot, lng, 'tutorial', stage + '.html'));
    } catch (e) {
      console.error(`✗ ${lng}/tutorial/${stage}: ${e.message}`);
      process.exitCode = 1;
    }
  }
}

console.log(`${written} ページを書き出しました → public/pages/`);
