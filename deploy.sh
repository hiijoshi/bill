#!/usr/bin/env bash
set -euo pipefail

KEY_PATH="${KEY_PATH:-./key.pem}"
SERVER="${SERVER:-admin@3.108.221.197}"
APP_DIR="${APP_DIR:-/opt/bill}"
BRANCH="${BRANCH:-main}"
BUILD_MAX_OLD_SPACE_SIZE_MB="${BUILD_MAX_OLD_SPACE_SIZE_MB:-3072}"

echo "[deploy] target=${SERVER} app_dir=${APP_DIR} branch=${BRANCH}"

ssh -i "${KEY_PATH}" -o StrictHostKeyChecking=no "${SERVER}" "\
set -euo pipefail; \
cd '${APP_DIR}'; \
git fetch origin; \
git checkout '${BRANCH}'; \
git pull --ff-only origin '${BRANCH}'; \
BUILD_MAX_OLD_SPACE_SIZE_MB='${BUILD_MAX_OLD_SPACE_SIZE_MB}' bash scripts/deploy-production.sh"

echo "[deploy] done"
