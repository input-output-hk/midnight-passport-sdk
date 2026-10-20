#!/usr/bin/env bash
# Review size report — 5,000–10,000 authored changed lines preferred (2026/10/20).
# (docs/development-workflow.md §4–5). Counts insertions + deletions against a
# base ref, excluding lockfiles, generated code, test fixtures, and the
# standalone experiments/ tree (not tranche work). Rename detection is on,
# so pure moves cost nothing.
#
# Usage: check-diff-size.sh [base-ref] [--ci]
#   base-ref  defaults to origin/passport-acc-prototype; missing refs fail clearly
#   --ci      emit GitHub Actions ::warning:: / ::error:: annotations
set -euo pipefail

PREFERRED=5000
LARGE=10000
BASE="${1:-origin/passport-acc-prototype}"
CI="${2:-}"

git rev-parse --verify --quiet "$BASE" >/dev/null || {
  echo "Base ref is missing: $BASE" >&2
  exit 1
}

EXCLUDES=(
  ':!package-lock.json' ':!**/package-lock.json'
  ':!yarn.lock'         ':!**/yarn.lock'
  ':!pnpm-lock.yaml'    ':!**/pnpm-lock.yaml'
  ':!bun.lock'          ':!bun.lockb'
  ':!**/dist/**' ':!**/build/**' ':!**/generated/**' ':!*.generated.*'
  ':!**/*.key-manifest.json'
  ':!**/managed/**'
  ':!**/fixtures/**' ':!**/__snapshots__/**' ':!**/*.snap'
  ':!experiments'
)

CHANGED=$(git diff -M --numstat "$BASE"...HEAD -- . "${EXCLUDES[@]}" \
  | awk '{ add += $1; del += $2 } END { print add + del + 0 }')

echo "Authored changed lines vs $BASE (lockfiles/generated/fixtures/experiments excluded): $CHANGED"

if [ "$CHANGED" -gt "$LARGE" ]; then
  MSG="Diff is $CHANGED lines — above the preferred 5k–10k review range. Provide a review map and explain why this is one coherent slice."
  if [ "$CI" = "--ci" ]; then
    echo "::warning::$MSG"
  else
    echo "WARN: $MSG"
  fi
elif [ "$CHANGED" -lt "$PREFERRED" ]; then
  echo "Below the preferred review range; smaller coherent changes are welcome. Do not pad the diff."
fi
exit 0
