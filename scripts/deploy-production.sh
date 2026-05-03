#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/bill/current}"
APP_NAME="${APP_NAME:-mbill}"
PORT="${PORT:-3000}"
BRANCH="${BRANCH:-main}"
PULL_LATEST="${PULL_LATEST:-false}"

echo "[deploy] app dir: ${APP_DIR}"
cd "${APP_DIR}"

if [ "${PULL_LATEST}" = "true" ]; then
  echo "[deploy] pulling latest branch: ${BRANCH}"
  git fetch origin
  git checkout "${BRANCH}"
  git pull --ff-only origin "${BRANCH}"
fi

echo "[deploy] install dependencies"
npm ci

echo "[deploy] prisma generate"
npx prisma generate

echo "[deploy] prisma migrate deploy"
npm run prisma:migrate:deploy

echo "[deploy] build next app"
npm run build

echo "[deploy] free port ${PORT} if occupied"
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" || true
fi

echo "[deploy] start/reload pm2 app"
PORT="${PORT}" NODE_ENV=production pm2 startOrReload ecosystem.config.cjs --only "${APP_NAME}"

echo "[deploy] save pm2 and print status"
pm2 save
pm2 status "${APP_NAME}"

echo "[deploy] completed successfully"
