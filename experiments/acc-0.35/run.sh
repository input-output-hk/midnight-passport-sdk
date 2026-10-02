#!/usr/bin/env bash
# Run the reference ACC's own test scripts against the compiled artefacts.
#
#   experiments/acc-0.35/run.sh <contract-dir> offline           # circuits executed, no proofs, no Docker
#   experiments/acc-0.35/run.sh <contract-dir> <npm-script>      # on the localnet, e.g. test:auth-coinless
#   experiments/acc-0.35/run.sh <contract-dir> down              # stop the localnet, drop its volumes
#
# On-node scripts start infra/localnet with fresh volumes. P-256 proofs are
# k = 18 and were killed for lack of memory in an 8 GiB Docker VM, so a script
# whose name contains "p256" requires at least 24 GiB of Docker memory
# (ACC_MIN_DOCKER_GIB to change; Docker Desktop → Settings → Resources).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
"$here/guard.sh"

dir="$(cd "$1" && pwd)"
what="${2:?name 'offline', 'down', or an npm script}"
compose=(docker compose -f "$root/infra/localnet/docker-compose.yml" -f "$root/infra/localnet/docker-compose.macos.yml")

if [ "$what" = down ]; then
  "${compose[@]}" down -v
  exit 0
fi

cd "$dir"
[ -f contracts/managed/account/contract/index.js ] || { echo "run: compile first (compile.sh $dir zkir|full)" >&2; exit 1; }
if [ ! -d node_modules ]; then
  echo "run: installing the contract's pinned dependencies (no lifecycle scripts)"
  npm ci --ignore-scripts --no-audit --no-fund
fi

if [ "$what" = offline ]; then
  for s in test:unit test:p256-offline test:grants-offline test:recovery-offline test:toolchain-offline; do
    if [ "$s" = test:toolchain-offline ] && ! ls contracts/managed/account/keys/*.verifier >/dev/null 2>&1; then
      echo "━━ $s skipped: it builds deployments from the verifier keys (compile.sh … full)"
      continue
    fi
    if node -e "process.exit(require('./package.json').scripts['$s'] ? 0 : 1)"; then
      echo "━━ $s"
      npm run --silent "$s"
    fi
  done
  exit 0
fi

min=0
case "$what" in *p256*) min="${ACC_MIN_DOCKER_GIB:-24}" ;; esac
# Docker reports slightly less than the Settings value (8 GB shows as 7.75 GiB),
# so round to the nearest GiB rather than truncating.
have=$(docker info --format '{{.MemTotal}}' | awk '{printf "%.0f", $1/1073741824}')
if [ "$have" -lt "$min" ]; then
  echo "run: $what proves P-256 circuits; Docker has ${have} GiB, needs ≥ ${min} GiB." >&2
  echo "run: raise it in Docker Desktop → Settings → Resources → Memory, then retry." >&2
  exit 1
fi

envfile="$root/infra/localnet/.env"
[ -f "$envfile" ] || printf 'APP__INFRA__SECRET=%s\n' "$(openssl rand -hex 32)" > "$envfile"
"${compose[@]}" down -v >/dev/null 2>&1 || true
"${compose[@]}" up -d --wait

evidence="$dir/evidence-run/$what"
mkdir -p "$evidence"
WALLET_SEED="${WALLET_SEED:-0000000000000000000000000000000000000000000000000000000000000001}" \
EVIDENCE_DIR="$evidence" \
MIDNIGHT_NODE_CONTAINER=mn-passport-sdk-localnet-node-1 \
MIDNIGHT_PROOF_CONTAINER=mn-passport-sdk-localnet-proof-server-1 \
  npm run "$what"
echo "run: evidence in $evidence; stop the localnet with: $0 $dir down"
