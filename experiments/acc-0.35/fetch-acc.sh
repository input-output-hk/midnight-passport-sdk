#!/usr/bin/env bash
# Export the reference ACC's `contract/` tree at a pinned revision from a
# local checkout of the planning workspace (the passport repository), into
# the experiment's work directory. Read-only on the checkout: `git archive`,
# no checkout or fetch.
#
#   PASSPORT_REPO=<path to the passport checkout> \
#     experiments/acc-0.35/fetch-acc.sh [revision]
#
# Default revision: 45721e1 (main with the P-256/WebAuthn arm, 52 circuits,
# spec_version 2). The caller-pinned grants change is 6458ed5 (52 circuits,
# spec_version 3) until it merges.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
rev="${1:-45721e1}"
work="${ACC_WORK:-$here/work}"

repo="${PASSPORT_REPO:-}"
if [ -z "$repo" ] || ! git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
  echo "fetch-acc: set PASSPORT_REPO to a local git checkout of the passport repository." >&2
  exit 1
fi
if ! full="$(git -C "$repo" rev-parse --verify --quiet "${rev}^{commit}")"; then
  echo "fetch-acc: revision '$rev' is not in $repo — run 'git -C \"$repo\" fetch' first." >&2
  exit 1
fi

dest="$work/acc-${full:0:7}"
# contract/ plus the fixture trees its tests read through ../../../experiments/.
paths=(contract)
for extra in experiments/p256-in-circuit experiments/proving-key-regeneration; do
  [ -n "$(git -C "$repo" ls-tree "$full" "$extra")" ] && paths+=("$extra")
done
mkdir -p "$dest"
for p in "${paths[@]}"; do
  if [ -e "$dest/$p" ]; then
    echo "fetch-acc: $dest/$p already exists — reusing it."
  else
    git -C "$repo" archive "$full" "$p" | tar -x -C "$dest"
  fi
done
printf '%s\n' "$full" > "$dest/REVISION"
# The Passport localnet publishes on non-default host ports (infra/localnet/ports.env).
"$here/patch-endpoints.sh" "$dest/contract"

src="$dest/contract/contracts"
impure=$(cat "$src"/account*.compact | grep -c '^export circuit' || true)
echo "fetch-acc: ${full:0:7} → $dest/contract ($impure impure account circuits across $(ls "$src"/account*.compact | wc -l | tr -d ' ') account source files)"
echo "$dest/contract"
