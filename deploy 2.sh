#!/bin/bash

KEY="./key.pem"
SERVER="admin@3.108.221.197"
TARGET="/opt/bill/current"

echo "🚀 Uploading build to server..."

rsync -avz -e "ssh -i $KEY" .next/standalone $SERVER:$TARGET/
rsync -avz -e "ssh -i $KEY" .next/static $SERVER:$TARGET/.next/
rsync -avz -e "ssh -i $KEY" public $SERVER:$TARGET/

echo "🔄 Restarting server..."
ssh -i $KEY $SERVER "pm2 restart mbill"

echo "✅ Deploy complete!"
