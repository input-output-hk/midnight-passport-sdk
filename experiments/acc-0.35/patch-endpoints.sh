#!/usr/bin/env bash
# Make the reference client's Midnight stack follow the MN_* variables (infra/networks/*.env).
#
# The reference tree hard-codes the Midnight default endpoints (9944/8088/6300, network
# `undeployed`) in src/node/wallet.ts (CONFIG.local) and src/wallet/capture.ts (the indexer
# fallback). Rewrite them so that each value reads its own variable and falls back to the host
# ports of infra/localnet/ports.env:
#
#   networkId  MN_NETWORK_ID        (undeployed)
#   node       MN_NODE_URL          (http://localhost:$MN_NODE_PORT, 19944)
#   indexer    MN_INDEXER_URL       (http://localhost:$MN_INDEXER_PORT/api/v4/graphql, 18088)
#   indexerWS  MN_INDEXER_WS_URL    (ws://localhost:$MN_INDEXER_PORT/api/v4/graphql/ws)
#   proof      MN_PROOF_SERVER_URL  (http://127.0.0.1:$MN_PROOF_PORT, 16300)
#
# Idempotent, and an upgrade: it rewrites those lines whatever they hold now (the original
# literals, the older port-only patch, or this patch), so rerunning on a patched tree brings it to
# the current form. Touches only the exported copy under work/, never the passport checkout; the
# first run keeps the original as <file>.orig.
#
#   experiments/acc-0.35/patch-endpoints.sh <exported contract dir>
set -euo pipefail

dir="${1:?usage: patch-endpoints.sh <exported contract dir>}"
wallet="$dir/src/node/wallet.ts"
capture="$dir/src/wallet/capture.ts"
[ -f "$wallet" ] || { echo "patch-endpoints: $wallet not found" >&2; exit 1; }

# Rewrites $1 with the sed script on stdin, keeping the first-seen original as $1.orig; says what
# it found.
apply() {
  local file="$1" marker="$2" script new state
  script=$(cat)
  if grep -q "$marker" "$file"; then
    state="already patched"
  elif grep -q "MN_[A-Z_]*PORT" "$file"; then
    state="upgrading the port-only patch"
  else
    state="patching the original"
  fi
  if [ "$state" = "patching the original" ] && [ ! -e "$file.orig" ]; then cp "$file" "$file.orig"; fi
  new=$(mktemp)
  sed -e "$script" "$file" >"$new"
  grep -q "$marker" "$new" || {
    rm -f "$new"
    echo "patch-endpoints: $file did not match" >&2
    return 1
  }
  cat "$new" >"$file"
  rm -f "$new"
  echo "patch-endpoints: $file: $state"
}

# Inside CONFIGS.local, every endpoint line is replaced whole, by key.
apply "$wallet" "MN_PROOF_SERVER_URL" <<'SED'
/^  local: {$/,/^  },$/{
s#^    networkId: .*#    networkId: process.env.MN_NETWORK_ID ?? 'undeployed',#
s#^    indexer: .*#    indexer: process.env.MN_INDEXER_URL ?? `http://localhost:${process.env.MN_INDEXER_PORT ?? '18088'}/api/v4/graphql`,#
s#^    indexerWS: .*#    indexerWS: process.env.MN_INDEXER_WS_URL ?? `ws://localhost:${process.env.MN_INDEXER_PORT ?? '18088'}/api/v4/graphql/ws`,#
s#^    node: .*#    node: process.env.MN_NODE_URL ?? `http://localhost:${process.env.MN_NODE_PORT ?? '19944'}`,#
s#^    proofServer: .*#    proofServer: process.env.MN_PROOF_SERVER_URL ?? `http://127.0.0.1:${process.env.MN_PROOF_PORT ?? '16300'}`,#
}
SED

# The indexer fallback after INDEXER_URL / MIDNIGHT_INDEXER_URL.
if [ -f "$capture" ]; then
  apply "$capture" "MN_INDEXER_URL" <<'SED'
s#^    ?? .*/api/v4/graphql.*#    ?? process.env.MN_INDEXER_URL ?? `http://localhost:${process.env.MN_INDEXER_PORT ?? '18088'}/api/v4/graphql`;#
SED
fi
