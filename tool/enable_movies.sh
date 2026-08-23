#!/bin/bash
#
# 試合動画の保存先(R2)を用意して有効にする。
#
#   ./tool/enable_movies.sh
#
# 事前に Cloudflare ダッシュボードで R2 を有効にしておく必要がある。
#   https://dash.cloudflare.com/ → R2 → 「Enable R2」
# 無料枠(10GB・下り無料)の範囲で使えるが、有効化には支払い方法の登録が求められる。

set -euo pipefail
cd "$(dirname "$0")/.."

BUCKET="blockly-chaser-shizuoka-movies"

echo "1. R2 が使えるか確認します"
if ! npx wrangler r2 bucket list > /dev/null 2>&1; then
  cat <<'MSG' >&2

  R2 が有効になっていません。先にダッシュボードで有効にしてください。

    https://dash.cloudflare.com/ → 左メニューの R2 → 「Enable R2」

  無料枠は保存 10GB / 下り無料です。有効化には支払い方法の登録が要りますが、
  無料枠に収まっていれば課金されません。

MSG
  exit 1
fi
echo "   使えます"

echo ""
echo "2. バケットを用意します: $BUCKET"
if npx wrangler r2 bucket list 2>/dev/null | grep -q "$BUCKET"; then
  echo "   既にあります"
else
  npx wrangler r2 bucket create "$BUCKET"
fi

echo ""
echo "3. wrangler.jsonc の r2_buckets を有効にします"
python3 - <<PY
import re
p = 'wrangler.jsonc'
s = open(p, encoding='utf-8').read()
if '"r2_buckets"' in s and not s.count('// "r2_buckets"'):
    print('   既に有効です')
else:
    s = s.replace('''  // "r2_buckets": [
  //   { "binding": "MOVIES", "bucket_name": "$BUCKET" }
  // ],''', '''  "r2_buckets": [
    { "binding": "MOVIES", "bucket_name": "$BUCKET" }
  ],''')
    open(p, 'w', encoding='utf-8').write(s)
    print('   有効にしました')
PY

echo ""
echo "4. デプロイします"
npm run build > /dev/null
npx wrangler deploy

cat <<'MSG'

============================================================
  試合動画が使えるようになりました。

  一覧    /movies
  管理    /movies/admin
============================================================
MSG
