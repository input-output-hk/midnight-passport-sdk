#!/bin/sh
set -eu

: "${PASSPORT_CONTRACT_DIR:=/data/contract}"
if [ ! -f "$PASSPORT_CONTRACT_DIR/contracts/managed/account/contract/index.js" ] ||
   [ ! -d "$PASSPORT_CONTRACT_DIR/node_modules" ]; then
  echo 'passport-funding-service: mount a Linux-prepared pinned ACC export at PASSPORT_CONTRACT_DIR' >&2
  exit 1
fi

exec /opt/passport/apps/passport-funding-service/node_modules/.bin/tsx \
  /opt/passport/apps/passport-funding-service/src/main.ts
