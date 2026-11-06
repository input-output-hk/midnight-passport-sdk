# Native consented session qualification (#281)

## Status and supported scope

The fifth full run passes at signed source **`b5eeff81767a167a007ee9eb2e32c2e883f068b9`**, after merged PR285.
[The public receipt](qualification.json) binds the executed source, key pins,
infrastructure images, canonical transactions and cleanup. This is a **source
preview after RC7**, not a registry release or an update to published RC7 images.

Both software owner arms use the actual demo session controller, PRF-derived
JubJub helper and SDK holder API against the unchanged `acc-s3r1.1` contract.
The host supplies real proving, balancing and submission. Credentials/PRF are
software fixtures. The fresh faucet asset is **not NIGHT**. Browser consent,
HTTP acknowledgement, real providers and published artifacts remain separate tiers.

| Measurement | Result |
| --- | --- |
| Checked native groups | 9 per owner arm; 18 total |
| Proving requests fulfilled | 49; not a count of individual circuit proofs |
| Submitted originals | 49; every retained binary hash checked and every transaction independently canonical/finalized SUCCESS |
| ACC deployment | All 52 verifier fingerprints checked for each ACC; maintenance retired |
| Used key inputs | 10 prover and all 52 verifier files matched the pinned manifest; no key generation |
| Balance checks | Deposit 12, scoped withdrawal 2, ACC 10, distinct recipient credit 2 per asset, in smallest units |
| Recipient observer reconnects | 1, after original-hash canonical confirmation |
| Standalone wallet refreshes | 0 in this passed run; see the separate setup-mint incident below |
| Cleanup | Both active wallets and all three owned containers stopped; lease released; all volumes/private fixtures retained |
| Unrelated resources | Original default/archived indexer identities and running states unchanged |

The two additional expiry groups wait for **real ten-minute deadlines** and indexed
chain time, check local lock/SDK refusal, then reclaim the expired slot through
fresh owner authorization. They revisit ACC-A after ACC-B. No production timeout
is shortened and no synthetic clock supplies native expiry evidence.

## What the groups exercise

1. Full deployment and SDK sealed owner profile creation.
2. Exact twelve-unit faucet-token setup deposit.
3. Owner-approved ten-minute grant to the derived child.
4. A scoped withdrawal and distinct recipient credit, with no further owner
   signature or PRF derivation.
5. Wrong-recipient and stale-opening refusals with unchanged state and zero new
   proof attempts/submissions.
6. Local lock, fresh-owner revocation and copied-child refusal against live state.
7. Fresh-owner renewal with a different child key and grant ID.
8. Actual deadline, local lock and expiry refusal using indexed chain time.
9. Fresh-owner revocation of the expired grant to reclaim its slot.

Negative grant controls refuse in the **SDK before proving**. This is not a test
of malicious proofs being submitted/rejected by the node. The source lane calls
the hosted Chain port directly; it does not establish a browser/native combined
flow, production FIDO/provider acceptance, full Lace, total-loss recovery or
partial shielded spending. The exact-value shielded guard is unchanged.

## Review map

- `scripts/qualification/live-sessions.mjs`: clean signed source, runtime/reference/
  key pins, fresh resources, stable lease, readiness, end audits and owned cleanup.
- `session-profile.mjs`: strict resource identity, actual endpoint, external output
  and root/package-local dependency guards.
- `apps/passport-service/qualification/session-worker.ts`: actual controller/SDK,
  both owner arms, retained pre-send bytes, balances, lifecycle and expiry.
- `tests/session-native-infrastructure.test.mjs`: unowned resource, substituted
  image/volume, detached endpoint, dependency and output-overlap regressions.
- Existing Chromium journeys separately cover consent, Web Locks, hidden tabs,
  lock during HTTP acknowledgement and unknown issue/spend/revocation fences.

The full local gate passes **1,262 tests**, seven existing skips, zero failures.
Independent Codex CLI reviews cover the initial implementation and every substantive
fix. Initial cleanup/dependency findings were corrected and re-reviewed. Public
receipts remain explicit about their source and evidence tier.

## Run it

Build and run the required local gate, then freeze a clean GPG-signed checkout.
Use the verified reference export, cached pinned images, at least 15 GiB free disk
and 24 GiB Docker memory. Do not regenerate every ACC key when the cache is valid.

```sh
PASSPORT_SESSION_NATIVE=1 PASSPORT_RC_LOCALNET=1 MN_NETWORK_ID=undeployed \
PASSPORT_CONTRACT_DIR=/absolute/path/to/acc-6458ed5/contract \
PASSPORT_SESSION_ROOT=/absolute/private/new-session-run \
nix develop -c pnpm qualify run consented-sessions-native \
  --output /absolute/private/new-summary.json
```

The runner allocates a random fresh project and volumes on 19964/18108/16320.
It refuses occupied ports, existing evidence roots, source/reference overlap,
user sponsor seeds, runtime overrides, mismatched keys and an existing stable
wallet lease. It never pulls a moving image implicitly. Only exact verified
run-owned containers are stopped. It preserves archived/default stacks and all
failed/unknown fixtures. The slow lane stays outside required fast CI.

`parent-receipt.private.json` is authoritative: worker PASS alone is insufficient.
End source/dist/dependency/reference/key checks and complete cleanup must pass.
Do not build/edit/install during the run. Inspect original hashes after interruption;
never clear pending state, repeat a transfer or relabel a failed directory as a pass.
Private logs, seeds, openings, journals, transaction binaries and wallet state stay
outside Git and the public vault packet. Only reviewed public summaries are copied.

## Host integration lessons

**Decode in the matching physical runtime.** Equal package versions and generated
bytes do not make two WASM `ChargedState` instances interchangeable. The host
module decodes host state; the SDK receives neutral bytes/bigints/ledger fields.
The host generated module must still match the SDK binding pin. Grant reads that
consume host state use that matching decoder too.

**Select private-state scope on every serialized call.** The reference Level
provider holds a mutable address and keys data by `address:privateStateId`. The
worker selects the requested ACC and checks its stored state before each call,
including A→B→A. Use independent providers or serialize access to a shared mutable
provider; never reset a missing private state to obtain a pass.

**A cached wallet balance is not transaction finality.** On a timeout, the worker
requires canonical finalized SUCCESS of the exact retained original before one
same-address observer/standalone-wallet refresh. Those refresh callbacks do not
mint, prove or send. Standalone refresh rebinds account/faucet providers to the same
wallet public keys, preserving existing private state. A deployed handle bound to
a stopped wallet is not reused. Failure to confirm or observe still fails the run.
The passed run exercised 1 recipient reconnect(s) and 0 standalone
refresh(es). Where a branch was not invoked, source review and separate cold-view
reconciliation do not become an end-to-end native pass for that branch.

Real browser wallet reconnection may need fresh consent/PRF access. First refresh
the wallet view; if still stale, reload/reopen the account and reconnect the built-in
wallet through its consent flow. Preserve the original operation hash and inspect
it before any new transfer. Never clear site data to retry an uncertain send.

## Retained earlier attempts

| Attempt/source | Outcome and separately reconciled originals |
| --- | --- |
| v1 / `73c1eb5` | Failed after deployment: physical WASM decoder mismatch, before activation/value/session issue. All 11 originals finalized. |
| v2 / `77a1323` | Failed on P-256 recipient live-view timeout after both original withdrawals. All 43 originals finalized; cold recipient showed 2 per asset and ACCs 10. |
| v3 / `363ff62` | Deliberately stopped during deployment to fix private-state scope. All 4 originals finalized, including the same hash whose acknowledgement was lost. |
| v4 / `f8bcb0a` | Failed observing a P-256 setup mint. All 38 originals finalized; a cold standalone view found its original 12-unit output. |

These histories remain **FAIL**. The [historical reconciliation](prior-originals.json)
retains all 96 original finality records. Their binaries matched pre-send hashes;
no send was replayed. Reconciliation only read chain/observer state, then stopped
its owned resources and released the lease. Private roots and volumes remain.
Some old private diagnostic scope labels said `no-wallet`; v2/v4 actually used
cold wallet observers. Their cleanup and reviewed public summaries record that
fact. No proof or transaction was created by those inspections.

Published RC7 remains unchanged. Candidate installation, actual registry/images,
Pages publication and broader partner/provider acceptance are separate release gates.
