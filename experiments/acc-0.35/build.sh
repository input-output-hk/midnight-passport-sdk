#!/usr/bin/env bash
# X1 — compile the reference ACC with the pinned toolchain, with full key
# generation, exactly as the contract's own build does
# (`compact compile +0.35.0 --feature-zkir-v3`).
#
#   experiments/acc-0.35/build.sh <path/to/account.compact> <out-dir>
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
"$here/guard.sh"

src="$1"
out="$2"
mkdir -p "$(dirname "$out")"

start=$(date +%s)
compact compile +0.35.0 --feature-zkir-v3 "$src" "$out"
end=$(date +%s)
echo "build: $(( end - start )) s → $out"
