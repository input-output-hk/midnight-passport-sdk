#!/usr/bin/env bash
# Starts the Passport prototype in order: localnet (node, proof server, then the indexer)
# -> service -> dapp, inside the Nix shell.
#
#   PASSPORT_CONTRACT_DIR=<fetch-acc.sh output> PASSPORT_MANIFEST_SHA256=<hash> pnpm prototype:up
#   bash scripts/prototype-up.sh --check      # only the port preflight; starts nothing
#
# The Midnight stack comes from infra/networks/$MIDNIGHT_STACK.env (default `undeployed`, the local
# Docker localnet). The localnet is started only for `undeployed`; any other stack is used as the
# file describes it, and needs PASSPORT_SPONSOR_SEED (see infra/networks/testnet.env.example).
#
# The script never stops anything it did not start: a port that is taken is reported with its
# occupant and the script exits, leaving you to stop it.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
# Host ports of the Passport localnet (non-default, so another localnet can keep running).
set -a
# shellcheck source=../infra/localnet/ports.env
. "$root/infra/localnet/ports.env"
set +a

# The Midnight stack: MN_NETWORK_ID and the four MN_*_URL variables, which the service and the
# reference client read, and PASSPORT_NETWORK_ID, which pins the dapp build and the e2e.
stack="${MIDNIGHT_STACK:-undeployed}"
[[ "$stack" =~ ^[a-z0-9][a-z0-9-]*$ ]] || {
  echo "prototype-up: MIDNIGHT_STACK must be lower-case letters, digits and hyphens, got \"$stack\"." >&2
  exit 2
}
stack_file="$root/infra/networks/$stack.env"
[ -f "$stack_file" ] || {
  echo "prototype-up: $stack_file not found (stacks: $(cd "$root/infra/networks" && ls -- *.env 2>/dev/null | sed 's/\.env$//' | paste -sd, -))." >&2
  exit 2
}
set -a
# shellcheck source=/dev/null
. "$stack_file"
set +a
for var in MN_NETWORK_ID MN_NODE_URL MN_INDEXER_URL MN_INDEXER_WS_URL MN_PROOF_SERVER_URL; do
  [ -n "${!var:-}" ] || {
    echo "prototype-up: $stack_file does not set $var." >&2
    exit 2
  }
done
export PASSPORT_NETWORK_ID="$MN_NETWORK_ID"
if [ "$stack" = undeployed ]; then
  local_stack=1
  ports=("$MN_NODE_PORT" "$MN_INDEXER_PORT" "$MN_PROOF_PORT" 8787 5173)
else
  local_stack=0
  ports=(8787 5173)
fi

# R23: every port the stack binds must be free before anything starts.
check_ports() {
  command -v lsof >/dev/null 2>&1 || {
    echo "prototype-up: lsof is needed for the port preflight." >&2
    return 1
  }
  local busy=0 port containers listener
  for port in "${ports[@]}"; do
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 || continue
    busy=1
    # A published Docker port is held by Docker's proxy process, so name the container first.
    containers=$(docker ps --filter "publish=$port" --format '{{.Names}} ({{.Image}})' 2>/dev/null || true)
    if [ -n "$containers" ]; then
      while IFS= read -r c; do
        echo "prototype-up: port $port is taken by the docker container $c" >&2
      done <<<"$containers"
    else
      listener=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 {print $1 " (pid " $2 ")"}' | sort -u | paste -sd, - || true)
      echo "prototype-up: port $port is taken by the process ${listener:-unknown}" >&2
    fi
  done
  if [ "$busy" -ne 0 ]; then
    echo "prototype-up: stop the occupants listed above (docker stop <container>, or quit the process), then retry." >&2
    echo "prototype-up: this script never stops them for you." >&2
    return 1
  fi
  echo "prototype-up: ports ${ports[*]} are free"
}

if [ "${1:-}" = "--check" ]; then
  check_ports
  exit $?
fi
[ "$#" -eq 0 ] || {
  echo "usage: [MIDNIGHT_STACK=<name>] $0 [--check]" >&2
  exit 2
}

"$root/experiments/acc-0.35/guard.sh"
: "${PASSPORT_CONTRACT_DIR:?set PASSPORT_CONTRACT_DIR to the fetch-acc.sh output}"
: "${PASSPORT_MANIFEST_SHA256:?set PASSPORT_MANIFEST_SHA256 to the SHA-256 of the artefact contract-manifest.json}"
[[ "$PASSPORT_MANIFEST_SHA256" =~ ^[0-9a-fA-F]{64}$ ]] || {
  echo "prototype-up: PASSPORT_MANIFEST_SHA256 must be 64 hex characters." >&2
  exit 1
}
manifest="$PASSPORT_CONTRACT_DIR/contracts/managed/account/compiler/contract-manifest.json"
[ -f "$manifest" ] || {
  echo "prototype-up: $manifest not found; run compile.sh <dir> full first." >&2
  exit 1
}
actual=$(shasum -a 256 "$manifest" | cut -d' ' -f1)
[ "$actual" = "$(printf '%s' "$PASSPORT_MANIFEST_SHA256" | tr 'A-F' 'a-f')" ] || {
  echo "prototype-up: PASSPORT_MANIFEST_SHA256 does not match $manifest ($actual)." >&2
  exit 1
}

# The service imports the reference client and its pinned midnight-js packages from the contract
# tree at run time, so that tree needs its own node_modules (no lifecycle scripts, as run.sh does).
if [ ! -d "$PASSPORT_CONTRACT_DIR/node_modules" ]; then
  echo "prototype-up: installing the contract tree's pinned dependencies (once)"
  (cd "$PASSPORT_CONTRACT_DIR" && npm ci --ignore-scripts --no-audit --no-fund)
fi
# The apps import the workspace packages from their dist/ output.
echo "prototype-up: building the workspace packages"
(cd "$root" && pnpm install --frozen-lockfile >/dev/null && pnpm run build >/dev/null)

if [ "$local_stack" -eq 1 ]; then
  # Docker reports slightly less than the Settings value (8 GB shows as 7.75 GiB), so round.
  min="${ACC_MIN_DOCKER_GIB:-24}"
  have=$(docker info --format '{{.MemTotal}}' | awk '{printf "%.0f", $1/1073741824}')
  if [ "$have" -lt "$min" ]; then
    echo "prototype-up: Docker has ${have} GiB; P-256 proofs need at least ${min} GiB." >&2
    echo "prototype-up: raise it in Docker Desktop -> Settings -> Resources -> Memory, then retry." >&2
    exit 1
  fi
else
  # The sponsor seed default is the localnet's public genesis seed; the service refuses it elsewhere.
  : "${PASSPORT_SPONSOR_SEED:?stack $stack is not the localnet: set PASSPORT_SPONSOR_SEED to a funded sponsor wallet seed}"
fi

check_ports

# The reference client's CONFIG.local, which patch-endpoints.sh points at the MN_* variables.
export MIDNIGHT_NETWORK=local
compose=(docker compose -f "$root/infra/localnet/docker-compose.yml" -f "$root/infra/localnet/docker-compose.macos.yml")
service=""

# Kills a process and its descendants by PID (never by name pattern).
kill_tree() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}
cleanup() {
  trap - EXIT INT TERM
  if [ -n "$service" ]; then
    kill_tree "$service"
    wait "$service" 2>/dev/null || true
  fi
  # Only the containers this script started; the volumes stay, so a rerun resumes the same chain.
  if [ "$local_stack" -eq 1 ]; then "${compose[@]}" stop >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$local_stack" -eq 1 ]; then
  [ -f "$root/infra/localnet/.env" ] || printf 'APP__INFRA__SECRET=%s\n' "$(openssl rand -hex 32)" >"$root/infra/localnet/.env"

  echo "prototype-up: starting the node and the proof server"
  "${compose[@]}" up -d --wait node proof-server

  # The indexer's SPO client fails on a chain still at genesis ("block number 1 not found"):
  # start it only once the node has produced a couple of blocks.
  height=0
  for _ in $(seq 1 90); do
    height=$(curl -s -H 'content-type: application/json' \
      -d '{"id":1,"jsonrpc":"2.0","method":"chain_getHeader","params":[]}' "$MN_NODE_URL" |
      node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{console.log(parseInt(JSON.parse(s).result.number,16))}catch{console.log(0)}})' || echo 0)
    [ "${height:-0}" -ge 2 ] && break
    sleep 2
  done
  [ "${height:-0}" -ge 2 ] || {
    echo "prototype-up: the node did not reach block 2 within 3 minutes." >&2
    exit 1
  }
  echo "prototype-up: node at block $height; starting the indexer"
  "${compose[@]}" up -d --wait indexer
else
  echo "prototype-up: stack $stack: using the endpoints in $stack_file; no localnet is started"
fi

echo "prototype-up: starting the service"
(cd "$root" && exec pnpm prototype:service) &
service=$!
for _ in $(seq 1 90); do
  curl -sf http://127.0.0.1:8787/config >/dev/null 2>&1 && break
  kill -0 "$service" 2>/dev/null || {
    echo "prototype-up: the service exited before it was ready." >&2
    exit 1
  }
  sleep 2
done
curl -sf http://127.0.0.1:8787/config >/dev/null 2>&1 || {
  echo "prototype-up: the service did not answer /config within 3 minutes." >&2
  exit 1
}

echo "prototype-up: starting the dapp at http://localhost:5173 (Ctrl-C stops the dapp, the service and the localnet)"
cd "$root"
pnpm prototype:dapp
