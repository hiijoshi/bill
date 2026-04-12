#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/bill}"
APP_NAME="${APP_NAME:-mbill}"
PORT="${PORT:-3000}"

echo "[deploy] app dir: ${APP_DIR}"
cd "${APP_DIR}"

echo "[deploy] fetching current branch state"
git fetch --all --prune

echo "[deploy] installing dependencies"
npm ci

echo "[deploy] generating prisma client"
npx prisma generate

echo "[deploy] applying database migrations"
npm run prisma:migrate:deploy

echo "[deploy] building next app"
npm run build

echo "[deploy] ensuring no stray next server owns port ${PORT}"
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" || true
fi

echo "[deploy] starting or reloading pm2 app"
PORT="${PORT}" NODE_ENV=production pm2 startOrReload ecosystem.config.cjs --only "${APP_NAME}"

echo "[deploy] saving pm2 state"
pm2 save

echo "[deploy] current status"
pm2 status "${APP_NAME}"
