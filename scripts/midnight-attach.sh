#!/usr/bin/env bash
# Read-only check of the designated owner's shared Ledger 9 stack. It never
# starts or stops Docker resources. Requires curl and jq from the Nix shell.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../infra/networks/shared-ledger9.env
. "$root/infra/networks/shared-ledger9.env"

fail() {
  printf 'midnight-attach: %s\n' "$1" >&2
  exit 1
}

for tool in curl jq; do
  command -v "$tool" >/dev/null || fail "$tool is required"
done

request() {
  curl --noproxy '*' --fail --silent --show-error --max-time 4 "$@"
}

rpc() {
  local payload
  payload=$(jq -cn --arg method "$1" --argjson params "$2" \
    '{jsonrpc:"2.0",id:1,method:$method,params:$params}')
  request -H 'Content-Type: application/json' --data "$payload" "$MN_NODE_URL" \
    | jq -er 'select(.error == null) | .result'
}

chain=$(rpc system_chain '[]') || fail 'node RPC is unavailable'
[[ $chain =~ ^undeployed[0-9]*$ ]] || fail "unexpected node chain: $chain"
version=$(rpc system_version '[]') || fail 'node release is unavailable'
[[ $version =~ ^2\.1\.101(-[[:alnum:]._-]+)?$ ]] || fail "unexpected node version: $version"
genesis=$(rpc chain_getBlockHash '[0]') || fail 'node genesis is unavailable'
[[ $genesis =~ ^0x[[:xdigit:]]{64}$ ]] || fail 'invalid genesis hash'

indexed=$(request -H 'Content-Type: application/json' \
  --data '{"query":"{ block { height hash protocolVersion } }"}' "$MN_INDEXER_URL" \
  | jq -ce 'select(.errors == null) | .data.block
    | select(.protocolVersion == 2001100 and (.height | type == "number" and . > 0 and . == floor)
    and (.hash | test("^[0-9a-f]{64}$")))') || fail 'indexer has no current Ledger 9 block'
height=$(jq -r '.height' <<<"$indexed")
hash=$(jq -r '.hash' <<<"$indexed")
node_hash=$(rpc chain_getBlockHash "[$height]") || fail 'node could not resolve the indexer block'
[[ $node_hash == "0x$hash" ]] || fail 'node and indexer disagree at the indexed height'

proof_version=$(request "$MN_PROOF_SERVER_URL/version") || fail 'proof server is unavailable'
[[ $proof_version == 9.0.2 ]] || fail "unexpected proof server version: $proof_version"

# Record this observation with deployment receipts. Before reusing an old
# deployment, reread its recorded block hash at its recorded height; genesis
# alone cannot identify a restarted development chain.
jq -n --arg node "$MN_NODE_URL" --arg indexer "$MN_INDEXER_URL" \
  --arg ws "$MN_INDEXER_WS_URL" --arg prover "$MN_PROOF_SERVER_URL" \
  --arg genesis "$genesis" --arg hash "$node_hash" --argjson height "$height" \
  '{networkId:"undeployed",urls:{nodeRpcUrl:$node,indexerHttpUrl:$indexer,
    indexerWsUrl:$ws,proofServerUrl:$prover},genesisHash:$genesis,
    indexedBlock:{height:$height,hash:$hash}}'
