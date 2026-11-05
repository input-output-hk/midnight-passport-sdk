# Native consented-session qualification (#281)

## Scope and review map

This lane exercises the actual demo session controller with source SDK packages,
the pinned ACC, real proofs and a new isolated localnet. Credentials/PRF and owner
consent are software fixtures; Chromium consent/provider behavior is a separate
lane. No full Lace, real-provider, published image or registry acceptance follows.

- `scripts/qualification/live-sessions.mjs`: source/reference/key pins, stable
  lease, fresh Docker project and volumes, resource/capacity checks, retained
  receipts and owned cleanup. Ports 19964/18108/16320; no retained stack control.
- `session-profile.mjs`: closed resource identities and actual endpoint checks.
- `apps/passport-service/qualification/session-worker.ts`: both owner arms,
  sealed SDK creation, 52 deployed verifier fingerprints/retired maintenance,
  exact faucet-token deposit, actual session grant/withdrawal/recipient credit,
  copied-key revocation, new-child renewal and real ten-minute expiry.
- `tests/session-native-infrastructure.test.mjs`: shared-resource, wrong-volume,
  substituted-image, detached endpoint and opt-in boundary regressions.
- Existing browser session tests cover consent dialogs, Web Locks, hidden tabs,
  local lock during HTTP acknowledgement and unknown-send/revocation fences.

Both sessions use the demo's production 10-minute minimum. No synthetic clock,
shortened production expiry or sleep-based transaction confirmation is used.
Indexed chain time must pass the renewed expiry before expiry checks. Refusals
are SDK checks against live native state **before proving**, not malicious-proof
submissions or node-rejection/rollback qualification. The test asset is a fresh
faucet token, not NIGHT; existing NIGHT funding evidence remains separate.

## Run

Freeze a clean GPG-signed source after building. The complete local gate and an
independent review are required before treating evidence as acceptance. Use the
verified existing full reference export; do not regenerate all ACC keys. At least
15 GiB free disk, 24 GiB Docker memory and cached pinned images are required.

```sh
PASSPORT_SESSION_NATIVE=1 PASSPORT_RC_LOCALNET=1 MN_NETWORK_ID=undeployed \
PASSPORT_CONTRACT_DIR=/absolute/path/to/acc-6458ed5/contract \
PASSPORT_SESSION_ROOT=/absolute/private/new-session-run \
nix develop -c pnpm qualify run consented-sessions-native \
  --output /absolute/private/new-summary.json
```

The parent refuses occupied ports, an existing output, user sponsor seeds, runtime
overrides, mismatched keys, dirty source and an existing stable native wallet
lease. It never pulls an image implicitly. A listener on a retained port is not
reused. Only containers created by this run are stopped, by exact verified ID.
Fresh chain/indexer volumes and every failed/unknown transaction remain retained.
Read `parent-receipt.private.json` as the authoritative run verdict: a worker PASS
alone does not establish end-input verification or cleanup. A partial receipt or
lost acknowledgement must be reconciled using its original retained transactions;
never rerun that directory, clear pending state or replay a value transfer.

All roots/logs/identities/openings/journals/transaction binaries stay private. Copy
only explicitly reviewed public summaries into docs or Obsidian. The parent's
reference source/dependency identities are drift detectors, not an independent
provenance audit of the original exported client.

## Status

Implementation prepared locally after merged PR #285. Native acceptance is
pending a clean signed run and independent review. Do not infer it from the fast
infrastructure tests or prior merchant/session browser evidence.
