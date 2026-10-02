#!/usr/bin/env bash
# Compile the reference ACC and the helper contracts its tests deploy, with
# the contract's own canonical invocation (from the contract directory,
# relative paths — the only way the compiler manifest's hash reproduces).
#
#   experiments/acc-0.35/compile.sh <contract-dir> zkir   # ZKIR, no keys (minutes)
#   experiments/acc-0.35/compile.sh <contract-dir> full   # all prover/verifier keys
#
# `full` writes every account circuit's keys: about 12 GB for the 52-circuit
# ACC (15 P-256 keys of 470–495 MB each) and tens of minutes. Key generation
# runs on the host, not in Docker. The tests load keys through midnight-js's
# manifest check, which needs the compiler to have written the keys — keys
# added later with zkir-v3 are not in the manifest.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
"$here/guard.sh"

dir="$(cd "$1" && pwd)"
mode="${2:-zkir}"
case "$mode" in
  zkir) skip=(--skip-zk) ;;
  full) skip=() ;;
  *) echo "compile: mode must be 'zkir' or 'full'" >&2; exit 2 ;;
esac

cd "$dir"
build() { # <name> [extra flags…]
  local name="$1"; shift
  echo "compile: $name ($*)"
  /usr/bin/time -l compact compile +0.35.0 "$@" "contracts/$name.compact" "contracts/managed/$name" 2> "contracts/managed-$name.time" \
    || { cat "contracts/managed-$name.time" >&2; exit 1; }
  awk '/real/ {printf "  %s s", $1} /maximum resident/ {printf ", peak %.1f GB\n", $1/1e9}' "contracts/managed-$name.time"
}

mkdir -p contracts/managed
build account --feature-zkir-v3 "${skip[@]}"
# Helpers are small; they always get keys so on-node tests can deploy them.
for helper in control faucet; do
  [ -f "contracts/$helper.compact" ] && build "$helper" --feature-zkir-v3
done
# The P-256 probe proves a captured real WebAuthn assertion (test:p256).
[ -f contracts/probe-p256.compact ] && build probe-p256 --feature-zkir-v3
# The caller-pin probe forwards curve points, which 0.35.0's ZKIR v3 backend
# cannot compile: it stays on the default encoding, as upstream builds it.
[ -f contracts/probe-grant-caller.compact ] && build probe-grant-caller

node "$here/inventory.mjs" contracts/managed/account --json contracts/managed/account-inventory.json
