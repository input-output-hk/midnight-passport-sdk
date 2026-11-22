# Midnames local demo and registry preparation

## Open the local Passport and Midnames demo

The launcher attaches to the designated owner's running Ledger 9 node,
Indexer API v4 and proof server when they match the pinned profile. It uses
the existing `paidfix.night` receipt as a read-only chain and ACC pin, then
opens the opt-in JubJub Passport page with the real local Midnames resolver
and named NIGHT control. The development mock passkey is the default; use
`--real-passkey` for a PRF-capable authenticator. The script neither starts nor
stops the owner's `midnight-network` project. It installs pinned workspace
dependencies and builds the local SDK packages if needed before checking the
live claim; this changes only rebuildable checkout outputs, not chain state.

To inspect the shipped claim and ACC against **one node-finalized block** without
starting the demo or sending a transaction, attach to the existing stack and
run the read-only verifier from the dapp package directory:

```sh
cd apps/passport-dapp
MN_NODE_URL=http://127.0.0.1:9944 \
MN_INDEXER_URL=http://127.0.0.1:8088/api/v4/graphql \
MN_INDEXER_WS_URL=ws://127.0.0.1:8088/api/v4/graphql/ws \
nix develop -c node --import tsx \
  ../../examples/midnames-local/check-live-profile.mjs \
  ../../examples/midnames-local/evidence/shared-ledger9-paidfix-deposit-20261118.json
```

The verifier checks the recorded claim block against the node, makes up to
20 indexer attempts one second apart for the exact node-finalized block, reads both
contracts at that canonical block hash, and checks it again. An older indexer
tip refuses rather than making a moved name look current. This is a local chain-state
observation through one indexer, not an authenticated online provider or a
guarantee that the binding will remain unchanged after the read.

```sh
nix develop -c node scripts/midnames-local-demo.mjs check
nix develop -c node scripts/midnames-local-demo.mjs up \
  --passport-repo /absolute/path/to/passport
```

Open the printed `http://localhost:5173/?mockPasskey` URL in a dedicated
browser profile. In the app, inspect **Name service** and resolve
`paidfix.night`; the verified contract target is the already activated local
ACC. On **Passport account → Withdraw**, a funded JubJub source can review
the recipient, registry, amount, controlled bridge wallet, and both NIGHT
operations before one owner approval. The sender's ACC and built-in wallet
must already hold the intended NIGHT and fee DUST, respectively. The launcher
does not mint funds or silently create a new ACC. A newly created unfunded
account can inspect resolution but cannot submit the named payment. The
[shared named payment qualification](../../docs/site/names.md#source-preview-midnames-210)
records the completed two-leg flow and its recovery evidence; this launcher
does not claim a fresh payment merely by opening the page.

Use `--contract-dir /absolute/path/to/prepared/contract` instead of
`--passport-repo` to reuse a pinned ACC export and avoid another key build.
The launcher runs the repo's `demo up` checks, uses a separate private
deployment registry, and selects a compatible Compact 0.35 prover. If a
compatible prover already listens on port 16320, it is only read; otherwise
the launcher starts and later stops its own no-volume prover project. Ctrl-C
drains only its demo services and stops only fallback containers that this
invocation started. Receipts, browser state, and Docker volumes are retained.

### Provisional ACC local demo profile

Pass `--candidate-assets` with the separately staged, verified
`acc-s3r1.1-zkir036` asset directory to exercise a newly created Ledger 9 ACC
with the Compact 0.36.1 key-generation candidate. The launcher attaches to the
shared release prover on port 6300, selects separate deployment and claim
journals, and pins the candidate in both service and browser. The ordinary
`acc-s3r1.1` demo and online binding policy remain unchanged. Use a dedicated
browser profile for candidate accounts and their retained claim receipts.
The prepared Compact 0.35 standalone registry still uses an owned compatibility
prover on port 16320 for name-claim proofs; the candidate ACC uses the shared
release prover on port 6300. The launcher records and stops only its own
compatibility container, leaving the shared stack and its volumes untouched.
The candidate launcher requires `--claim` and a verified standalone registry profile.

The [synthetic shared-chain receipt](evidence/candidate-acc-combined-local-claim-20261122.json)
shows one candidate ACC created in the Passport page and a same-profile paid
`.night` claim with indexed success and a matching on-chain contract target.
The creation, claim and post-fix readback used separate signed heads. The final
head rejects an unowned prover listener and reopens the confirmed name, but a
single-head combined journey and named NIGHT send in that profile remain open.

An existing live profile supplies the standalone registry address and chain
anchor; its previously registered name is not used as a candidate ACC pin.
With a funded claim sponsor and prepared registry, `--setup --claim` opens
account creation and subsequent name registration in the same demo session:

```sh
nix develop -c node scripts/midnames-local-demo.mjs up \
  --contract-dir /absolute/path/to/prepared/acc/contract \
  --profile /absolute/path/to/current-local-registry-receipt.json \
  --prepared-registry /absolute/path/to/prepared/registry \
  --candidate-assets /absolute/path/to/verified/candidate-assets \
  --setup --claim
```

The candidate build checks the exact manifest and generated module hashes.
The service checks the complete candidate asset tree at startup. A successful
build or page start does not qualify the combined create, claim, deposit and
named-send journey; its native receipt must be recorded separately.
To enable candidate NIGHT deposits, first run the one-time
[`--candidate-funding-only` wallet provisioner](../../apps/passport-funding-service/README.md),
then add `--funding` to the candidate `up` command. It selects the separate
candidate wallet, asset policy, reservation journal and deployment log. The
[native funding receipt](evidence/candidate-funding-native-20261122.json)
confirms 10 base units credited and a same-ID replay on shared Ledger 9; the
connected browser funding action still needs its own acceptance run. An
[exact-head exported-adapter proof-only run](evidence/candidate-acc-shared-adapter-deposit-proof-20261122.json)
validated the generated module, candidate deposit verifier and unbound proof,
and a later [native settlement](evidence/candidate-acc-shared-adapter-settled-deposit-20261122.json)
used a separately funded synthetic wallet to consume a reconciled exact
4 NIGHT output. The recipient ACC balance moved from 0 to 4. The candidate
demo launcher still disables named NIGHT sending. The page source now admits
only the exact candidate pin with an explicit local profile, loopback
service/chain endpoints, fresh owner review and a binding-pinned original
journal. Headless checks cover page admission and no-ID refusal; the direct
deposit and isolated two-leg fixture do not qualify a connected browser
withdrawal-to-deposit payment or recovery.

### Register a name and fund a Passport account

The local demo can register a name **after** ACC activation. Stop the demo first,
then provision two dedicated wallets from the local genesis wallet. The provisioner
requires the shared sponsor lease to be free, writes private seeds, a funding
token and a NIGHT-only policy under the demo state directory, and records each
transfer before proceeding. An interrupted transfer remains fenced for manual
reconciliation; never rerun it by clearing a receipt or lease.

```sh
nix develop -c env \
  MN_NETWORK_ID=undeployed \
  MN_NODE_URL=http://127.0.0.1:9944 \
  MN_INDEXER_URL=http://127.0.0.1:8088/api/v4/graphql \
  MN_INDEXER_WS_URL=ws://127.0.0.1:8088/api/v4/graphql/ws \
  MN_PROOF_SERVER_URL=http://127.0.0.1:16320 \
  pnpm --filter passport-dapp exec node --experimental-import-meta-resolve --import tsx \
  ../../scripts/midnames-demo-wallets.mjs \
  "$HOME/.local/share/midnight-passport/local-demo" \
  /absolute/path/to/prepared/acc/contract
```

Use the same pinned ACC contract directory and a prepared standalone registry
from [registry preparation](#midnames-local-demo-and-registry-preparation).
The shared Ledger 9 node and v4 indexer must already be attached. The provisioner
does not start Docker. For the current local chain the complete demo is:

```sh
nix develop -c node scripts/midnames-local-demo.mjs up \
  --contract-dir /absolute/path/to/prepared/acc/contract \
  --prepared-registry /absolute/path/to/prepared/registry \
  --claim --funding
```

Open the activated ACC with its passkey, go to **Passport account → Balances →
Register a .night name**, enter an unregistered name such as `yurii.night`, and
click **Continue registration**. Review the exact quote and click **Approve with
passkey**. The page then displays the saved payment terms without sending; click
**Confirm payment and register** after reviewing them. The page checks the
original claim after dispatch. Raw receipts and manual checks remain under
**Receipt and recovery details** for diagnostics.
The local sponsor sets the balanced transaction deadline to the displayed quote
expiry; review and confirm before that deadline. **Continue registration** first
reconciles any retained original. For an unsent transaction past its TTL, the
sponsor verifies no dispatch fence, no indexed original and an unregistered
name before it archives the private journal; the browser retains the receipt
in released history. A fenced or uncertain send stays pending for read-only
reconciliation. An indexed failed claim also remains in the local sponsor's
private journal; this demo does not offer a fresh quote until that sponsor state
is separately reconciled. Registration is
optional and can be done in a later session with the same account credential.
The separate **Deposit** page offers the configured NIGHT amount. Each deposit
requires the funding wallet's allowlisted asset and available balance.

The launcher enables claim controls only when the funded sponsor and pinned
owner bundle are ready. It retains one original claim journal in this demo state
directory. Reusing that journal for a different name or account refuses; preserve
it for recovery. The sponsor wallet, funding wallet and ACC fee sponsor have
distinct seeds, and the browser never receives either sponsor seed. This local
standalone `.night` profile does not issue public `passport.night` names. The
registered domain's future subdomain payment address is the dedicated local
claim sponsor's controlled unshielded address; retain that wallet seed with the
registry state if demonstrating later subdomain purchases.

### When no shared stack is running

`stack` starts a separate `midnight-passport-ledger9-demo-…` project from
[`docker-compose.ledger9.yml`](../../infra/localnet/docker-compose.ledger9.yml),
with the same pinned Ledger 9 images and loopback ports. It creates private
indexer credentials under `~/.local/share/midnight-passport/local-demo` and
never controls `midnight-network`. If any required port is occupied by an
incompatible or partial stack, it refuses to start. `stack` leaves its owned
project running so setup can continue; `stop` stops that exact recorded
project while preserving its volumes.
The launcher serializes `stack`, `up`, and `stop` with a private lock at
`~/.local/share/midnight-passport/midnames-local-demo.lock`. It records full
container IDs in `owned-stack.json` and `compat-prover.json` and verifies them
before stopping its own fallback or prover. If Docker cannot confirm cleanup,
the lock remains. Check the PID recorded in that lock, confirm the launcher is
no longer active, compare the marker IDs with Docker's full IDs and Compose
project labels, stop only those exact containers, and confirm the service and
shared sponsor lease have drained before removing only this launcher's lock.
Keep the private registry, receipts and Docker volumes intact.

```sh
nix develop -c node scripts/midnames-local-demo.mjs stack
nix develop -c node scripts/midnames-local-demo.mjs up --setup \
  --passport-repo /absolute/path/to/passport
```

Create and activate the intended ACC in setup mode. Then follow
[Bootstrap the registry on an existing local stack](#bootstrap-the-registry-on-an-existing-local-stack)
and [Claim one name on the shared Ledger 9 registry](#claim-one-name-on-the-shared-ledger-9-registry)
using the fallback stack's same loopback endpoints. Both commands preserve
their original receipts; use a fresh name and private naming secret. Once the
claim receipt says `PASS`, run `up --profile /absolute/path/to/shared-claim.json`
with the same ACC option. The launcher verifies that receipt's original block,
live registry contract target, and activated ACC before enabling naming. It
will refuse the shipped `paidfix.night` receipt on a different chain. For a
later session, `check --profile ...` verifies an existing stack without
starting Docker. Use `stop` only for the Passport-owned fallback project.

This is a local transitional `.night` demo. It does not issue public
`passport.night` subdomains or implement MIP-0007's delegated registry.

This fixture uses the [`ledger-9-live` Midnames source](https://github.com/midnames/ns-sdk/tree/ledger-9-live)
on the Passport standalone Ledger 9 stack. Prepare artifacts with the Passport
SDK's pinned Nix toolchain. [The manifest](registry-manifest.json) records the
exact upstream commit and source hash; the command fetches `ns.compact` from
that branch and checks its bytes against the hash. A changed branch source fails closed
until its contract and generated artifacts are reviewed and repinned. It updates
the language pragma for Compact 0.35.0, compiles with `--feature-zkir-v3`, and
verifies each generated module, circuit, prover and verifier against the
reviewed hashes. This is a fresh local deployment; the upstream 2.1.0 SDK's
write pause applies to its previously deployed registry, not this local one.

```sh
nix develop -c node examples/midnames-local/prepare.mjs \
  --upstream-ledger9 /absolute/path/to/fresh-output
```

For an offline preparation, replace `--upstream-ledger9` with an absolute path
to a local copy of [`ns.compact` at the pinned commit](https://github.com/midnames/ns-sdk/blob/f8f2edd425221b95c9158d74e7318d2fbb4f61b2/ns.compact).
The same source hash check applies.

The output directory must be new. A failure leaves the original diagnostics
and partial output available for inspection. Use the standalone resolver
profile only on `undeployed`. It requires the deployed registry to match all
13 verifier hashes. The deployed Passport ACC must still match its own pinned
binding and be activated. The registry build and key checks are prerequisites
for live qualification.

## Bootstrap the registry on an existing local stack

The disposable qualification runner below deploys an ACC and registry together.
For a local Passport demo that already has a healthy `undeployed` Ledger 9
node, v4 indexer and proof server, `bootstrap-registry.mjs` deploys **only the
registry**. Create and activate the intended ACC first, then supply its full
64-hex contract address as the root target. The script checks the prepared registry hashes,
node/indexer finality agreement, the standalone chain name and the prover before
claiming the native lease or starting a wallet. It verifies signed source and physical
artifacts after claiming the lease, then confirms the ACC's pinned binding before
submitting a transaction. Run it only when you control the stack and no other process is using
the same local genesis funding wallet. The default Passport service and funding
service may use that seed: stop only your own instances of those services while
keeping the node, indexer and prover running, or use a separately funded wallet
in a different deployment flow. Do not stop another session's services to make
room for this command. Set `ACC_CONTRACT_ADDRESS` to the full
64-hex address of that activated ACC before running. The command also requires
15 GiB free and a free native qualification lease; reconcile an interrupted
run before starting a new bootstrap.

On the designated shared Ledger 9 stack, create the ACC with the same pinned
Passport binding before registry deployment. Reuse a verified 52-key ACC export
or prepare one with `pnpm demo setup`; keep its manifest and keys unchanged
during the run. The launcher attaches to the existing stack and creates a
private chain anchor and sponsor lease in the selected state directory:

```sh
run_dir="$HOME/.local/share/midnight-passport/shared-ledger9-$(date +%Y%m%d%H%M%S)"
install -d -m 700 "$run_dir"
MIDNIGHT_STACK=shared-ledger9 PASSPORT_REGISTRY_FILE="$run_dir/registry.json" \
  nix develop -c pnpm demo check --no-key-service
MIDNIGHT_STACK=shared-ledger9 PASSPORT_REGISTRY_FILE="$run_dir/registry.json" \
  nix develop -c pnpm demo up --contract-dir /absolute/path/to/pinned-acc/contract \
    --no-key-service --mock-passkey
```

Open the printed `http://localhost:5173/?mockPasskey` URL in a **dedicated
private browser profile**, create the account, and retain that profile and
the full 64-hex ACC address outside Git. The mock passkey is for local
development only; use a PRF-capable real authenticator for a real deployment.
Wait for the browser's created status and check the live indexed activation, then
stop only this demo and confirm its successful service drain and sponsor lease
release. The registry bootstrap below checks the live account binding and
activation again before it sends. An uncertain creation or shutdown must be
reconciled from the original deployment records and transaction IDs; do not
create another ACC merely because the browser response was lost.

```sh
PASSPORT_MIDNAMES_BOOTSTRAP=1 PASSPORT_RC_LOCALNET=1 \
MIDNIGHT_NETWORK=local MN_NETWORK_ID=undeployed \
MN_NODE_URL=http://127.0.0.1:19944 \
MN_INDEXER_URL=http://127.0.0.1:18088/api/v4/graphql \
MN_INDEXER_WS_URL=ws://127.0.0.1:18088/api/v4/graphql/ws \
MN_PROOF_SERVER_URL=http://127.0.0.1:16300 \
nix develop -c pnpm --filter passport-dapp exec node --import tsx \
  --experimental-import-meta-resolve \
  "$PWD/examples/midnames-local/bootstrap-registry.mjs" \
  "$PWD/review/midnames-bootstrap-my-run" \
  /absolute/path/to/prepared-registry \
  /absolute/path/to/acc-reference/contract \
  "$ACC_CONTRACT_ADDRESS"
```

Use the actual ports of the intended local stack; the four endpoints must be
explicit loopback URLs, and the HTTP/WS indexer pair must share a host and port.
For the designated shared Ledger 9 stack, run
`nix develop -c bash scripts/midnight-attach.sh` first, then use the endpoints
in `infra/networks/shared-ledger9.env` with this same bootstrap command. It
attaches to the running stack and performs no Docker lifecycle action. The
development genesis sponsor is public and pre-funded on this chain; coordinate
exclusive wallet use with other sessions before a deployment. The shared Passport
demo now holds the same stable native sponsor lease while its service uses this
wallet. Stop only your own demo, confirm its service drain and lease release,
then bootstrap the registry. If either run retains the lease, reconcile its
original transactions and receipts before proceeding. Supply an
activated ACC address from this exact chain, and keep a fresh private receipt
directory. A responding endpoint or funded wallet alone does not establish
that the ACC or registry is deployed.
If the shared stack's newer prover rejects activation of the pinned Compact
0.35 ACC, retain the deployed account and passkey; the
[isolated compatibility prover](../../infra/localnet/README.md#isolated-prover-for-the-pinned-compact-035-acc)
can test recovery of that same pending account against the shared node and v4
indexer. Do not start another account or call the registry bootstrap until the
live ACC is activated.
An ACC can be deployed with all 52 pinned verifier operations and still have
`booted=false`. On the current shared Ledger 9.1.0.1 node, an earlier Compact
0.35 / Compact.js 3.0.0-rc.3 attempt generated proofs on the isolated prover,
but the node rejected activation (`Custom error: 104`, `ran out of gas budget`).
The current [Compact.js release](https://docs.midnight.network/relnotes/compact-js/compact-js-3-0-0)
fixes overwrite-related gas checks but requires Compact 0.36 artifacts; the
cause of this particular node rejection has not been established.
With the released `@midnightntwrk/ledger-v9` 1.0.0 client pinned, a bounded
retry activated that same ACC on the shared chain. This result applies to the
observed local profile; confirm the live account and registry independently
on every other chain.
Keep the rejected submission as a failed attempt and retain its original
address, passkey and diagnostics. Before any further activation attempt,
reconcile the chain and investigate the rejection. Do not treat a deployed
but unactivated ACC as the root target or create a replacement merely because
the browser failed.
The registry artifacts also use Compact 0.35. If the isolated prover is
required for this chain, set the bootstrap command's explicit
`MN_PROOF_SERVER_URL=http://127.0.0.1:16301` while retaining the shared
node and v4 indexer URLs from `infra/networks/shared-ledger9.env`. Its version
preflight and an actual indexed registry deployment must pass; the alternate
endpoint alone does not establish compatibility.
Choose a fresh direct child of the SDK's ignored `review/` directory for each
receipt. The script uses the standalone genesis development seed, pays local DUST fees, and writes each
original transaction's bytes and identifier to private files before continuing.
Its receipt records the node, `midnight-ledger-v9` crate and indexer protocol
versions and requires them to remain stable through the final read. A newer
stack, including [node 2.1.101 with ledger 9.1.0.1](https://docs.midnight.network/relnotes/node/node-2-1-101)
(crate version 1.0.1), needs a fresh completed deployment and final registry
read before compatibility can be claimed; a responding endpoint alone does not
qualify that version.
It installs the 13 verifier keys in bounded waves, retires the deployment
maintenance authority, and rereads the final registry and root owner commitment
from the indexer. A failed or interrupted run retains its receipt, private root
secret and original transactions. Inspect those originals on the same chain;
never rerun the command as a blind repair or overwrite the receipt directory.
The private `root-secret.private.hex` controls the local root name and must stay
with the operator, outside Git and any browser/service request.

On `PASS`, read `registryAddress` from `bootstrap.json` and configure the demo's
`VITE_MIDNAMES_REGISTRY_ADDRESS` with it, together with
`VITE_MIDNAMES_REGISTRY_PROFILE=standalone-0.35`,
`VITE_MIDNAMES_CLAIM_PROTOCOL_VERSION=2001100` for this observed Ledger 9
generation (the isolated fixture pins the same protocol on a separate chain),
`VITE_MIDNAMES_NAMESPACE=night`, `VITE_MIDNAMES_NETWORK_ID=undeployed`, and
`VITE_MIDNAMES_INDEXER_URL` / `VITE_MIDNAMES_INDEXER_WS_URL` matching the
bootstrap pair. The deployed root is a transitional
`.night` registry with a local one-unit NIGHT price policy. It does not issue
public `passport.night` names or implement MIP-0007 delegated routing. A name
still needs its separate owner-proved claim after the ACC exists.

### Claim one name on the shared Ledger 9 registry

`qualify-shared-claim.mjs` is a bounded operator fixture for an **existing**
activated ACC and registry on the designated shared chain. It never deploys an
ACC or registry. It requires the free stable native sponsor lease, a clean
signed source, the pinned registry and reference artifacts, 15 GiB free,
and a fresh private receipt directory. The owner process creates or reopens a
32-byte naming secret in an operator-owned mode-0700 directory; only that
process reads it. The sponsor receives the proved transaction and public
commitment, not the secret. Preserve the same secret file with the name for
future target updates and recovery; losing it can make this name unrecoverable.

First attach with `nix develop -c bash scripts/midnight-attach.sh` and verify
the intended ACC and registry addresses from their original receipts. The
shared prover has not been qualified for the pinned Compact 0.35 registry
claim proof. Start only the separate, no-volume compatibility prover on port
16320 (`PASSPORT_COMPAT_PROVER_PORT=16320`) using
the [localnet recipe](../../infra/localnet/README.md#isolated-prover-for-the-pinned-compact-035-acc).
Use a new Compose project name and stop only that project afterward. Then run
from the SDK root with a new output name and a private naming-secret path:

```sh
PASSPORT_MIDNAMES_SHARED_CLAIM=1 PASSPORT_MIDNAMES_APPROVED_NAME=alice.night \
PASSPORT_RC_LOCALNET=1 MIDNIGHT_NETWORK=local MN_NETWORK_ID=undeployed \
MN_NODE_URL=http://127.0.0.1:9944 \
MN_INDEXER_URL=http://127.0.0.1:8088/api/v4/graphql \
MN_INDEXER_WS_URL=ws://127.0.0.1:8088/api/v4/graphql/ws \
MN_PROOF_SERVER_URL=http://127.0.0.1:16320 \
nix develop -c pnpm --filter passport-dapp exec node --import tsx \
  --experimental-import-meta-resolve \
  "$PWD/examples/midnames-local/qualify-shared-claim.mjs" \
  "$PWD/review/midnames-shared-claim-my-run" \
  /absolute/path/to/prepared-registry \
  /absolute/path/to/acc-reference/contract \
  "$REGISTRY_CONTRACT_ADDRESS" "$ACC_CONTRACT_ADDRESS" alice \
  /absolute/private/name-alice.private.bin
```

The fixture checks the exact deployed ACC and 13 registry verifier keys before
using the shared genesis wallet to fund a fresh, separately seeded sponsor.
The sponsor seed is saved privately with the run and must be preserved for
reconciliation. It keeps the original submitted transaction
bytes and IDs, verifies a distinct naming owner commitment and exact contract
target through both the Midnames adapter and the generated registry reader,
requires the original transaction's indexed `SUCCESS`, then releases the lease
only after wallet shutdown, finality and unchanged
inputs. It creates two local funding transactions to give that sponsor NIGHT
and DUST before the name claim; their exact receipts remain in the run directory.
If the run fails after any send, preserve its lease, original bytes, naming
secret and all receipts. Reconcile that same chain and transaction before any
fresh claim. Never rerun the command as a blind repair.

For a failed run with a fenced original, use the read-only reconciliation first:

```sh
nix develop -c pnpm --filter passport-dapp exec node --import tsx \
  --experimental-import-meta-resolve \
  "$PWD/examples/midnames-local/reconcile-shared-claim.mjs" \
  "$PWD/review/midnames-shared-claim-my-run"
```

It requires the two exact funding transactions to have canonical finalized
`SUCCESS`, the claim's retained bytes and identifiers to match the journal,
both claim identifiers to be absent, and a canonical finalized block after the
claim intent expires. It never submits a transaction. After reviewing that
result, append `--release` to write a separate reconciliation receipt and
clear only the exact pinned native lease. The original failed receipt and
dispatch fence remain intact. An accepted or ambiguous original must retain
the lease for further investigation.

On the shared Ledger 9 stack, the first fresh-sponsor attempt reached the
node with exactly two DUST spends, then received `Custom error: 104`. Its
two funding transactions finalized successfully, but the exact claim was not
indexed after expiry. This is a rejected qualification, not evidence that
`alice.night` was issued. A local Ledger 9 replay of that transaction and the
root-assisted attempt isolated the cause: each `create_domain` transcript
claimed 1,364 deleted bytes, but executing against the indexed registry state
deleted 1,136. A declared credit of 1,137 bytes is rejected; 1,136 or less
passes the same replay. A fresh adjusted `create_domain` finalized successfully
for `gasfix.night`, but its following unadjusted `transfer_domain` was rejected
with error 104. That transfer declared 788 deleted bytes against 656 measured;
657 or more fails the same replay. The standalone owner fixtures rebuild both
one-call operations before proving with zero deletion credit, retaining their
programs, effects and value transfers. This supports the guaranteed transcript
used by root-assisted issuance and the fallible transcript used by a paid claim.
The partial issuance and exact rejected transfer remain preserved.

After exact partial reconciliation, a transfer-only recovery finalized
`gasfix.night` under its distinct owner and verified its ACC target. A fresh
paid claim at signed `3c9f998` finalized `paidfix.night` with a separately
seeded sponsor funded from the shared local genesis wallet. Its indexed claim
and generated registry reader agreed on the owner commitment and activated ACC
target; its receipt is **PASS**, with the wallet stopped, inputs unchanged and
native lease released. The first funded `paidfix.night` attempt had stopped
before proof because the adjustment initially assumed a guaranteed transcript;
read-only reconciliation verified both funding transactions and no submitted
claim before releasing that attempt's lease. The successful run is a new,
independently funded claim, not a replay of the earlier attempt.

### Release Ledger 9 native claim retry

An isolated node 2.1.101, indexer 4.4.101, and prover 9.0.2 run at signed
`3dda8ec` passed the complete failed-claim retry fixture using the unchanged
Compact 0.35 ACC and registry artifacts. Its first sponsored transaction
finalized `PARTIAL_SUCCESS`: the DUST fee succeeded and the registration
claim failed. The sponsor archived that exact original after canonical finality
and an absent-name check. Headless Chromium released the browser record after
a reload. A new quote, owner proof, and sponsor dispatch then finalized
`SUCCESS` to the same ACC and the registry reader confirmed the binding.
Both originals were dispatched once. The private receipt is
`review/midnames-claim-retry-20261120-ledger102`; its supervisor stopped the
three exact owned containers, preserved volumes, and released the native lease.
The [redacted summary](evidence/release-ledger9-claim-retry-20261120.json)
records the image pins, transaction IDs, outcome, and remaining limits.

A later isolated release-stack run at signed `b58668e8` repeated the exact
indexed failure and browser release, then sent the fresh prepared claim from
the reference app through the same-origin sponsor HTTP fence. Headless
Chromium reviewed the saved quote, made one submission request, lost the
sponsor's 202 response, reopened with the same virtual credential, and
confirmed the original. The retry indexed `SUCCESS` to the same ACC; each
original was dispatched once. Its [redacted browser retry receipt](evidence/release-ledger9-browser-retry-20261120.json)
records the separate transaction identifiers, browser checks, and exact-owned
cleanup. The new quote, owner proof, and sponsor balance remained host-driven;
the failed-original release and fresh send used separate browser profiles.

The release node rejected an earlier activation with error 104 when the
reference client used Ledger 9 `1.0.0-rc.5`. A full Midnight.js 5.0.1 client
cannot load this contract's Compact runtime 0.20 artifacts. The passing run
kept the artifact-compatible Midnight.js and Compact.js versions while
pinning every reference-client `@midnightntwrk/ledger-v9` dependency to
`1.0.2`. This isolates a working local configuration; it does not establish
the exact internal cause of either earlier gas rejection or online
compatibility. Prepare an **idle** exported reference tree inside the Nix
shell before a release-stack run:

```sh
nix develop -c node experiments/acc-0.35/prepare-ledger9-client.mjs \
  /absolute/path/to/compiled/contract
```

The command verifies the pinned ACC manifest, updates only that generated
tree's client package and lockfile, installs its dependencies, and refuses
mixed Ledger 9 versions. The shared-stack demo launcher invokes it for its
selected contract tree; an isolated native fixture must receive a separately
prepared tree. Do not use this pin as a substitute for the separate Compact
0.36 migration gate in [#363](https://github.com/input-output-hk/midnight-passport-sdk/issues/363).

### Compact 0.36 registry compatibility probe

A [read-only compatibility receipt](evidence/compact036-readonly-20261119.json)
records a rebuild of the exact pinned Midnames source with only its language
pragma changed from 0.22 to 0.28. Compact 0.36.0 generated runtime 0.21.0 code
and all 13 ZKIR circuits. Regenerating all 13 key pairs produced byte-identical
ZKIR, prover keys and verifier keys to the pinned Compact 0.35 standalone
manifest. The `create_domain` and `transfer_domain` circuits measured
`k=15`/20,954 rows and `k=14`/8,288 rows, respectively. A synthetic Ledger 9
transcript replay accepted both operations, and the 0.36 generated reader
decoded the existing `paidfix.night` contract target from the deployed registry
at node-finalized block 20,862.

This establishes compiler output and read compatibility for this exact source;
it does not qualify 0.36 proof generation, the transaction composer, fee
calculation, or a submitted write. The live 0.35 registry and ACC were not
changed. Keep the current deletion-credit guard for all deployed fixture calls
until an exact original 0.36 transaction passes its own native gate. Key-byte
equality alone is not authorization to change the live profile.

For an operator-controlled local registry, a separate root-assisted fixture
can issue the name without a paid claim. It proves `create_domain` under the
root owner's existing witness, then proves `transfer_domain` to a distinct
naming witness. The sponsor pays DUST, but the registry receives no name
purchase payment. Keep the root and name witnesses as separate private
32-byte files and use a previously funded sponsor seed. This is an explicit
administrator issuance path, not proof that paid self-registration works.
Bootstrap stores the root witness as a private 64-character hex file. Convert
it once to the raw format expected by the owner child, in a private directory:

```sh
umask 077
ROOT_HEX=/absolute/path/to/bootstrap/root-secret.private.hex \
ROOT_BIN=/absolute/private/root-secret.private.bin \
nix develop -c python3 - <<'PY'
import os
import pathlib
import stat

source = pathlib.Path(os.environ['ROOT_HEX'])
target = pathlib.Path(os.environ['ROOT_BIN'])
parent = target.parent.stat()
existing = source.lstat()
assert stat.S_ISDIR(parent.st_mode) and parent.st_mode & 0o077 == 0
assert stat.S_ISREG(existing.st_mode) and existing.st_mode & 0o077 == 0
assert existing.st_uid == os.getuid() and parent.st_uid == os.getuid()
raw = bytes.fromhex(source.read_text().strip())
assert len(raw) == 32
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
try:
    assert os.write(fd, raw) == 32
    os.fsync(fd)
finally:
    os.close(fd)
PY
```

```sh
PASSPORT_MIDNAMES_ADMIN_ISSUE=1 \
PASSPORT_MIDNAMES_APPROVED_NAME=alice.night \
PASSPORT_RC_LOCALNET=1 MIDNIGHT_NETWORK=local MN_NETWORK_ID=undeployed \
MN_NODE_URL=http://127.0.0.1:9944 \
MN_INDEXER_URL=http://127.0.0.1:8088/api/v4/graphql \
MN_INDEXER_WS_URL=ws://127.0.0.1:8088/api/v4/graphql/ws \
MN_PROOF_SERVER_URL=http://127.0.0.1:16320 \
nix develop -c pnpm --filter passport-dapp exec node --import tsx \
  --experimental-import-meta-resolve \
  "$PWD/examples/midnames-local/qualify-admin-issued-name.mjs" \
  "$PWD/review/midnames-admin-name-my-run" \
  /absolute/path/to/prepared-registry \
  /absolute/path/to/acc-reference/contract \
  "$REGISTRY_CONTRACT_ADDRESS" "$ACC_CONTRACT_ADDRESS" alice \
  /absolute/private/root-secret.private.bin \
  /absolute/private/name-alice.private.bin \
  /absolute/private/sponsor-seed.private.hex
```

The fixture refuses a name already present, checks the deployed registry and
ACC, requires two DUST spends in each original transaction, and waits for
indexed `SUCCESS` in a canonical finalized block before the next operation.
If a submission is uncertain, it retains the native lease and original
transaction bytes. Do not rerun blindly or describe a partially issued name
as owner-held.

The first shared-chain root-assisted attempt was also rejected with error 104
at `create_domain`, before any transfer. Its source receipt is **FAIL** and
must not be counted as issuance. For this exact failure, run
`reconcile-admin-name.mjs /absolute/path/to/failed-run` in the pinned Nix
shell. It checks the original bytes and identifiers, both absent indexer
records, a canonical finalized block after expiry, and the still-absent name.
Only after reviewing those checks may the operator append `--release` to
clear that run's exact pinned lease. The command never submits a transaction.

The later `gasfix.night` run finalized `create_domain` but its original
`transfer_domain` was rejected. The same reconciliation command recognizes a
two-transaction partial receipt: it verifies the first transaction's canonical
`SUCCESS`, the second transaction's original bytes and absence after finalized
expiry, and the name still held by the registry root. Only then may `--release`
free that exact lease. Preserve both transaction files and the original root,
name and sponsor secrets. To finish this **same name** after reconciliation,
rerun the command above with a fresh output directory, the same label and
secret paths, `PASSPORT_MIDNAMES_RECOVER_TRANSFER=1`, and the original run
directory as the last argument. The recovery preflight requires the released
partial reconciliation and the exact root-held name; it submits only a new
`transfer_domain`, never another `create_domain` or the rejected transfer.

Only a fixture with a final **PASS** establishes its scoped local name and ACC
binding. The completed admin recovery and fresh paid claim qualify those two
local fixture paths. They do not exercise the full browser onboarding ceremony,
passkey-based naming recovery, public `passport.night` issuance or online
sponsor funding. Keep #316's remaining P2/P5/P8 conformance gates open until
those paths are qualified.

The standalone fixture has the upstream transitional registry administration
semantics. A name claim needs an owner-controlled proof witness. Use synthetic
wallets for this qualification and preserve all original transaction references
when a submission has an uncertain result.

For #334, `midnames-claim-partial-probe-<fresh-name>` selects an isolated
policy-race mode. It prepares and fences one sponsored claim, then has the
registry owner disable registration after sponsor admission but before that
original is submitted. The run passes only if the live indexer reports
`PARTIAL_SUCCESS` for the exact original transaction, its segments prove that
only the registration claim failed while the DUST fee succeeded, the name
remains absent, and the SDK classifies that exact claim segment as failed.
A node rejection, missing finality, different partial result or successful claim
is not a pass. The mode preserves its original bytes, identifiers and chain
volumes; it does not release the browser journal or submit a replacement claim.

`midnames-claim-retry-<fresh-name>` extends this isolated lane. After the
owner proof, it creates a separate sponsor journal with the exact prepared
bytes, reviewed quote, owner commitment and balance intent. That journal fences
the one original before dispatch. After the indexed failure, the sponsor
checks its raw transaction, identifiers, claim and fee segments, canonical
finalized block, free name and activated ACC twice. It archives its whole
private journal with the fee outcome before offering a distinct new quote.
A fresh persistent Chromium profile opens the reference app,
retains the original receipt, checks the live indexed segment result and registry,
and explicitly releases it. After a browser restart, the fixture checks that the
same original is archived with `CLAIM_SEGMENT_FAILURE` and no active claim remains.
Only then does the host restore the root's registration policy. A separate
headless browser profile opens the actual Passport name form with an already
activated ACC, obtains a fresh sponsor quote, uses a virtual PRF credential to
prove and prepare the new claim, reviews the displayed terms, and sends that
original once through the sponsor HTTP fence. After the deliberately lost
response, the same persistent browser profile reopens and checks the original.
The host then checks indexed success and the live binding. Its private
`indexed-claim-retry.json` retains both public receipts, the browser release
receipt and dispatch counts; `native-sponsor-failure-archive.json` records the
separate sponsor retirement. Signed source `46add31e` passed this complete
isolated Ledger 9 lane on 2026-11-20. The [redacted page-owned receipt](evidence/release-ledger9-page-claim-retry-20261120.json)
records one quote, proof, preparation and dispatch; the first original's indexed
claim failure, browser release and sponsor archive; the new original's indexed
success and recovery after a lost response. The browser in this isolated lane
still uses its direct live-indexer recovery port. Its ACC login connector is a
fixture for an already activated account, and the two attempts use separate
browser profiles. This does not qualify the full demo's combined ACC create/open
ceremony, one profile across both attempts, a real passkey provider or an online
registry.

Signed source `e3ec3608` passed a fresh isolated Ledger 9 run in which the
Passport page imported the exact indexed failed original into its
virtual-credential profile, used the original sponsor's archived journal to
release it, and retained the failed receipt after reload. The same profile
then obtained one quote, proved, prepared and dispatched a distinct retry once,
lost the sponsor response, and recovered indexed `SUCCESS` and the live binding
to the same ACC. The [redacted same-profile receipt](evidence/release-ledger9-page-same-profile-20261120.json)
records the two originals and exact-owned cleanup. The first original was still
prepared outside the page, and the ACC login connector supplied an already
activated account. This qualifies local release-to-retry continuity, not
same-profile preparation of both originals, combined ACC creation, a real
passkey provider, an online registry or a released package.

Signed source `4a6c7642` passed the stronger fresh isolated Ledger 9 lane:
the Passport page itself obtained both sponsor quotes, proved and prepared both
originals with one persistent virtual naming credential, and dispatched each
exact original once. Its first HTTP send outcome was unknown, but the saved
transaction finalized with only the claim segment failed. The sponsor archived
that exact fee-only failure before the page released it; the page kept the
failed receipt across reload. A fresh reviewed retry then finalized with
`SUCCESS`, and the same page profile recovered its live binding to the same
activated ACC after a deliberately lost sponsor response. The
[redacted two-original receipt](evidence/release-ledger9-page-two-originals-20261120.json)
records both transaction identifiers, canonical finality, page request counts
and exact-owned cleanup. The ACC login connector still supplies an already
activated test account, and the naming credential is virtual. This does not
qualify combined ACC create/open and claim, a real passkey provider, online
registry agreement, `passport.night`, or Compact 0.36.

## Run the shielded deposit by name

Use a clean, GPG-signed SDK checkout with workspace dependencies installed and
built, the Compact 0.35.0 reference ACC worktree and its verified cached keys.
Use the pinned Nix shell, at least 15 GiB of free space, Docker with at least
24 GiB of memory, and free native qualification ports. See the
[qualification runbook](../../docs/agent-runbook.md#qualification-selection).

From the SDK root, after preparing the registry above, run:

```sh
nix develop -c env -u LD_DYLD_PATH PASSPORT_MIDNAMES_NATIVE=1 PASSPORT_RC_LOCALNET=1 \
  node examples/midnames-local/qualify-deposit.mjs midnames-deposit-example \
  /absolute/path/to/prepared-registry \
  "$PWD/experiments/acc-0.35/work/acc-6458ed5/contract"
```

Choose a new output name for each run. If Docker's default address pools are
full, supply an unused private `10.x.x.x/24` to `/29` subnet as the final
argument. The runner creates and stops its own isolated stack and preserves its
volumes and evidence under `review/<output-name>/`. Resolve an uncertain
submission from its recorded original identifiers before taking another action.

The fixture activates an ACC and registers `alice.night` through the isolated
registry. After setup stops its wallet, a separate sender process reopens the
same synthetic genesis wallet. That process receives the registry address and
name. The recipient's ACC signing and viewing keys stay in the owner fixture. It mints a synthetic shielded token and displays the full resolved
destination, asset and amount before fixture approval. After proving and
balancing, it reads the current ACC encryption key and resolves the name again
before dispatch. The owner process decrypts the resulting inbox entry and
matches the coin to the original transaction's on-chain commitment and current
holdings. See [named shielded deposits](../../docs/site/names.md#deposit-a-shielded-asset-by-name).

To display the payment and the independently verified owner result:

```sh
jq '{review, txHash, inboxIndex, dispatches}' review/midnames-deposit-example/sender/sender.json
jq '{ownerOpenedReceipt, originalOutputMatched, verifiedHeld, commitment}' review/midnames-deposit-example/worker.json
```

### Review the named deposit in the sender browser

Use a fresh output name beginning with `midnames-deposit-browser-` to open a
sender-owned loopback review page before the deposit is prepared or proved:

```sh
nix develop -c env -u LD_DYLD_PATH PASSPORT_MIDNAMES_NATIVE=1 PASSPORT_RC_LOCALNET=1 \
  node examples/midnames-local/qualify-deposit.mjs \
  midnames-deposit-browser-my-run /absolute/path/to/prepared-registry \
  /absolute/path/to/acc-reference/contract
```

Pass an unused private subnet as the final argument when Docker's default
address pools are full.

The default qualification mode launches headless Chromium and clicks **Approve
deposit** after capturing the displayed name, network, registry, provider,
namespace, full resolved ACC, `deposit_shielded` operation, synthetic asset
color and smallest-unit amount. Set `PASSPORT_MIDNAMES_BROWSER_MANUAL=1` for a
visible browser and a human decision. The local sender checks its prepared and
dispatch counters are still zero before and after review, then rechecks the
name and ACC key before one dispatch. Decline, closing the page or waiting two
minutes refuses the named payment. Setup and token-mint transactions may have
already completed; keep that run's receipt and choose a fresh name for another
run. The browser receives no recipient signing key, viewing key or passkey.

The automated native run on signed source `b87ed6c` passed on isolated
`undeployed`: one sender dispatch finalized and the owner matched the original
output to a decrypted, still-held coin. The screenshot and redacted receipts
are in `review/midnames-deposit-browser-20261116a/`. The runner verified
unchanged inputs, stopped its three exact owned containers, retained their
volumes and released the lease. Automated clicking demonstrates page rendering
and operation order; it does not establish human approval, an online provider,
public `passport.night`, or MIP-0007 delegated routing.

### Deposit to an existing named ACC on shared Ledger 9

`qualify-shared-deposit.mjs` uses an already activated ACC and an already claimed
local `.night` name on the designated shared chain. It does not deploy either
contract. Its separate sender process opens the public local genesis wallet,
mints 10 smallest units of a new synthetic shielded asset, shows the resolved
ACC and payment in a localhost browser review, then calls `deposit_shielded`.
It retains the original transaction bytes and IDs before its one dispatch.
The recipient's passkey, viewing key and naming secret stay outside the sender.

First attach with `nix develop -c bash scripts/midnight-attach.sh`. Confirm the
name, registry and ACC from their original receipts, keep the shared sponsor
wallet unused by another session, and start only the
[digest-pinned compatibility prover](../../infra/localnet/README.md#isolated-prover-for-the-pinned-compact-035-acc)
on port 16320 with a fresh project name. The fixture requires a clean signed
source, a free native lease, 15 GiB of disk space, the pinned prepared registry
and ACC artifacts, and API v4 indexer endpoints. For example, from this SDK
checkout, set `REGISTRY_CONTRACT_ADDRESS` and `ACC_CONTRACT_ADDRESS` to the
64-hex values in **your** shared-chain receipts and use their prepared paths:

```sh
export PASSPORT_COMPAT_PROVER_PROJECT=midnight-passport-compat-deposit-my-run
export PASSPORT_COMPAT_PROVER_PORT=16320
nix develop -c docker compose -p "$PASSPORT_COMPAT_PROVER_PROJECT" \
  -f infra/localnet/docker-compose.compat-prover.yml up -d --no-build --pull never proof-server

PASSPORT_MIDNAMES_SHARED_DEPOSIT=1 PASSPORT_MIDNAMES_APPROVED_NAME=alice.night \
PASSPORT_RC_LOCALNET=1 MIDNIGHT_NETWORK=local MN_NETWORK_ID=undeployed \
MN_NODE_URL=http://127.0.0.1:9944 \
MN_INDEXER_URL=http://127.0.0.1:8088/api/v4/graphql \
MN_INDEXER_WS_URL=ws://127.0.0.1:8088/api/v4/graphql/ws \
MN_PROOF_SERVER_URL=http://127.0.0.1:16320 \
nix develop -c pnpm --filter passport-dapp exec node --import tsx \
  --experimental-import-meta-resolve \
  "$PWD/examples/midnames-local/qualify-shared-deposit.mjs" \
  "$PWD/review/midnames-shared-deposit-my-run" \
  /absolute/path/to/prepared-registry \
  /absolute/path/to/acc-reference/contract \
  "$REGISTRY_CONTRACT_ADDRESS" "$ACC_CONTRACT_ADDRESS" alice.night
```

A `SENDER_PASS` receipt proves the one original sender transaction finalized,
the name stayed bound, inputs were unchanged, the sender wallet stopped and the
native lease was released. It is not yet an owner receipt. Reopen the **same**
ACC with its saved passkey profile in the reference demo, choose **Passport
account → Balances → Read shielded holdings**, and match the displayed inbox
index, full asset color and amount to `sender/sender.json`. Only the owner can
open that sealed inbox; keep the browser profile and private screenshot outside
Git. The [redacted shared-chain result](evidence/shared-ledger9-paidfix-deposit-20261118.json)
records a finalized `paidfix.night` send and the matching mock-passkey owner
holding on one local chain. It does not qualify a human approval, real
authenticator, online provider, or public `passport.night` name.

If a run fails, preserve its receipt and any prepared
`sender/deposit.private.bin`; do not submit a replacement while the native
lease is retained. Run `reconcile-shared-deposit.mjs` with that run's absolute
receipt directory, first without and then, only for a confirmed
`RECONCILED_PREPROOF`, `RECONCILED_REJECTED` or `RECONCILED_LANDED` outcome,
with `--release`. The preproof lane requires no prepared original and a stopped
sender. A prepared original needs a later canonical finalized block after its
**latest** intent TTL before it can be called rejected. The landed lane checks
the exact saved bytes, every original identifier, success and canonical block.
All lanes recheck the name, ACC, unchanged inputs and owned cleanup; an
ambiguous original or incomplete cleanup remains fenced. Stop only your
compatibility prover
project, without `-v`:

```sh
nix develop -c docker compose -p "$PASSPORT_COMPAT_PROVER_PROJECT" \
  -f infra/localnet/docker-compose.compat-prover.yml down
```

Do not stop the shared project.

## Run the named ACC-to-ACC NIGHT payment

Use the same command with a fresh output name beginning with
`midnames-night-send-`. This mode deploys a second ACC. The `alice.night`
record has a different profile default so the run can verify operation-specific
contract routing. The fixture starts the source ACC with 10 smallest NIGHT
units and requests a payment of 4 to the named account.

For the retained Compact 0.35 binding on Ledger 9, the fixture rebuilds each
single-call `deposit_unshielded` transaction with the deleted-byte credit
measured against the exact indexed state and cost model used to prepare that
call. The generated transcript can claim more credit than execution earns;
dropping all credit instead exhausts this call's gas budget. The helper refuses
another operation or unsupported partition and proves and balances the rebuilt
transaction before submission. This adjustment does not alter the deployed
verifier key or qualify a different Compact build.

The synthetic owner approves a JubJub withdrawal to the controlled wallet and
the recipient's separate `deposit_unshielded` call in one review. The fixture
interrupts the flow after withdrawal finality. It reopens the durable intent
and checks that the deposit consumes the exact original wallet output. A final
read of the same intent must leave both dispatch counts at one. The journal
and proof/node receipts are under `review/<output-name>/night-send/` and
`worker.json`.

If the withdrawal finalized and the deposit has no dispatch fence, continuing
the original intent can prepare its deposit. After either dispatch fence, check
the original identifiers. A failed or uncertain original deposit stays fenced
for operator reconciliation. If the name changes after withdrawal, the flow
keeps the funds in the controlled wallet and refuses to redirect them.

### Review the two-leg NIGHT payment in the owner browser

Use a fresh `midnames-night-browser-` output name to show one combined owner
review before the withdrawal signature:

```sh
nix develop -c env -u LD_DYLD_PATH PASSPORT_MIDNAMES_NATIVE=1 PASSPORT_RC_LOCALNET=1 \
  node examples/midnames-local/qualify-deposit.mjs \
  midnames-night-browser-my-run /absolute/path/to/prepared-registry \
  /absolute/path/to/acc-reference/contract
```

Pass an unused private subnet as the final argument if Docker's default pools
are full. The default mode uses headless Chromium to capture the exact name,
network, registry/provider, source and recipient ACCs, controlled bridge
wallet, amount in smallest NIGHT units and both contract operations, then
clicks **Approve both operations**. Set `PASSPORT_MIDNAMES_BROWSER_MANUAL=1`
to show the browser for a human-run local demonstration. A manual Decline
refuses the payment; page close and a two-minute timeout fail the run without
an owner signature or payment dispatch. Setup funding transactions may already
have completed. Preserve that failed run and use a fresh output name for
another attempt.

For an automated negative run, use a fresh output name beginning with
`midnames-night-browser-decline-` and the same command and pinned inputs. This
mode clicks **Decline** and passes only when Chromium records that decision,
the source and target ACC balances remain 10/0, and the owner signature,
payment-leg dispatch and durable payment journal counts remain zero. A timeout
or page close is an error, never evidence of an explicit decline.

For a name-change negative run, use a fresh output name beginning with
`midnames-night-browser-repoint-` and the same command and pinned inputs. The
browser approves the original `alice.night` target. Before the owner signs, the
fixture activates another ACC and changes the root-owned registry record to
that ACC on-chain. The run passes only if a fresh resolution sees the new
target, the durable intent still names the original target, neither payment
leg dispatches, no owner payment signature occurs, and the source, original
target and new target balances remain 10/0/0. The changed mapping refuses
that reviewed intent; start a fresh review for any new payment.

The signed `ec83ce9` native run `midnames-night-browser-20261116a` passed on
isolated `undeployed`. Its `night-send/browser-review.json` recorded zero owner
signatures and zero payment dispatches at review. After the automated click,
the existing durable intent withdrew once, paused at 6/0, reopened and
deposited the exact original bridge output once, ending at 6/4. It recorded
one owner signature and no replay broadcasts. The runner verified unchanged
inputs, stopped its three exact owned containers, retained volumes and
released the lease. This is a synthetic local owner and automated click; it
does not qualify passkey consent, a Passport demo send page, public
`passport.night`, online providers or MIP-0007 delegated routing.

The [22 November Ledger 9 comparison](evidence/ledger9-night-by-name-prover-comparison-20261122.json)
retested this route on a fresh release node and Indexer API v4. The release
prover `9.0.2` refused the Compact 0.35 JubJub withdrawal proof with HTTP 400
(`The constraint system is not satisfied`) before a withdrawal original was
created. A second isolated run at signed `880f14c8` held the release node,
indexer, reference client and contract artifacts fixed and selected the first
stable `9.0.0` prover. It reached the same withdrawal and received the same
HTTP 400 before an original was created. This places the observed
incompatibility at or before the first stable release; it does not establish
the cause. The [ledger release notes](https://github.com/midnightntwrk/midnight-ledger/blob/proof-server-9.0.0/.github/release-notes/ledger-9.1.0.0.md#breaking-changes-or-required-actions-for-developers)
describe changed proof and verifier-key material, but the effect on this
exact circuit needs separate verification. Selecting the pinned `9.0.0-rc.8`
prover on the same release node/indexer, signed `3ae84d13`,
completed the automated browser review, one finalized withdrawal, durable
restart, exact bridge-coin deposit, and indexed 10/0 → 6/0 → 6/4 ACC balances.
For this isolated comparison only, set `PASSPORT_MIDNAMES_DIAG_RC_PROVER=1` in
the inner `env` list of the native command above; the default remains the
`9.0.2` release prover. `PASSPORT_MIDNAMES_DIAG_PROVER=9.0.0` selects the
digest-pinned first stable prover and `9.0.1` selects the next stable candidate
for further isolated diagnosis; neither is a supported demo profile. The
shared-stack demo has a separate, already documented
[`PASSPORT_COMPAT_PROVER=1`](../../infra/localnet/README.md#isolated-prover-for-the-pinned-compact-035-acc)
option. The release prover still needs a compatible withdrawal proof before
this route can be claimed as release-stack qualified. The RC-prover PASS uses
a synthetic owner and automated click, not a real passkey-provider ceremony.

A separate [offline Compact 0.36 ACC probe](evidence/compact036-acc-withdrawal-key-probe-20261122.json)
copied the exact pinned source without editing it. All 52 generated ZKIR files
matched the 0.35 artifacts byte for byte. Recompiling the same JubJub
withdrawal ZKIR with the pinned 0.35 ZKIR tool reproduced the deployed key
pair; the 0.36 tool's newer ZKIR generator deterministically produced a
different prover and verifier key pair of the same format and lengths. The
`deposit_unshielded` control keys stayed byte-identical. This is a concrete
key-generation compatibility lead. A subsequent
[isolated stable-prover probe](evidence/stable-withdrawal-036-key-probe-20261122.json)
used the exact source-withdrawal witness, supplied the 0.36-generated
withdrawal key pair to release proof server `9.0.2`, and received nonempty
proof bytes. The diagnostic stopped at that response. The deployed ACC still
had its 0.35 verifier key; no full transaction was proved or submitted and
both ACC balances stayed 10/0. A second, signed
[same-witness control](evidence/stable-withdrawal-036-key-probe-20261122.json)
sent one exact serialized withdrawal preimage to that prover twice. The
deployed 0.35 key pair returned HTTP 400; changing only to the 0.36 pair
returned nonempty proof bytes. This isolates the key-material difference at
the prover request boundary. The retired 0.35 ACC cannot be repaired by
replacing local files.

The [complete offline key inventory](evidence/compact036-acc-key-inventory-20261122.json)
compared all 52 pinned ACC ZKIR circuits against keys regenerated with the
Compact 0.36 tool: 48 prover and 48 verifier pairs changed; four stayed
identical. A later [isolated hybrid diagnostic](evidence/stable-hybrid-night-send-20261122.json)
deployed an ordinary recipient ACC and a source ACC with only its JubJub
withdrawal verifier replaced by the 0.36-generated key. The source retained
the old runtime, ZKIR and other 51 verifier keys, so it is not a supported SDK
binding. With release proof server `9.0.2`, an automated browser review and
one owner signature preceded exactly one withdrawal and one deposit dispatch.
Both transactions finalized and indexed; ACC balances moved 10/0 → 6/0 →
6/4, consuming the exact withdrawal output with no replay broadcast. The
fresh parent confirmed unchanged inputs, three stopped owned containers,
retained volumes and a released lease. This proves a chain-valid two-leg
payment for this **diagnostic hybrid deployment**, not compatibility of an
already deployed 0.35 ACC. A separately versioned complete artifact/binding,
all matching keys, and its native and provider qualification remain required
for a supported release route. The browser owner was synthetic.

The diagnostic lane uses a fresh `midnames-night-browser-keyprobe-` output
name and `PASSPORT_MIDNAMES_DIAG_KEY_DIR` pointing to a private directory
containing only the regenerated `withdraw_unshielded_with_jubjub.prover` and
`.verifier`. The parent pins their published SHA-256 values before creating
resources and after cleanup. It runs the normal synthetic browser review and
compares both key pairs against the same proof preimage. It stops on the
alternate proof response, before balancing or dispatch. This lane
is a prover compatibility test, not an operator payment route.

The hybrid lane uses a fresh `midnames-night-browser-hybrid-` output name and
the same private `PASSPORT_MIDNAMES_DIAG_KEY_DIR`. It verifies the entire
deployed source verifier roster and refuses a mismatch before proof. It is
restricted to isolated diagnostic qualification; do not use its hybrid ACC as
an application or release binding.

A subsequent [full-roster diagnostic](evidence/stable-full-roster-night-send-20261122.json)
repeated the same reviewed two-leg payment after deploying a new source ACC
with **all 52** 0.36-generated verifier keys. The release `9.0.2` prover
finalized the withdrawal and recipient deposit, again moving 10/0 → 6/0 →
6/4 with one dispatch per leg and no replay. The runner checked every on-chain
verifier hash against the [complete inventory](evidence/compact036-acc-key-inventory-20261122.json)
and verified authority retirement. This removes the one-circuit hybrid from
the native diagnostic but does not create an SDK-supported binding: its
module/runtime/ZKIR remain the 0.35 build, key restoration and registry
versioning are still old, and the remaining ACC circuits have not been proved
under the alternate keys. [ADR 0020](../../docs/adr/0020-ledger9-acc-key-generation-binding.md)
sets the version-axis admission gate.

The full-roster lane uses a fresh `midnames-night-browser-full036-` output
name and a private `PASSPORT_MIDNAMES_DIAG_KEY_DIR` with exactly the 52
inventory-matched `.verifier` files and the pinned JubJub withdrawal
`.prover`. It refuses missing, extra, symlinked or mismatched files before
creating the isolated stack. Use it only for a fresh isolated diagnostic;
the existing retired ACC cannot accept this roster.

### Provisional candidate ACC native gate

The `midnames-acc-candidate-` lane uses the separately staged, complete
`acc-s3r1.1-zkir036` asset tree. It verifies every file against the derived
manifest before claiming the native lease, selects that same tree for the
compiled contract, verifier reads and transaction proving, then deploys and
activates a fresh JubJub ACC on an isolated Ledger 9 stack. It checks all 52
on-chain verifier assignments and retired maintenance authority. The parent
checks the physical inputs again, stops only its recorded containers and
releases its exact lease. It requires 50 GiB free and 24 GiB Docker memory.

```sh
PASSPORT_MIDNAMES_CANDIDATE_ASSETS=/absolute/path/to/verified-candidate-assets \
nix develop -c env -u LD_DYLD_PATH \
  PASSPORT_MIDNAMES_NATIVE=1 PASSPORT_RC_LOCALNET=1 \
  node examples/midnames-local/qualify-deposit.mjs \
  midnames-acc-candidate-fresh-run \
  - \
  /absolute/path/to/acc-reference/contract
```

Use a new output name for each attempt. The signed `830ebd7` run passed this
candidate deployment and activation gate with all 52 on-chain verifier hashes
and retired maintenance authority. The binding stays provisional: name
issuance, recipient resolution, NIGHT withdrawal/deposit, recovery, real
passkey consent and online provider acceptance need their own gates before the
SDK or demo admits it.

### Provisional candidate named NIGHT qualification

The `midnames-night-candidate-` lane reuses the frozen candidate ACC assets and
the separately verified standalone registry tree. It deploys two fresh candidate
ACCs and a registry on a fresh isolated chain, issues a root-owned `.night` name
to the recipient, checks the complete verifier roster on both accounts, then
exercises the named NIGHT withdrawal and ACC deposit with a retained two-leg
journal. Its explicit local qualification reader does not enable provisional
bindings in the ordinary Passport demo or online profiles.

```sh
PASSPORT_MIDNAMES_CANDIDATE_ASSETS=/absolute/path/to/verified-candidate-assets \
nix develop -c env -u LD_DYLD_PATH \
  PASSPORT_MIDNAMES_NATIVE=1 PASSPORT_RC_LOCALNET=1 \
  node examples/midnames-local/qualify-deposit.mjs \
  midnames-night-candidate-fresh-run \
  /absolute/path/to/prepared-standalone-registry \
  /absolute/path/to/acc-reference/contract \
  10.254.84.0/28
```

Choose a fresh output name and an unused subnet; inspect Docker networks first.
The command refuses less than 50 GiB free disk. The signed `c211cd9` isolated
[run](evidence/candidate-acc-named-night-send-20261122.json) passed with two
candidate ACCs, one root-owned `.night` name, one finalized withdrawal and one
recipient ACC deposit. The retained intent recovered between legs, with 10/0
→ 6/0 → 6/4 balances and no replay. This establishes only the isolated local
candidate route. User-owned paid registration, browser consent, recovery and
online admission remain separate gates for that named payment run. A separate
[candidate paid-claim run](evidence/candidate-acc-page-paid-claim-retry-20261122.json)
now qualifies one local page-owned registration and failure retry.

At signed `dfae8062`, a fresh isolated
[adapter run](evidence/candidate-acc-adapter-named-night-send-20261122.json)
repeated the two-leg payment with the exported `proveUnboundNightDeposit` path
for the recipient. The wallet balanced its proof against the exact finalized
bridge output. One withdrawal and one deposit finalized, the journal replayed
neither, and the source/target balances again moved 10/0 → 6/0 → 6/4. The
first attempt at `32978e76` failed at fixture pre-proof decoding after the
withdrawal; its original and failed receipt remain retained. The passing run
used a fresh chain and closed its exact owned resources. This does not yet
qualify `createConnectedNightSend`, browser passkey consent, IndexedDB payment
recovery or online name ownership.

### Provisional candidate paid name claim and retry

The `midnames-claim-candidate-` lane uses the same complete candidate ACC
assets and prepared standalone registry on a fresh isolated chain. It deploys
and activates a candidate ACC, verifies its full on-chain verifier roster and
retired maintenance authority, then runs two page-owned paid claim originals
in one headless Passport browser profile. The first is forced to fail after
admission by a registry policy change. The lane checks its exact indexed
failure, archives that sponsor journal, releases the browser original, and
reviews and sends a fresh claim after restoring the policy. It verifies the
final binding at one canonical block. This qualification reader explicitly
admits the candidate only for this run. The native page harness substitutes
the login connector, while the page's naming reader now uses the explicit
local candidate route. Combined ACC creation still needs separate evidence.

```sh
PASSPORT_MIDNAMES_CANDIDATE_ASSETS=/absolute/path/to/verified-candidate-assets \
nix develop -c env -u LD_DYLD_PATH \
  PASSPORT_MIDNAMES_NATIVE=1 PASSPORT_RC_LOCALNET=1 \
  node examples/midnames-local/qualify-deposit.mjs \
  midnames-claim-candidate-fresh-run \
  /absolute/path/to/prepared-standalone-registry \
  /absolute/path/to/acc-reference/contract \
  10.254.85.0/28
```

Choose a new output name and unused subnet after inspecting Docker networks.
The lane requires at least 50 GiB free disk and 24 GiB Docker memory, preserves
all originals and failed receipts, and stops only its recorded containers.
The signed `f1309da` [native run](evidence/candidate-acc-page-paid-claim-retry-20261122.json)
passed with two page-prepared paid originals in one persistent browser profile.
The first had an indexed claim failure, an exact sponsor archive and browser
release after reload. The fresh retry dispatched once, then recovered its
indexed success and same-ACC binding after a lost sponsor response. The runner
deployed the candidate ACC before opening the page; its login connector was a
fixture and its naming credential was virtual. Combined ACC creation and
claim, real passkey-provider consent, and online service admission need
separate evidence.

The signed `a20a9b9` negative run `midnames-night-browser-decline-20261116a`
passed on isolated `undeployed`. Chromium displayed the same exact review and
clicked **Decline**. The source/target balances stayed 10/0 with zero owner
signatures, zero withdrawal/deposit dispatches and no admitted payment intent
or leg. The parent verified unchanged inputs, stopped its three owned
containers, retained volumes, controlled no unrelated resources and released
the native lease. This is automated local refusal evidence, not human consent.

The signed `e8fd610` run `midnames-night-browser-repoint-20261116b` passed on
isolated `undeployed`. After an automated browser approval, an on-chain
`update_target` changed `alice.night` to a third activated ACC. Fresh resolution
observed the new target, while the original journal retained the reviewed
target. The payment then refused with zero owner signatures, zero withdrawal
and deposit dispatches, and 10/0/0 ACC balances. The parent verified unchanged
inputs, stopped its three owned containers, retained volumes, controlled no
unrelated resources and released the lease. This tests one local registry
repoint before payment; it is not human consent or online provider assurance.

### Run either value fixture with terminal review

Set `PASSPORT_MIDNAMES_INTERACTIVE=1` for an operator-run demonstration. Use a
fresh output name beginning with `midnames-deposit-` or
`midnames-night-send-`, and keep the same prepared registry, reference ACC,
and optional unused subnet arguments as above:

```sh
PASSPORT_MIDNAMES_INTERACTIVE=1 nix develop -c env -u LD_DYLD_PATH \
  PASSPORT_MIDNAMES_NATIVE=1 PASSPORT_RC_LOCALNET=1 \
  node examples/midnames-local/qualify-deposit.mjs \
  midnames-deposit-my-review /absolute/path/to/prepared-registry \
  /absolute/path/to/acc-reference/contract 10.250.124.0/29
```

The runner refuses this mode without an attached terminal before creating a
stack. After resolving a supported contract target, the separate sender or
synthetic ACC owner displays the exact name, network, registry, full ACC
address, asset, and amount. The NIGHT review also lists its two operations. Type the displayed
`SEND <full ACC address> <amount>` phrase to authorize that one local intent.
The registry appears in the review as `providerId: midnames:<registry address>`.
Any other answer refuses the named deposit or withdrawal before that payment is
dispatched; Ctrl+C at the prompt is also a decline. The shielded sender receipt
records the review decision and zero named-payment dispatches on refusal. The
NIGHT fixture checks zero owner signatures and payment dispatches on refusal.
It retains those counters in `night-send/decline.json` for that failed run.
Local setup transactions, including test funding or token minting,
may already have completed before the prompt. A refused run retains its failed
receipt; use a new output name for a new run. The fixture still uses
synthetic local funds and the pinned standalone registry. Its terminal review
is an operator demonstration, not a production passkey consent or online
Midnames profile.

## Prepare an owner-proved claim for the sponsor

Separate-process preparation passed on isolated Ledger 9 at local commit
`72c9fbb`. The run used one DUST input and made zero claim broadcasts.

Use the same isolated runner with a fresh output name starting with
`midnames-claim-handoff-`. The setup activates a test ACC and deploys the pinned
registry. The fixture creates a distinct synthetic claimant for
`charlie.night` and reads the NIGHT price and payee from the registry root.
A separate owner process builds the claim and uses the isolated local prover.
The sponsor wallet adapter receives the public owner commitment and proved
bytes, then supplies the wallet inputs and fees.

The fixture checks that the proved call and registry charge survive balancing
and writes the prepared public receipt to `review/<output-name>/claim-handoff.json`.
The matching bytes and receipt are retained together in a private journal.
The journal supports one dispatch after exact receipt acknowledgement and a
live sponsor policy check. This runner stops after preparation. The setup transactions run on
the isolated chain. Keep the binary transaction and wallet material local.
Browser initiation, sponsor dispatch, two-DUST admission and lost-response
qualification are separate steps.

### Send an acknowledged receipt from the browser

The local host can mount `createClaimSponsorHandler` on the demo's HTTP origin
at `/v1/midnames/claim/dispatch`. It binds one private prepared journal and the
host's live sponsor policy to that origin. Set `VITE_MIDNAMES_CLAIM_SPONSOR=1`
with the standalone registry configuration and open the demo on `127.0.0.1`.

Browser dispatch requires the handler's preparation ports and a receipt bound
to its retained quote. Start
the owner-side server with the prepared registry and the Compact reference ACC
contract directory used by the isolated qualification command:

```sh
nix develop -c node --experimental-import-meta-resolve \
  examples/midnames-local/claim-owner-demo-local.mjs \
  /absolute/path/to/prepared-registry /absolute/path/to/acc-reference/contract \
  /absolute/path/to/public-context.json
```

The JSON contains `networkId` (`undeployed`), `registryAddress`,
`sponsorAddress` (the domain's future subdomain payment address),
`indexerUrl` (`http://127.0.0.1:18108/api/v4/graphql`),
`indexerWsUrl` (`ws://127.0.0.1:18108/api/v4/graphql/ws`), and
`walletKeys` with `coin` and `encryption` public keys. Use lowercase
32-byte hex for the two addresses and two public keys. Bind the registry and
future payment address to the issued quote; `walletKeys` are the owner wallet's
public keys.
Keep the owner relay and its proof server at `127.0.0.1:16320` under the account
owner's control. The command checks the prepared hashes before serving.

Copy the printed `PASSPORT_MIDNAMES_OWNER_PORT` to the demo environment and
set `PASSPORT_MIDNAMES_SPONSOR_PORT` to the separate sponsor server's port.
Set `VITE_MIDNAMES_CLAIM_SPONSOR=1` and `VITE_MIDNAMES_CLAIM_PREPARATION=1`
alongside the [standalone name service settings](../../docs/site/names.md#standalone-registry-profile).
Start the demo on `http://localhost:5173`. For a different localhost port,
pass the exact demo origin as the last argument to the owner command.
The quote also pins `sponsorPaymentAddress`, the NIGHT input and change wallet.
The browser transport accepts the literal loopback origins `localhost` and
`127.0.0.1`. Keep the handler and browser on the same origin. The sponsor
retains the exact quote, checks its live terms before balancing, and records
a durable intent before invoking the wallet. **Check saved claim**
reads that original journal after a lost response. An expired intent with no
prepared receipt or dispatch fence can be archived after the local sponsor
confirms the name remains free; active sponsor work excludes that retirement.
If the prepare request never reached the sponsor, the same exclusive check
records a durable refusal for the exact expired quote without moving the journal.
If an indexed original is definitively `FAILURE`, or the sole claim segment
failed while the sponsor fee succeeded, **Release failed original for a new
attempt** first asks this sponsor to verify the exact prepared bytes and
dispatch fence. It checks the transaction's identifiers, hash, raw bytes,
canonical finalized block, free name and activated ACC twice before archiving
the whole journal. The archive retains the exact receipt and fee outcome. Only
then does the browser archive its own record and offer a fresh quote. Provider
outage, changed binding, another partial result and uncertain finality keep the
original fenced. Other quotes that moved with an archived journal remain
recoverable by exact bounded lookup; a quote without a balance intent receives
only its own durable refusal, never the occupying original's receipt.
The dispatch handler rechecks
the approved quote and original transaction before opening the dispatch fence.
If live terms change before any intent is recorded, the sponsor durably refuses
that quote and the browser asks for fresh review. An uncertain response keeps
the original quote. The browser requires a matching saved quote and a second
send click after displaying the payment terms; quote-less imports are only
reconciled.

To exercise the actual loopback route on an isolated chain, run the same
`qualify-deposit.mjs` command with a fresh name starting with
`midnames-claim-browser-`. The browser driver uses port 15189 and a fresh
Chromium profile. The fixture delegates two synthetic NIGHT outputs to the
sponsor's DUST address. A separate owner process launches a browser page on
`localhost`. Chromium uses a virtual WebAuthn credential to derive the naming
witness, constructs the call, and sends proving requests through the owner
process to the fixed loopback prover. The browser checks the compiled
`create_domain` artifact hashes. Both HTTP hops refuse redirects.
The private `worker.json` records the original NIGHT split and DUST registration
transaction identifiers as `dustSetup`. If the sponsor's DUST inputs do not
appear within three minutes, the failure reports its last sync state and input
count. Preserve that run and reconcile its original registration before any
retry; a fresh isolated run has a different chain and transaction history.
The relay and loopback prover receive sensitive proof payloads and run within
the owner trust boundary. Use a prover the owner controls.
The owner process returns the proved transaction and public commitment to
the sponsor after checking that the same credential yields the same commitment
after a reload. The sponsor rechecks the registry price, payee, name
availability and target ACC. It accepts only the original Ledger IDs and an
unexpired claim with exactly two DUST spends under its configured fixture
ceiling. The native fixture injects a quote and matching journal row after
proving to exercise quote-bound dispatch and recovery. It does not establish
human quote review before proof; the opt-in browser preparation flow exercises
that order separately. The browser driver drops the HTTP response after the
sponsor accepts the acknowledgement, restarts Chromium, and checks the original
on the isolated indexer. Inspect `native-claim-dispatch.json` and
`browser-claim-recovery.json` under the run's private evidence directory.
This test uses a virtual owner credential. Production credential enrollment
and recovery after loss of that credential need separate qualification.

Use a fresh output name starting with `midnames-claim-preproof-` for the
bounded quote-before-naming-proof lane. After the ACC and registry exist, the
fixture creates a quote with a distinct ID and displays its exact fields in
the isolated owner Chromium page. The page checks that no naming proof request
has occurred, then an automated approve click invokes `proveReviewedClaim`.
That call rechecks the live parent terms before using the virtual credential's
PRF and proving. The same quote digest is bound to the sponsor-prepared receipt;
the existing browser recovery driver then checks one dispatch and restart
recovery. This lane uses a fixture-issued quote and enrolls its virtual
credential before displaying it. It does not exercise the sponsor HTTP quote
endpoint, a human approval, or the full demo's ACC create/open page.

Use an output name starting with `midnames-claim-owner-browser-` to prepare
and retain the browser-proved claim without dispatch. This mode exercises
the proof, credential continuity and sponsor balancing independently of
the fixture's two-DUST admission test.

Save the prepared public receipt while the matching ACC is open, then select
**Review terms before send**, review the saved terms, and confirm. **Check original claim** reads the original receipt
after a reload or lost response. This route is a local fixture. The live browser run used a fixture login for
an already activated ACC and a Chromium virtual passkey to prove the fixed
claim. It observed one assertion, one proof, one wallet balance, one dispatch
and original confirmation after restart.

The Chromium test runs the actual form, IndexedDB, and HTTP sponsor fence with a
simulated node and indexer:

```sh
nix develop -c pnpm --filter passport-dapp exec node --import tsx e2e/midnames-dispatch.e2e.ts
```
