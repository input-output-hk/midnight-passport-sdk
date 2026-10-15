#!/usr/bin/env bash
set -euo pipefail

image=${1:?pass the built funding image tag}
scratch=$(mktemp -d "${TMPDIR:-/tmp}/passport-funding-image.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
chmod 755 "$scratch"

assert_refused() {
  local expected=$1
  shift
  if docker run --rm "$@" "$image" > "$scratch/output.log" 2>&1; then
    echo "Funding image started despite missing $expected" >&2
    exit 1
  fi
  if ! grep -Fq "$expected" "$scratch/output.log"; then
    cat "$scratch/output.log" >&2
    echo "Funding image did not refuse the expected missing $expected" >&2
    exit 1
  fi
}

test "$(docker image inspect "$image" --format '{{.Config.User}}')" = '10001:10001'
docker run --rm --entrypoint node "$image" --version
assert_refused 'mount a Linux-prepared pinned ACC export'

# A syntactic mount passes the entrypoint but cannot hide config refusal. The
# service checks config before loading this fake export or opening a socket.
mkdir -p "$scratch/contract/contracts/managed/account/contract" "$scratch/contract/node_modules"
touch "$scratch/contract/contracts/managed/account/contract/index.js"
assert_refused 'set PASSPORT_FUNDING_SEED_FILE' \
  -v "$scratch/contract:/data/contract:ro" \
  -e MN_NETWORK_ID=testnet

mkdir -p "$scratch/secrets"
printf '%064d\n' 1 > "$scratch/secrets/seed"
printf '%032d\n' 1 > "$scratch/secrets/token"
assert_refused 'set PASSPORT_FUNDING_ASSETS_FILE' \
  -v "$scratch/contract:/data/contract:ro" \
  -v "$scratch/secrets:/run/passport-secrets:ro" \
  -e MN_NETWORK_ID=testnet \
  -e PASSPORT_FUNDING_SEED_FILE=/run/passport-secrets/seed \
  -e PASSPORT_FUNDING_TOKEN_FILE=/run/passport-secrets/token \
  -e PASSPORT_FUNDING_DEPLOYMENTS_FILE=/run/passport-secrets/deployments.json

echo 'funding image refuses missing mount, non-standalone wallet seed and asset policy'
