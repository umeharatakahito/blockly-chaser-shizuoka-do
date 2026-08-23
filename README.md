# blockly-chaser-shizuoka-do

Blockly CHaser サーバーを **Cloudflare Durable Objects** で動かす版。**検証段階です。**

**デプロイ済み**: https://blockly-chaser-shizuoka-do.blockly-chaser-shizuoka-do.workers.dev

大会本番で使うのは Node 版の
[blockly-chaser-shizuoka](https://github.com/umeharatakahito/blockly-chaser-shizuoka) です。
こちらはそれとは別の第2案として、独立したリポジトリで進めます。

## なぜ別に作るのか

Node 版は「サーバーを常時動かしておく」前提の作りです。会場LANでは理想的ですが、
事前練習のためにインターネットへ出そうとすると、置き場所の問題が出ます。

| 方法 | 問題 |
|---|---|
| Cloudflare Tunnel | Mac を起動し続ける必要がある。落ちるとサイトも落ちる |
| ngrok 無料 | 月20,000リクエスト。**1画面40リクエストなので月500表示で枯渇** |
| GCP 無料枠 | 下り月1GB。**1画面2.62MB なので月390表示で枯渇**。外部IPも有料 |
| Oracle Cloud 無料枠 | 条件は良いがインスタンスの在庫切れが頻発する |

Durable Objects なら Cloudflare 側で動くため、こちらの機材に依存しません。
無料プランの枠も、この用途には十分な余裕があります。

## 無料プランで足りるか

**足ります。** 実測値と突き合わせた結果です。

| 項目 | 無料枠 | この用途 |
|---|---|---|
| リクエスト | 10万/日 | 1画面40リクエスト → **1日2,500画面表示** |
| WebSocket 受信 | 20通で1リクエスト換算 | 試合中の通信はほぼ無視できる |
| WebSocket 送信 | 無課金 | — |
| SQLite 書き込み | 10万行/日 | 対戦表の更新程度なら桁違いに余裕 |
| SQLite ストレージ | 無料プランは無課金 | — |
| 静的ファイル (Pages) | 実質無制限 | Blockly の 5.8MB もここ |
| R2 の下り | 無料 | 試合動画をここに置ける |

無料プランで作れるのは **SQLite バックエンドの Durable Objects のみ**です。
`wrangler.jsonc` の migration は `new_classes` ではなく `new_sqlite_classes` を使っています。

## 設計

```
Pages           静的ファイル（Blockly・CSS・画像）
Workers         画面のルーティング。状態は持たない
Durable Object  対戦ルーム1つにつき1インスタンス（盤面・スコア・WebSocket）
DO の SQLite    対戦表・参加者名簿
R2              試合動画
```

Node 版が `server_store[room_id]` に持っていた状態が、そのまま
「ルームIDで選ばれる Durable Object」に対応します。
`env.ROOM.idFromName(roomId)` は同じ ID から常に同じインスタンスを返すため、
別の試合と混ざりません。

使っていないルームは WebSocket hibernation で眠り、接続を保ったまま課金対象から外れます。

### 一番の難所：タイマー

Node 版は `setTimeout` を14箇所で使っています（相手の10秒待ち、CPU の思考時間など）。
**Durable Objects のアラームは1オブジェクトに1つだけ**なので、そのままでは移せません。

`src/timers.js` が予定を SQLite に並べ、最も早いものだけをアラームに設定します。
鳴ったら期限の来た予定をまとめて処理し、残りの最も早いものを設定し直します。
これで何本でも1つのアラームで賄えます。

予定を SQLite に置くのは、オブジェクトが眠って起き直しても消えないようにするためです。

## 現状

骨組みだけです。試合ロジックはまだ入っていません。
危ないところが先に成立するかを確かめる順で作っています。

**以下は本番の Cloudflare 上で確認済みです**（ローカルだけでなく、実際にデプロイした環境で
`node tool/check.mjs <URL>` を通しています）。

- [x] ルームごとにインスタンスが分かれ、状態が混ざらない
- [x] WebSocket を hibernation 対応で受けられる
- [x] 複数のタイマーが1本のアラームに畳み込まれ、期限どおりに鳴る
- [x] 状態が SQLite に残る
- [x] 無料プランで Durable Objects が動く
- [ ] 試合ロジック（盤面・移動・探索・設置・勝敗判定）
- [ ] CPU 対戦
- [ ] クライアント側の通信を Socket.IO から生の WebSocket へ
- [ ] 画面（Node 版は EJS 4,237行。Workers では動かない）
- [ ] 対戦表・試合動画

## 動かす

```bash
npm install
npx wrangler dev --port 8787 --local
```

別のターミナルで骨組みの検証を行います。

```bash
node tool/check.mjs
```

ルームの分離・WebSocket・タイマーの3点を確認します。所要 15 秒ほどです。

## Cloudflare へデプロイする

準備はすべて済んでいます。**必要なのはログインだけです。**

```bash
npx wrangler login
```

ブラウザが開くので「Allow」を押してください。そのあと次の1コマンドで、
デプロイから動作確認まで通しで実行します。

```bash
./tool/deploy.sh
```

このスクリプトは順に、認証の確認 → ビルドの確認 → デプロイ →
公開先での動作確認（ルームの分離・WebSocket・タイマー）を行います。

### 初回だけ聞かれること

このアカウントで初めて Workers をデプロイする場合、
`workers.dev` のサブドメイン名を聞かれます。好きな名前を入力してください
（例: `u16-shizuoka` と入れると `blockly-chaser-shizuoka-do.u16-shizuoka.workers.dev` になります）。

一度決めれば以後は聞かれません。Pages の `*.pages.dev` とは別枠です。

### ログインの代わりに API トークンを使う

対話ログインが使えない環境では、トークンでも構いません。

```bash
CLOUDFLARE_API_TOKEN=作成したトークン ./tool/deploy.sh
```

トークンは Cloudflare ダッシュボードの My Profile → API Tokens から、
「Edit Cloudflare Workers」テンプレートで作成できます。

### 注意: `wrangler dev --remote` は使えない

SQLite バックエンドの Durable Objects は `--remote` プレビューに対応していません
（`SQLite in Durable Objects is only supported in local mode` と警告が出て起動しません）。

確認は「ローカル (`wrangler dev`)」か「実際にデプロイしてから」のどちらかになります。

### デプロイ後の確認

```bash
node tool/check.mjs https://<デプロイされたURL>
```

ブラウザで開くと、何が動いていて何が未実装かを示す画面が出ます。

## 移植で失われるもの

**参加者が練習している一関版との同一性です。**

Socket.IO サーバーは Workers で動かないため、生の WebSocket に変えます。
すると `public/javascripts` 側の通信も書き換わります（Node 版で49箇所）。

Node 版は「練習環境と1バイトも違わない」ことを保証できていますが、
こちらではそれが成り立ちません。**大会本番に使う場合は、参加者の
`.blch` が問題なく読めるかを別途確認する必要があります。**

## 進め方

大会（2026年10月）が終わってから本格的に着手します。
Node 版は157件のテストが守っている動く資産なので、それを手放さない順序で進めます。

1. 対戦ルーム1つで CPU 対戦が成立するところまで作る
2. 通れば画面・対戦表・動画を移す
3. Node 版は会場LAN用として残し、併存させる

2の途中で行き詰まっても、1の検証だけで損切りできます。
