# blockly-chaser-shizuoka-do

Blockly CHaser サーバーの **Cloudflare Durable Objects 版**。

**デプロイ済み**: https://blockly-chaser-shizuoka-do.blockly-chaser-shizuoka-do.workers.dev

大会本番で使うのは Node 版の
[blockly-chaser-shizuoka](https://github.com/umeharatakahito/blockly-chaser-shizuoka) です。
こちらは第2案として、Cloudflare 側でサーバーを動かす形を試しているものです。

## なぜ作ったか

Node 版は「サーバーを常時動かしておく」前提です。会場LANでは理想的ですが、
事前練習のためにインターネットへ出そうとすると置き場所が要ります。
無料の選択肢を調べたところ、この用途にはどれも足りませんでした。

| 方法 | 問題 |
|---|---|
| Cloudflare Tunnel | Mac を起動し続ける必要がある |
| ngrok 無料 | 月20,000リクエスト。**1画面40リクエストなので月500表示で枯渇** |
| GCP 無料枠 | 下り月1GB。**1画面2.62MB なので月390表示で枯渇**。外部IPも有料 |

Durable Objects なら Cloudflare 側で動くため機材に依存せず、
無料枠もこの用途には余裕があります。

| 項目 | 無料枠 | この用途 |
|---|---|---|
| リクエスト | 10万/日 | 1画面40リクエスト → **1日2,500画面表示** |
| WebSocket 受信 | 20通で1リクエスト換算 | 試合中の通信はほぼ無視できる |
| SQLite | 書き込み10万行/日・保存は無課金 | 桁違いに余裕 |
| 静的ファイル | 実質無制限 | Blockly の 4.8MB もここ |

無料プランで作れるのは **SQLite バックエンドの Durable Objects のみ**です。
`wrangler.jsonc` の migration は `new_sqlite_classes` を使っています。

## 動くもの

本番の Cloudflare で確認済みです。

- [x] メニュー・チュートリアル・プログラミング(初級/上級)・対戦・観戦の各画面
- [x] Blockly でブロックを組んでプログラムを実行し、CPU と対戦できる
- [x] 全28ルーム(固定盤面・手続き生成・ランダム配置)
- [x] CPU レベル0〜2
- [x] 合言葉つきルーム
- [x] 対戦表と、試合結果の自動記録
- [ ] 試合動画 — **R2 の有効化待ち**(下記)

## 構成

```
Workers Assets   静的ファイル(Blockly・CSS・画像・書き出した画面)
Worker           ルーティング。状態は持たない
MatchRoom (DO)   対戦ルーム1つにつき1インスタンス。盤面・スコア・WebSocket
TournamentStore  対戦表と試合結果。大会に1つ
MovieStore       動画の目録。実体は R2
```

Node 版が `server_store[room_id]` に持っていた状態が、そのまま
「ルームIDで選ばれる Durable Object」に対応します。
使っていないルームは WebSocket hibernation で眠り、接続を保ったまま課金対象から外れます。

### 移植で難しかったところ

**タイマー** — Durable Objects のアラームは1オブジェクトに1つだけです。
Node 版は `setTimeout` を14箇所で使っているため、そのままでは移せません。
`src/timers.js` が予定を SQLite に並べ、最も早いものだけをアラームに設定し、
鳴ったら残りを設定し直します。

**Socket.IO** — サーバーは Workers で動きません。
ただしクライアントは `socket.emit` / `socket.on` を49箇所で使っており、
書き換えると練習環境との差が大きくなります。
`public/javascripts/socket-shim.js` が同じ形の窓口を生の WebSocket の上に用意し、
Durable Object 側も本家と同じイベント名で話すようにしてあります。

**EJS** — Workers ではサーバーサイド描画ができないため、
`tool/build_views.mjs` がビルド時に言語ごとの静的 HTML へ変換します(88ページ)。
対戦表や動画一覧など動的な部分は、ブラウザ側で組み立てます。

**セル値** — `1` がブロック、`2` がアイテムで直感と逆です。
Node 版で実際に受け取った9マスの値をテストに埋め込み、移植したエンジンが
同じ値を返すことを確認しています。

## 動かす

```bash
npm install
npm run dev        # 画面を書き出してから wrangler dev
```

別のターミナルで:

```bash
node tool/check.mjs               # 骨組み(ルーム分離・WebSocket・タイマー)
node tool/play.mjs                # CPU と1試合戦う
node --test                       # 単体テスト
```

## デプロイ

```bash
npm run deploy
```

初回のみログインが必要です。

```bash
npx wrangler login
```

## 試合動画を有効にする

動画の保存に R2 を使います。**まだ有効になっていません。**

1. [Cloudflare ダッシュボード](https://dash.cloudflare.com/) → 左メニューの **R2** → **Enable R2**
   （無料枠は保存10GB・下り無料。有効化には支払い方法の登録が要りますが、
   無料枠に収まっていれば課金されません）
2. 次を実行する

```bash
./tool/enable_movies.sh
```

バケットの作成、設定の書き換え、デプロイまで行います。

有効になるまでの間、`/movies` は「準備中」と表示されます。画面は壊れません。

## 残っていること

- 対人対戦(room_1xx)は、いまは1人でも試合が始まる。2人が揃うのを待つ作りにする
- 観戦機能
- 運営ページの権限(Node 版の ADMIN_KEY にあたるもの)
- 参加者の `.blch` が問題なく読めるかの確認

## 移植で失われるもの

Socket.IO を生の WebSocket に変えたため、通信の実装は練習環境と別物です。
Node 版は「練習環境と1バイトも違わない」ことを保証できていますが、
こちらではそれが成り立ちません。**大会本番に使う場合は、参加者の
`.blch` が問題なく読めるかを別途確認する必要があります。**
