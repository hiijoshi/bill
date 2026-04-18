#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/bill}"
APP_NAME="${APP_NAME:-mbill}"
PORT="${PORT:-3000}"
BUILD_MAX_OLD_SPACE_SIZE_MB="${BUILD_MAX_OLD_SPACE_SIZE_MB:-1536}"
DEPLOY_MODE="${DEPLOY_MODE:-server-build}"
ARTIFACT_SOURCE_DIR="${ARTIFACT_SOURCE_DIR:-}"
RELEASE_ID="${RELEASE_ID:-$(date +%Y%m%d%H%M%S)}"
RELEASES_DIR="${RELEASES_DIR:-${APP_DIR}/releases}"
CURRENT_LINK="${CURRENT_LINK:-${APP_DIR}/current}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env}"
SHARED_VAR_DIR="${SHARED_VAR_DIR:-${APP_DIR}/var}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-true}"

run_pm2() {
  local runtime_dir="$1"

  echo "[deploy] ensuring no stray next server owns port ${PORT}"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${PORT}/tcp" || true
  fi

  echo "[deploy] starting or reloading pm2 app"
  PORT="${PORT}" NODE_ENV=production MBILL_RUNTIME_DIR="${runtime_dir}" MBILL_SERVER_SCRIPT="server.js" \
    pm2 startOrReload ecosystem.config.cjs --only "${APP_NAME}"

  echo "[deploy] saving pm2 state"
  pm2 save

  echo "[deploy] current status"
  pm2 status "${APP_NAME}"
}

echo "[deploy] app dir: ${APP_DIR}"

if [ "${DEPLOY_MODE}" = "artifact" ]; then
  if [ -z "${ARTIFACT_SOURCE_DIR}" ]; then
    echo "[deploy] ARTIFACT_SOURCE_DIR is required when DEPLOY_MODE=artifact" >&2
    exit 1
  fi

  if [ ! -d "${ARTIFACT_SOURCE_DIR}" ]; then
    echo "[deploy] artifact source directory not found: ${ARTIFACT_SOURCE_DIR}" >&2
    exit 1
  fi

  release_dir="${RELEASES_DIR}/${RELEASE_ID}"

  echo "[deploy] artifact mode"
  echo "[deploy] source dir: ${ARTIFACT_SOURCE_DIR}"
  echo "[deploy] release dir: ${release_dir}"

  mkdir -p "${RELEASES_DIR}" "${SHARED_VAR_DIR}"
  rm -rf "${release_dir}"
  mkdir -p "${release_dir}"

  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude='.env' \
      --exclude='.env.*' \
      "${ARTIFACT_SOURCE_DIR}/" "${release_dir}/"
  else
    cp -R "${ARTIFACT_SOURCE_DIR}/." "${release_dir}/"
    rm -f "${release_dir}/.env" "${release_dir}"/.env.*
  fi

  ln -sfn "${SHARED_VAR_DIR}" "${release_dir}/var"

  if [ -f "${ENV_FILE}" ]; then
    ln -sfn "${ENV_FILE}" "${release_dir}/.env"
  fi

  if [ "${RUN_MIGRATIONS}" = "true" ]; then
    echo "[deploy] applying database migrations from artifact"
    (
      cd "${release_dir}"
      npm run prisma:migrate:deploy
    )
  fi

  ln -sfn "${release_dir}" "${CURRENT_LINK}"
  run_pm2 "${CURRENT_LINK}"
  exit 0
fi

cd "${APP_DIR}"

echo "[deploy] fetching current branch state"
git fetch --all --prune

echo "[deploy] installing dependencies"
npm ci

echo "[deploy] generating prisma client"
npx prisma generate

echo "[deploy] applying database migrations"
npm run prisma:migrate:deploy

echo "[deploy] building standalone runtime on server"
BUILD_MAX_OLD_SPACE_SIZE_MB="${BUILD_MAX_OLD_SPACE_SIZE_MB}" bash scripts/build-standalone-package.sh

run_pm2 "${APP_DIR}/.next/standalone"
