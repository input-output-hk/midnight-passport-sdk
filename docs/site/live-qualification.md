---
layout: default
title: Live proof and restart qualification
permalink: /live-qualification/
---

This opt-in source suite follows [host durability]({{ '/host-durability/' | relative_url }})
for #230/#231. It creates disposable accounts on a dedicated standalone network,
using actual proofs and software signing identities. It establishes the scenarios
below only. It does not qualify the whole release, published packages/images or a
real passkey provider.

## Declared scope

For each authoriser arm (JubJub and P-256), the runner:

1. Starts the reference host with its protected host journal and independent RPC token.
   The owner uses the SDK durable coordinator, remote host ports and real chain pipeline.
2. Deploys the first verifier wave, terminates the host immediately after submit returns
   and before its acknowledgement is journalled, and retains the unresolved owner intent.
3. Stops only the inspected dedicated indexer. The real raw-transaction lookup must
   return unknown without changing the protected journal. It starts the same container
   with the same retained volume, then starts a fresh host process.
4. Continues the original saved deployment waves. It repeats the post-submit process
   interruption/indexer outage during activation, then finishes the original create
   and sealed inbox publication. A fresh owner process opens by ACC address.
5. Rotates the viewing key with another post-submit interruption and indexer outage,
   resumes the original intent, and opens again with the retained software credential.

Every continuation re-approves the same synthetic intent; this is an explicit test-host
consent implementation. Unknown outcomes never produce a new mutation ID or blindly
resend a transaction. The runner compares pre/post-restart plan and prepared-byte hashes,
requires one original deployment and final confirmed receipts, and refuses duplicate sends.
These cases use an empty holdings/read-grant roster and retire maintenance authority.
Other retirement choices have separate offline evidence; they are not silently included
in this original live scope. The combined profile below adds populated grants/holdings
and prover boundaries. Live device removal and NIGHT round trips remain separate cases.

Native ledger-v9 **watch identifiers are tagged 33-byte hex values**; included
transaction hashes and ACC addresses remain 32 bytes. The host retains the exact
watch IDs and requires every prepared ID in included raw transaction bytes; merged
transactions may add IDs, but cannot omit the account intent. The v1
journal also reads legacy 32-byte watch IDs. Never strip the tag or substitute the
included hash for a watch ID.

Known-address JubJub opening preserves an existing write-once directory pointer,
including original boot/sealed metadata; it verifies the requested ACC on chain rather
than overwriting or trusting that pointer. A new checked hint is saved only when absent.
A changed recorded owner call sequence may refuse an older pending continuation; retain
its original implementation and protected journal for reconciliation. No migration clears
or rewrites uncertain intent state.

## Prerequisites and dedicated stack

Run through Nix with Docker running and at least 24 GiB assigned. Use the compiled,
manifest-pinned `6458ed5` contract export from the [demo guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/AGENTS.md).
Install its reference dependencies from its lockfile with `npm ci --ignore-scripts`
inside Nix if absent. Reuse its verified keys; do not regenerate keys to repair a
service outage. Build the workspace before qualification.

The versioned fixture uses project `mn-passport-qual-20261023`, loopback ports
`19954` (node), `18098` (indexer), `16310` (proof server), `18797` (host RPC).
The usual demo ports and its volumes are separate. Check listeners and existing
containers first. A stopped existing qualification project must resume its volumes;
never use `down -v` or replace its state to force a pass.

```sh
# From the SDK root; the existing infra/localnet/.env must be configured.
MN_NODE_PORT=19954 MN_INDEXER_PORT=18098 MN_PROOF_PORT=16310 \
  docker compose -p mn-passport-qual-20261023 \
  -f infra/localnet/docker-compose.yml -f infra/localnet/docker-compose.macos.yml \
  up -d node proof-server
```

Wait for node health and block height greater than one, then start `indexer` with
the same project/files/port variables. The runner checks its GraphQL readiness,
container names, project/service labels, exact loopback port bindings and owned
volume names. It controls exact recorded container IDs and child process groups.
It refuses the shared demo project. Do not start another sponsor wallet on this
qualification network while it runs.

```sh
PASSPORT_RC_LOCALNET=1 MN_NETWORK_ID=undeployed \
PASSPORT_CONTRACT_DIR=/absolute/path/to/acc-6458ed5/contract \
PASSPORT_LIVE_ROOT=/private/evidence/new-live-run \
nix develop -c pnpm qualify run outages --output /private/evidence/outages-1.json
```

`PASSPORT_LIVE_ROOT` must be a new absolute private directory. The default is one
both-arm round. Set `PASSPORT_LIVE_ROUNDS=3` for three consecutive rounds of this
declared scope. This is a slower manual lane; no Docker/proof work is added to fast PR CI.
The fixed standalone public genesis seed is used; user sponsor seed overrides are refused.

Host/owner child processes are stopped by their exact owned process groups. The
indexer is restored after an interrupted probe. The operator retains the dedicated
containers and volumes between runs, and can stop their recorded IDs after the suite;
the runner never stops other projects. Docker Desktop itself remains running.

## Evidence and an interrupted qualification

The outer qualification receipt records the scenario result; `PASSPORT_LIVE_ROOT/receipt.json`
contains the declared case details, source fingerprint, binding/module pins, reference
lock/source and package entry hashes, Node version, image IDs/digests, transaction
identifiers/hashes, durations and public journal summaries. Workspace and reference
fingerprints must still match at the end. A failed/incomplete run is not repeatability
evidence. Fresh output paths create separately identified disposable test cases.

The same private root also holds the **synthetic** fixture's signing/key material,
encrypted owner/host journals, eligibility/directory files and protected diagnostic
logs. Keep it mode `0700`; files are private. Do not copy that root into an issue,
public PR, cache or Obsidian. Export only reviewed allowlisted receipts and hashes.
Driver errors stay out of HTTP responses; protected logs are for local diagnosis.

If a test fails after submission, retain its original root and request IDs. Inspect
the protected host record and actual indexer receipt. Resume that original mutation
under fresh consent when safe. Absence of a receipt, an HTTP timeout or process exit
does not prove no send. An expired uncertain transaction or lost uncommitted constructor
output can remain unknown. Do not delete a journal or rerun under a replacement ID
as a recovery operation. Starting a distinct disposable qualification is separate
from resolving the earlier case; record the earlier outcome explicitly.

## Real provider matrix and handover (#232)

Versioned matrix baseline: **2026/10/23**. The available test machine reports macOS
26.2 (25C56), Chrome 156.0.8078.47. Those are environment observations, not provider passes.

| Credential/provider | Browser/context | Evidence status | What remains |
| --- | --- | --- | --- |
| Software JubJub source | Node, pinned runtime | Live suite target | No provider/sync claim |
| Software P-256, wa-json134 assertion | Node, pinned runtime | Live suite target | No browser/passkey-provider claim |
| Google Password Manager, existing PRF credential | Chrome 156 / macOS 26.2 | **Untested in this slice** | Real ceremonies, reload, cancellation, enrolment, rotation, removal |
| iCloud Keychain, existing PRF credential | Safari / macOS 26.2 | **Untested in this slice** | Record Safari version and actual provider/device evidence |
| Chrome profile credential without PRF | Browser virtual/negative lane | Refusal is required; no new real-provider result | Record observed refusal without weakening PRF/UV/profile checks |
| Independently enrolled second browser/device | Real two-device lane | **Untested** | Known-address reopen, surviving reader access, grant handoff/revoke, recipient wallet refresh |
| Synced credential restored on a new device | Provider restoration lane | **Untested** | Same credential/PRF behavior and RP/origin verified; not independent-survivor evidence |

For each actual manual case record: source/binding pin, OS/browser/provider versions,
origin and RP ID, existing vs newly enrolled vs synced credential, separate device/profile
labels, scenario, expected/observed outcome, public transaction IDs and evidence hash.
Use random redacted device labels, not credential IDs or keys. Record cancellation,
no-PRF and wrong-credential refusals as their own outcomes. Never export PRF outputs,
seeds, credential backup data, cookies, assertions or proof witnesses.

Use the normal demo at exactly `http://localhost:5173/` for its pinned WebAuthn origin.
A test on another origin/RP or a synthetic assertion does not establish portability.
An address alone does not restore HD keys. Provider sync, an independently enrolled
survivor and total-loss recovery are different cases. Total-loss recovery, complete
compromised-key retirement, full Lace compatibility and partial shielded spends
remain unsupported; no check here widens hosted consent or the exact-value guard.

## Combined grants, holdings and prover outages

`pnpm qualify run combined-outages` is a separate opt-in source suite. It runs both software authoriser arms against the dedicated retained standalone network. Its setup uses one active read grant with a separately generated X25519 reader and an actual seven-unit shielded test-token deposit. The SDK holding source recomputes the native commitment from decrypted descriptions, reads actual output/input events and verifies the Merkle index. The grant source reads the actual pinned ACC map and checks the reader-public-key hash. No synthetic roster replaces these sources in the live combined profile.

For each arm the suite stops the inspected proof-server container after committing the original deployment plan but before preparing its first maintenance wave, after the original deployment transaction confirms. The failed invocation retains that plan and confirmed first wave; nothing further is dispatched while the prover is down. After the same prover restarts, a new host and owner process resume the same original mutation ID. It compares original/final plan hashes and disallows replacement deployment addresses or retirement choices.

After grant/deposit setup, the suite kills the host just after the first rotation append is submitted, stops and restarts the dedicated indexer, and resumes. The held coin must still qualify, and the independent grantee must open a seal whose secret matches the live new ACC viewing key. All prepared bytes and original plan hashes are retained; repeated send identifiers are refused.

A final rotation stops the actual prover before the owner call reaches host registration. That failure remains an unresolved owner effect. Restoring the prover and explicitly resuming the same intent must **refuse without creating a host record or sending a replacement**. This tests a safety boundary, not successful automatic recovery. Current host absence cannot attest that an earlier sender was fenced. Preserve the encrypted journal and original ID for operator reconciliation; do not clear it or silently start a new operation to manufacture a pass.

Use fresh private evidence roots. Setup itself is deliberately single-use; its grant openings and coin intent are retained before value submission, and an uncertain setup is not replayed automatically. Only the public standalone genesis seed is accepted. This is local source/software-identity evidence, not real-provider, published-registry/image or full release qualification.

```sh
PASSPORT_RC_LOCALNET=1 MN_NETWORK_ID=undeployed \
PASSPORT_CONTRACT_DIR=/absolute/path/to/acc-6458ed5/contract \
PASSPORT_LIVE_ROOT=/private/evidence/new-combined-run \
nix develop -c pnpm qualify run combined-outages --output /private/evidence/combined-1.json
```

For the exhaustive offline continuation tier:

```sh
nix develop -c node scripts/qualification/mutation-matrix.mjs \
  /private/evidence/new-populated-matrix.json populated
```

That matrix executes the actual pinned generated ACC with software signatures, real sealing/opening, one active grant and one coin description across rotation, device enrollment and removal boundaries in fresh processes. Its output/input event transport and Merkle position are synthetic. It has no proofs, chain funds or live-wallet claim. A successful continuation must preserve the coin, the surviving device readers and the grant's ability to open the current secret; removed readers must fail to open it. Lost uncommitted key-origin outputs safely refuse. Representative both-arm receipt-loss/unknown-outcome tests run in fast CI; the full matrix stays opt-in.

## Scoped combined acceptance — 2026/10/24

At source `06dbdc6`, one both-arm standalone round passed 16 case entries with
34 host-confirmed transactions and no duplicate host sends. Each ACC had an
active read grant and one seven-unit shielded test holding; rotation preserved the
holding and the independent grantee opened the current viewing key after restart.
Four actual prover stops, two post-submit host deaths and two actual indexer-outage
probes were exercised. This is one round of the declared source scope, not the
three-run complete release/provider gate.

The pre-registration owner proof failure deliberately remains unresolved on explicit
resume, without registering or resending a replacement. Offline matrices separately
cover 200 owner, 260 populated rotate/add/remove and 152 host cases, including safe
refusals. The final offline harness accepts the grant-specific typed refusal only
at lost original grant-delivery output boundaries; it does not weaken state checks.
See the [scoped verification receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/ac89527acb270d965c171647f79d52f1691ca06a/docs/review/combined-outages/verification.json).

This evidence does not qualify real providers, live enrollment/removal, the complete
release, published artifacts or maximum-inbox resource behavior. Earlier keys remain
bounded decryption candidates without authenticating metadata; candidate-by-coin
work still scales within the existing 4096 limits. Keep original uncertain IDs and
protected state for operator reconciliation.

## Enrolled survivor and wallet reconnect

Run `pnpm qualify run survivor-reconnect` with the same prerequisites and a fresh
`PASSPORT_LIVE_ROOT` as above. Both software authoriser arms create a fresh ACC,
issue an active read grant and deposit a seven-unit shielded test coin. Three
independent signing/reader identities are privately persisted before enrollment.

The owner enrolls a surviving reader, then a target. During target enrollment the
host dies after submitting the actual add-device call. During removal it dies
after the actual viewing-key switch, before the entry-removal call. Each interruption
includes a real indexer stop, a read-only unknown probe, and continuation under the
original ID, plan, outputs and prepared bytes. Final confirmation must retain the
holding, current access for owner/survivor and the independent grantee, and refuse
current-key access for the removed target. The independently enrolled survivor
then authorizes a real rotation. Removed-identity known-address opening must fail
without registering or sending another host call.

Removal is **not atomic compromised-key revocation**: the target may retain signing
authority between key switch and final removal. This suite has no adversarial
concurrent signer and cannot erase old viewing knowledge. It uses shared trusted
grant-opening bookkeeping, not recovery after losing that bookkeeping. Real
providers/two browsers and total-loss recovery remain separate acceptance gates.

The suite ends with the actual built-in read-only wallet running in Node. Its
indexer socket is disconnected; a separately journalled payer sends two smallest
NIGHT units while the indexer is down. After restart, included raw transaction bytes
and node finality prove offline inclusion. The same wallet instance must observe
the new balance and socket, with unchanged shielded/unshielded/dust addresses.
Stop invalidates old handles, closes subscriptions and refuses new connections;
recreating from the same preserved private seed restores those addresses and balance.
This tests network freshness with a new credit, not only a cached balance.

Use `pnpm qualify run wallet-reconnect` for just this wallet diagnostic, with the
same environment and fresh private output paths. A prepared or dispatched transfer
is single-use: preserve its private receipt/bytes on failure and do not blindly
retry it. This is a direct standalone transfer, not an ACC withdrawal or a browser
passkey/provider recovery test. Logical `getConnectionStatus` does not promise a
fresh indexer connection. The full suites stay opt-in, outside fast PR CI.

## Scoped survivor/reconnect acceptance — 2026/10/25

At signed source `094c7f0`, one both-arm round passed **21 entries and 88
host-confirmed transactions**, with no duplicate host sends. Four post-submit host
deaths and four real indexer-outage probes covered enrollment and removal. Both
active grants and seven-unit shielded holdings survived; each independently enrolled
survivor authorized the final rotation, and removed-identity opening refused.

The final wallet case proved a fresh two-unit NIGHT credit finalized while its
indexer was down, observed by the same wallet after restart. Same-seed recreation
retained all addresses/balance, invalidated old handles and closed subscriptions.
Source/dist/reference fingerprints matched. This is Node/software evidence from
one round, with the multi-transaction removal and shared-bookkeeping limits above.
No browser/provider, complete release/Lace or seed-loss recovery acceptance is implied.


## Review corrections — 2026/10/26

Entrypoints now explicitly select their profile; ambient PASSPORT_LIVE_PROFILE
cannot turn an account suite into a wallet-only pass. Fault stages require the
expected typed SDK/transport code as well as retained pending state. Removed-reader
checks match the exact no-current-envelope refusal and use an authorised positive
control on the same ring. Verification runs with a reachable host and zero mutation
attempts observed at the effect ports, so a dead service cannot masquerade as refusal.
The wallet test has a bounded 90-second approval window, a 180-second original TTL,
and an actual native TTL check before dispatch; expired bytes are never renewed.

Earlier accepted receipts retain their exact historical source and assertions.
They do not prove new checks added after their source freeze. Retrospective checks
of saved typed failure codes are separate from fresh proof executions. See the
current review records for that distinction. Native host constructor/maintenance
TTL policy remains unchanged by the separate synthetic wallet-transfer timing.

For a read-only recheck of an already accepted survivor fixture, use
`pnpm qualify run removed-recheck` with a new private `PASSPORT_LIVE_ROOT` and
`PASSPORT_SURVIVOR_FIXTURE_ROOT` pointing to the earlier accepted lifecycle root.
The runner copies each private fixture into its new protected evidence directory;
it does not delete/rewrite the original or replay any historical mutation. A live
host must be reachable. The selected target must still open its earlier key
context, while the owner opens the current context and the target receives the
specific current-key refusal. Effect-port attempt counters must remain zero, and
all historical host records/send counts must remain unchanged. This is new
read-only chain evidence, not a new 88-transaction proof run.

## Grant profile loss and revocation

This opt-in source suite is separate from the historical survivor run. Its entrypoint
explicitly selects `grants`; an ambient profile cannot replace its cases. Reuse only
the dedicated retained `mn-passport-qual-20261023` stack described above, with its
owned ports/volumes and immutable compiled export. Never reset a shared chain or
run two standalone payer wallets concurrently.

```sh
PASSPORT_RC_LOCALNET=1 MN_NETWORK_ID=undeployed \
PASSPORT_CONTRACT_DIR=/absolute/path/to/pinned/contract \
PASSPORT_LIVE_ROOT=/private/new-grant-evidence \
nix develop -c pnpm qualify run grant-recovery-live \
  --output /private/new-grant-suite.json
```

The source and compiled runtime must remain unchanged throughout. A fresh root is
required. The parent creates accounts in both software authoriser arms, stages and
publishes two independent read grants, deposits one qualified seven-unit shielded
holding and enrolls a survivor. It then stops the host before a separate native
owner-grant worker uses the same standalone payer.

For an explicit single-arm run, use suite `grant-recovery-jubjub` or
`grant-recovery-p256` with its own fresh evidence root. The entrypoint selects the
arm; ambient environment variables cannot narrow the both-arm suite. Receipts name
`armsRequested`, and a single-arm pass does not qualify the other arm. Two-grant
setup has a bounded 30-minute budget: real P-256 issue/rotation/publication exceeded
the original single-grant 15-minute budget. Native transaction TTLs and unknown-send
rules are unchanged; this timeout never renews bytes or reissues a grant.

A timed-out overall run remains failed, even if an earlier arm completed. Retaining
that completed arm requires its original assertions/source pin and a separately
recorded end source/reference fingerprint audit. Any later component comparison
must list changed harness files explicitly; it must not relabel the failed overall
receipt or claim it passed at a new source.

The worker creates four distinct empty profiles: original reader, independent
enrolled reader, absent-opening provider and wrong-read-key provider. Its ports
cannot load the old grant journal. Protected original journal/profile files are
hash-checked without decoding them as recovery inputs. Successful reconstruction
uses complete published parts and live commitments. Refusals require the specific
error, unchanged ledger and zero tracked transport/profile write attempts; positive current readers/grantees
must work on that same live state.

Effect accounting includes fresh local account-record and directory writes, not
only chain calls. An idempotent write is still an attempted effect and invalidates
a refusal check. The generated fixture injects such a write to check this guard.

Rotation preserves both read grantees and the holding. Selective revoke removes
one current-key reader while preserving the other, owner/survivor and holding.
Revoke-all confirms an empty grant map and next generation, with neither grantee
opening the new key. Grantee seals are decoded by the owner and handed to distinct
read keys; no automatic grantee discovery or private-key recovery is established.

Native grant calls store private write-ahead requests before one attempt. These
are not durable coordinator submissions. On failure preserve all profiles,
requests, sealed outputs, IDs and receipts; inspect the exact state before another
action. Never rerun this worker in the same root, infer no-send from absence or
blindly replay an interrupted grant revocation. Partial/conflicting publication
and stale snapshot negatives remain separately labelled fast port cases.

Receipts always set real-provider and full-release flags false. Export only the
allowlisted public receipt/verification files. Keep fixture identities, grant
openings, wallet databases and native request arguments outside Git and the Vault.
See [grant recovery]({{ '/grant-recovery/' | relative_url }}) for the integration API.


### Recorded grant scope — 2026/10/26

JubJub completed five entries at `4a45aa0`, with a separate end fingerprint audit;
its overall run remains failed after the later P-256 setup timeout. The explicit
P-256 suite passed five entries at `7483786`. SDK/native worker/shared assertions,
compiled and reference inputs match across those pins under a recorded component
comparison; there is no same-source both-arm CLI PASS. Each scope confirms 22 host
transactions and 17 direct native owner calls (setup excluded), with no duplicate
host sends. See the [grant evidence summary]({{ '/grant-recovery/#recorded-milestone-evidence--20261026' | relative_url }})
and repository review record for receipt hashes and limitations. Repeating a failed
fixture is not the recovery procedure; retain its original protected state.


## Current preparation/outage slice — 2026/10/26

`survivor-outages` is an explicit integrated software-identity source profile for
#230/#231. It creates fresh owned accounts; it never replays old failed fixtures.
Signed source `5d2bf2062fab64a40eadee009823e7a69bd70cc6` completed one both-arm localnet run:
32 passed entries, 88 confirmed host transactions and zero duplicate host sends.
Ten actual indexer-down probes and four actual prover stops passed. Source,
compiled-workspace and selected reference fingerprints remained fixed through
the run. The final owner pre-registration intent remains safely unresolved; it
is preserved, not completed or discarded. The failed first attempt is retained
in the repository's `docs/review/preparation-outages/` record, alongside its
specific deployment-error expectation correction and the successful receipt hashes.

```sh
PASSPORT_RC_LOCALNET=1 MN_NETWORK_ID=undeployed \
PASSPORT_CONTRACT_DIR=/absolute/path/to/pinned/contract \
PASSPORT_LIVE_ROOT=/private/new-survivor-outage-run \
nix develop -c pnpm qualify run survivor-outages \
  --output /private/new-survivor-outage-suite.json
```

The original create ID crosses a deployment submit crash, a prover outage before
the next maintenance proof, and an activation submit crash, then completes. An
actual active read grant and seven-unit shielded test holding are populated before
an independent survivor is enrolled. Target enrollment, removal's key switch and
survivor rotation each have a post-submit host crash plus actual indexer stop/
unknown lookup/restart. Owner/survivor/grantee and holding checks must still pass;
a removed reader must fail current-key opening against a reachable host.

The final owner rotation stops the prover before host registration. Explicit
same-ID resume must remain `MutationUnsettled`, with unchanged host records and
send count. Preserve its protected intent, including after a successful safety
qualification; it is not a completed or no-send owner operation. Native grant
crash continuation and wallet reconnect are separate cases, not silently included.

Each arm has fifteen declared stages plus a final record check. Only the expected
SDK code and exactly one failure summary qualify. Host death must report exit 86
and the requested boundary; arbitrary errors/other deaths cannot pass. Every
prover handshake names the expected deploy/owner boundary. Source/reference hashes
must remain fixed until the end. All broad provider/release flags stay false.

For a targeted fresh run use explicit suite `survivor-outages-jubjub` or
`survivor-outages-p256`. Each receipt names its requested arms. A single-arm pass
never qualifies both arms. The slower lane allows 180 minutes for both arms or 100
for a single arm; fast PR CI runs only the cheap controls and HTTP/race negatives.
Use the retained dedicated stack/ports/volumes above and stop only owned compute
afterwards. Never reset the chain or regenerate keys to obtain a pass.

### Provider boundary

This profile contributes software/localnet preconditions for #232. Existing
Google/iCloud/two-browser rows remain untested at this new source. A restored
synced credential, an independently enrolled survivor and total-loss recovery are
still separate cases; no real credential or provider prompt is automated here.


### Qualification review follow-up — 2026/10/27

The native receipt remains pinned to `5d2bf20`. Later review fixes await the
crash marker's stdout flush and reject a circuit fault from the wrong crypto arm.
Focused child-process/backpressure and classifier tests cover those corrections;
the old native failure summaries were revalidated read-only. SDK execution and
binding bytes are unchanged. This is not a fresh native or provider qualification
at the later review head; the repository review record lists the exact delta.
