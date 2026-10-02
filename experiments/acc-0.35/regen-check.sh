#!/usr/bin/env bash
# Rebuild prover keys from ZKIR alone, one circuit at a time, and compare them
# byte for byte with the keys the compiler wrote. If they match, a consumer
# that has the (small) ZKIR can generate a (large) prover key on demand, and
# prover keys need not be distributed at all.
#
#   experiments/acc-0.35/regen-check.sh <contract-dir> <circuit>…
#   experiments/acc-0.35/regen-check.sh <contract-dir> --all
#
# Needs a `compile.sh … full` build to compare against. Runs on the host.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
"$here/guard.sh"

dir="$(cd "$1" && pwd)"
shift
managed="$dir/contracts/managed/account"
platform="$(basename "$(dirname "$(readlink "$COMPACT_DIRECTORY/bin/compactc")")")"
zkir="$COMPACT_DIRECTORY/versions/0.35.0/$platform/zkir-v3"

if [ "${1:-}" = "--all" ]; then
  circuits=()
  while IFS= read -r c; do circuits+=("$c"); done < <(ls "$managed/zkir" | sed -n 's/\.zkir$//p' | sort)
else
  circuits=("$@")
fi
[ "${#circuits[@]}" -gt 0 ] || { echo "regen-check: name at least one circuit, or --all" >&2; exit 2; }

tmp="$(mktemp -d "${TMPDIR:-/tmp}/acc-regen.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
printf '%-48s %8s %8s %9s  %s\n' circuit seconds peak_GB prover_MB result
fail=0
for c in "${circuits[@]}"; do
  /usr/bin/time -l "$zkir" compile "$managed/zkir/$c.zkir" "$tmp/$c.prover" "$tmp/$c.verifier" 2> "$tmp/$c.time" >/dev/null
  secs=$(awk '/real/ {print $1}' "$tmp/$c.time")
  peak=$(awk '/maximum resident/ {printf "%.2f", $1/1e9}' "$tmp/$c.time")
  mb=$(awk -v b="$(wc -c < "$tmp/$c.prover")" 'BEGIN {printf "%.1f", b/1e6}')
  if cmp -s "$tmp/$c.prover" "$managed/keys/$c.prover" && cmp -s "$tmp/$c.verifier" "$managed/keys/$c.verifier"; then
    result=IDENTICAL
  else
    result=DIFFERENT; fail=1
  fi
  printf '%-48s %8s %8s %9s  %s\n' "$c" "$secs" "$peak" "$mb" "$result"
  rm -f "$tmp/$c.prover" "$tmp/$c.verifier"
done
exit "$fail"
