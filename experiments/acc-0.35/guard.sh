#!/usr/bin/env bash
# Refuse to run outside the repository's Nix dev shell: a global `compact`
# (for example ~/.local/bin/compact with ~/.compact) may resolve a different
# compiler, and every result here is only meaningful for the pinned one.
set -euo pipefail

EXPECTED_COMPILER="${EXPECTED_COMPILER:-0.35.0}"

case "${COMPACT_DIRECTORY:-}" in
  /nix/store/*) ;;
  *)
    echo "guard: COMPACT_DIRECTORY is '${COMPACT_DIRECTORY:-unset}', not the Nix toolchain." >&2
    echo "guard: run inside 'nix develop' (or 'nix develop -c <cmd>') from the repository root." >&2
    exit 1
    ;;
esac

compact_bin="$(command -v compact)"
case "$compact_bin" in
  /nix/store/*) ;;
  *)
    echo "guard: 'compact' resolves to $compact_bin, not the Nix store." >&2
    exit 1
    ;;
esac

actual="$(compact compile "+${EXPECTED_COMPILER}" --version)"
case "$actual" in
  "${EXPECTED_COMPILER} "* | "${EXPECTED_COMPILER}") ;;
  *)
    echo "guard: compiler reports '$actual', expected ${EXPECTED_COMPILER}." >&2
    exit 1
    ;;
esac

echo "guard: compact $(compact --version | awk '{print $2}'), compiler ${actual}, node $(node --version)"
