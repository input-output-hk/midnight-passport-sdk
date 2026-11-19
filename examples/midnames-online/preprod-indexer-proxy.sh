#!/usr/bin/env bash
set -euo pipefail

if [[ ! ${BLOCKFROST_PROJECT_ID:-} =~ ^nightpreprod[A-Za-z0-9_-]+$ ]]; then
  echo 'Set a Midnight Preprod Blockfrost project ID in BLOCKFROST_PROJECT_ID.' >&2
  exit 2
fi
if ! command -v caddy >/dev/null 2>&1; then
  echo 'Install Caddy 2 before starting the local Preprod indexer proxy.' >&2
  exit 2
fi

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
export PASSPORT_BLOCKFROST_UPSTREAM=https://midnight-preprod.blockfrost.io
exec caddy run --config "$here/Caddyfile.preprod" --adapter caddyfile
