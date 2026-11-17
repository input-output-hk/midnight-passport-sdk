#!/usr/bin/env bash
# Source this from the launcher: wait can only observe its own direct child.

midnight_service_tree_pids() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    midnight_service_tree_pids "$child"
  done
  printf '%s\n' "$pid"
}

drain_shared_service() {
  local pid=$1 observed deadline child quiet
  kill -0 "$pid" 2>/dev/null || return 1
  observed=$(midnight_service_tree_pids "$pid")
  kill -TERM "$pid" 2>/dev/null || return 1
  # passport-service exits 0 only after closing admission, host mutations and
  # wallet work. Its shutdown handler exits 1 on a failed or timed-out drain.
  wait "$pid" || return 1
  deadline=$((SECONDS + 15))
  while [ "$SECONDS" -lt "$deadline" ]; do
    quiet=1
    for child in $observed; do
      if kill -0 "$child" 2>/dev/null; then quiet=0; break; fi
    done
    [ "$quiet" -eq 1 ] && return 0
    sleep 1
  done
  return 1
}
