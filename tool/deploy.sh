#!/bin/bash
#
# Cloudflare へデプロイし、そのまま動作確認まで行う。
#
#   ./tool/deploy.sh
#
# 事前に一度だけログインが必要:
#   npx wrangler login
#
# ログインの代わりに API トークンを使う場合:
#   CLOUDFLARE_API_TOKEN=xxxxx ./tool/deploy.sh

set -euo pipefail
cd "$(dirname "$0")/.."

echo "1. 認証を確認します"
if ! npx wrangler whoami > /tmp/whoami.txt 2>&1; then
  cat <<'MSG' >&2

  ログインしていません。次のどちらかを行ってください。

    (A) 対話ログイン（おすすめ）
        npx wrangler login
        → ブラウザが開くので「Allow」を押してください

    (B) API トークンを使う
        Cloudflare ダッシュボード → My Profile → API Tokens →
        「Edit Cloudflare Workers」テンプレートでトークンを作成し、

        CLOUDFLARE_API_TOKEN=作成したトークン ./tool/deploy.sh

MSG
  exit 1
fi
grep -E "Account Name|Account ID|email" /tmp/whoami.txt | head -3 || true
rm -f /tmp/whoami.txt

echo ""
echo "2. ビルドを確認します"
npx wrangler deploy --dry-run --outdir=/tmp/wr-dry > /dev/null
echo "   問題ありません"

echo ""
echo "3. デプロイします"
# 初回は workers.dev のサブドメイン名を聞かれることがあります。
# その場合は好きな名前を入力してください（例: u16-shizuoka）
npx wrangler deploy | tee /tmp/deploy.txt

URL=$(grep -oE 'https://[a-z0-9.-]+\.workers\.dev' /tmp/deploy.txt | head -1 || true)
rm -f /tmp/deploy.txt

if [ -z "$URL" ]; then
  echo ""
  echo "デプロイは完了しましたが、URL を読み取れませんでした。"
  echo "上の出力に表示されている URL に対して次を実行してください:"
  echo "  node tool/smoke.mjs <URL>"
  exit 0
fi

echo ""
echo "4. 公開先で動作を確認します: $URL"
echo "   （Cloudflare 全体に行き渡るまで少し待ちます）"
sleep 10

node tool/smoke.mjs "$URL"

cat <<MSG

============================================================
  公開URL
    $URL

  確認用
    $URL/health
============================================================
MSG
