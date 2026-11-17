# Prepare a standalone Midnames registry

This fixture uses the Midnames 2.1.0 registry source on the Passport standalone
Ledger 9 stack. Prepare artifacts with the Passport SDK's pinned Nix toolchain.
Supply a local copy of [`ns.compact` at the pinned upstream revision](https://github.com/midnames/ns-sdk/blob/f8f2edd425221b95c9158d74e7318d2fbb4f61b2/ns.compact)
recorded in [the manifest](registry-manifest.json). The command verifies those bytes,
updates the language pragma for Compact 0.35.0, and verifies each generated
module, circuit, prover and verifier against the reviewed hashes.

```sh
nix develop -c node examples/midnames-local/prepare.mjs \
  /absolute/path/to/ns.compact /absolute/path/to/fresh-output
```

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
passes the same replay. The standalone owner fixtures now rebuild their one
`create_domain` call before proving with zero deletion credit, retaining its
program, effects and value transfers. This avoids claiming a storage refund;
native issuance with the adjusted transaction still needs qualification.

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

Only a fixture with a final **PASS** establishes its scoped local name and ACC
binding. Neither shared-chain attempt above did. These fixtures do not exercise the full browser
onboarding ceremony, passkey-based naming recovery, public `passport.night`
issuance, or online sponsor funding. Keep #316's P2/P5/P8 conformance gates open
until those paths are qualified.

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
indexed failure, a fresh persistent Chromium profile opens the reference app,
retains the original receipt, checks the live indexed segment result and registry,
and explicitly releases it. After a browser restart, the fixture checks that the
same original is archived with `CLAIM_SEGMENT_FAILURE` and no active claim remains.
Only then does the host restore the root's registration policy, prepare a new
owner-proved claim and sponsor quote for the same ACC and name, submit that new
original once, and check indexed success and the live binding. Its private
`indexed-claim-retry.json` retains both public receipts, the browser release
receipt and dispatch counts. The new quote and retry dispatch still run in the
host fixture; this lane does not qualify pre-proof browser quote review or a
real provider.

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

## Run the named ACC-to-ACC NIGHT payment

Use the same command with a fresh output name beginning with
`midnames-night-send-`. This mode deploys a second ACC. The `alice.night`
record has a different profile default so the run can verify operation-specific
contract routing. The fixture starts the source ACC with 10 smallest NIGHT
units and requests a payment of 4 to the named account.

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
a durable intent before invoking the wallet. **Recover prepared receipt**
reads that original journal after a lost response. An intent with no
prepared receipt stays pending after restart. The dispatch handler rechecks
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
**Send prepared claim**, review the saved terms, and confirm. **Check original claim** reads the original receipt
after a reload or lost response. This route is a local fixture. The live browser run used a fixture login for
an already activated ACC and a Chromium virtual passkey to prove the fixed
claim. It observed one assertion, one proof, one wallet balance, one dispatch
and original confirmation after restart.

The Chromium test runs the actual form, IndexedDB, and HTTP sponsor fence with a
simulated node and indexer:

```sh
nix develop -c pnpm --filter passport-dapp exec node --import tsx e2e/midnames-dispatch.e2e.ts
```
