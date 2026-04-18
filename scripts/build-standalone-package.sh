#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_MAX_OLD_SPACE_SIZE_MB="${BUILD_MAX_OLD_SPACE_SIZE_MB:-1536}"
STANDALONE_DIR="${STANDALONE_DIR:-${ROOT_DIR}/.next/standalone}"
DIST_DIR="${DIST_DIR:-${ROOT_DIR}/.dist/standalone}"

echo "[standalone] root dir: ${ROOT_DIR}"
cd "${ROOT_DIR}"

echo "[standalone] building next app"
NODE_OPTIONS="--max-old-space-size=${BUILD_MAX_OLD_SPACE_SIZE_MB}" npm run build

echo "[standalone] preparing runtime assets"
mkdir -p "${STANDALONE_DIR}/.next"
rm -rf "${STANDALONE_DIR}/.next/static" "${STANDALONE_DIR}/public"
cp -R "${ROOT_DIR}/.next/static" "${STANDALONE_DIR}/.next/static"
if [ -d "${ROOT_DIR}/public" ]; then
  cp -R "${ROOT_DIR}/public" "${STANDALONE_DIR}/public"
fi

echo "[standalone] removing local env files from artifact"
rm -f "${STANDALONE_DIR}/.env" "${STANDALONE_DIR}/.env.local" "${STANDALONE_DIR}/.env.production" "${STANDALONE_DIR}/.env.production.local"

echo "[standalone] copying standalone bundle to ${DIST_DIR}"
rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"
cp -R "${STANDALONE_DIR}/." "${DIST_DIR}/"

echo "[standalone] artifact ready"
echo "[standalone] upload this folder to the server: ${DIST_DIR}"
