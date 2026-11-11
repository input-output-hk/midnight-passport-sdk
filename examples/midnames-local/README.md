# Prepare a standalone Midnames registry

This fixture uses the Midnames 2.1.0 registry source on the Passport standalone
Ledger 9 stack. Prepare artifacts with the Passport SDK's pinned Nix toolchain.
Supply a local copy of `ns.compact` from the source revision recorded in
[the manifest](registry-manifest.json). The command verifies those bytes,
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

The standalone fixture has the upstream transitional registry administration
semantics. A name claim needs an owner-controlled proof witness. Use synthetic
wallets for this qualification and preserve all original transaction references
when a submission has an uncertain result.

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
