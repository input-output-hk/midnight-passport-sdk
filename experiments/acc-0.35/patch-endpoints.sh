#!/usr/bin/env bash
# Make the reference client's localnet endpoints follow infra/localnet/ports.env.
#
# The reference tree hard-codes the Midnight default host ports (9944/8088/6300) in
# src/node/wallet.ts (CONFIG.local) and src/wallet/capture.ts (the indexer fallback). The Passport
# localnet publishes on other host ports so it can run beside another localnet, so rewrite those
# literals to read MN_NODE_PORT / MN_INDEXER_PORT / MN_PROOF_PORT, defaulting to the values in
# ports.env. Idempotent; touches only the exported copy under work/, never the passport checkout.
#
#   experiments/acc-0.35/patch-endpoints.sh <exported contract dir>
set -euo pipefail

dir="${1:?usage: patch-endpoints.sh <exported contract dir>}"
wallet="$dir/src/node/wallet.ts"
capture="$dir/src/wallet/capture.ts"
[ -f "$wallet" ] || { echo "patch-endpoints: $wallet not found" >&2; exit 1; }

node_port="\${process.env.MN_NODE_PORT ?? '19944'}"
indexer_port="\${process.env.MN_INDEXER_PORT ?? '18088'}"
proof_port="\${process.env.MN_PROOF_PORT ?? '16300'}"

if grep -q "MN_NODE_PORT" "$wallet"; then
  echo "patch-endpoints: $wallet already patched"
else
  sed -i.orig \
    -e "s#'http://localhost:8088/api/v4/graphql'#\`http://localhost:${indexer_port}/api/v4/graphql\`#" \
    -e "s#'ws://localhost:8088/api/v4/graphql/ws'#\`ws://localhost:${indexer_port}/api/v4/graphql/ws\`#" \
    -e "s#'http://localhost:9944'#\`http://localhost:${node_port}\`#" \
    -e "s#'http://127.0.0.1:6300'#\`http://127.0.0.1:${proof_port}\`#" \
    "$wallet"
  grep -q "MN_NODE_PORT" "$wallet" || { echo "patch-endpoints: wallet.ts did not match" >&2; exit 1; }
  echo "patch-endpoints: patched $wallet"
fi

if [ -f "$capture" ] && ! grep -q "MN_INDEXER_PORT" "$capture"; then
  sed -i.orig "s#'http://localhost:8088/api/v4/graphql'#\`http://localhost:${indexer_port}/api/v4/graphql\`#" "$capture"
  echo "patch-endpoints: patched $capture"
fi
