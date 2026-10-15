#!/usr/bin/env bash
set -euo pipefail

image=${1:?pass the built service image tag}
scratch=$(mktemp -d "${TMPDIR:-/tmp}/passport-service-image.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
chmod 755 "$scratch"

assert_refused() {
  local expected=$1
  shift
  if docker run --rm "$@" "$image" > "$scratch/output.log" 2>&1; then
    echo "Service image started despite missing $expected" >&2
    exit 1
  fi
  if ! grep -Fq "$expected" "$scratch/output.log"; then
    cat "$scratch/output.log" >&2
    echo "Service image did not refuse the expected missing $expected" >&2
    exit 1
  fi
}

test "$(docker image inspect "$image" --format '{{.Config.User}}')" = '10001:10001'
docker run --rm --entrypoint node "$image" --version
assert_refused 'mount a Linux-prepared pinned ACC export'

# Config validation runs before the fake contract tree is imported.
mkdir -p "$scratch/contract/contracts/managed/account/contract" "$scratch/contract/node_modules"
touch "$scratch/contract/contracts/managed/account/contract/index.js"
assert_refused 'set PASSPORT_SPONSOR_SEED_FILE or PASSPORT_SPONSOR_SEED' \
  -v "$scratch/contract:/data/contract:ro" \
  -e MN_NETWORK_ID=testnet \
  -e PASSPORT_MANIFEST_SHA256="$(printf 'ab%.0s' {1..32})"

assert_refused 'binding or manifest differs from the package pin' \
  -v "$scratch/contract:/data/contract:ro" \
  -e MN_NETWORK_ID=undeployed \
  -e PASSPORT_MANIFEST_SHA256="$(printf 'ab%.0s' {1..32})"

echo 'service image refuses a missing export, missing dedicated sponsor, and wrong manifest pin'
