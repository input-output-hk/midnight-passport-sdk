# Public signer interoperability slice

Local work for #81/#231. Released RC6 and the historical native receipts are unchanged.

## Review map

- `scripts/consumer/public-signer-source.mjs`: separately pinned public source, Git blob closure,
  actual upstream build alias, supplemental locked dependencies, emitted dependency ranges,
  complete bundle/tree hashes and pre/post execution verification.
- `scripts/qualification/signer-windows.mjs`: explicitly simulated window routing, native ports.
- `tests/fixtures/public-signer-harness.js`: real installed client/seams and real source server/
  handlers; approved origin, synthetic credentials, private sealed storage history, hashes only
  for request/result bodies, explicit session and listener cleanup.
- `tests/fixtures/public-signer-protocol.js`: real crypto and SDK operation with an independently
  checked Schnorr equation, **fake chain**. Denial, origin, scope, expiry, cancellation, busy and
  callback-error checks. Never equate this with native proof or browser/provider acceptance.
- `tests/fixtures/public-signer-native.ts`: optional extension of the existing native baseline.
  Its creation/grants use the local host signer; only the SDK add-device call uses remote handlers.
- `scripts/qualify-published-native-host.mjs`: strict separate result profiles, same retained
  stack/lease/capacity/finality controls, source/consumer/bundle audit and owned cleanup.

## Inputs and scope

Installed SDK `0.1.0-rc6`, public host `@laceio/sdk@0.1.2-canary.2`. Actual handler/server
source: public `input-output-hk/lace-sdk` commit
`ce04076bbe70d8455c924d175cfcb7ee65844ae7`. npm metadata has no `gitHead`;
source and archive are independent pinned inputs. No private implementation import, source patch,
new host package export, real provider or signer-page assertion.

The generated ACC module is byte identical to RC6 (`0ee002d3ac6eae8c048fbd9017ed2f1215e3961629f998221dd9b3e77d74bccf`).
Upstream tsdown resolves its English wordlist to root bip39 2.2.0 while the mnemonic code uses
bip39 1.6.0. The builder reproduces that explicit alias, records it and checks all **emitted**
external imports. Unused barrel dependencies do not establish a supported feature. The source
closure is bundled for this lane; the entire upstream application is not typechecked.

`addJubjubAuthorisingDevice` adds signing authority, with consent binding the exact ACC and
new commitment. It delivers **no viewing secret or reader registration**. It obtains the owner
point in approved sign-in; authorising-only add scope refuses public-key disclosure. Unsupported
rotation/withdrawal descriptors stay refused before transport. Exact-value shielded spending
rules are untouched. This lane does not qualify hosted creation, full enrollment, full Lace,
P-256/secp256k1 remote signing, actual popup/browser ownership transfer or image deployment.

## Execution

See the [engineer guide](../../site/consumer-integration.md#public-source-signer-handlers).
Every build, protocol and native root is fresh. Keep failed roots, their original IDs and private
sealed state. Run the full gate and GPG/DCO-sign source before native execution; recheck inputs
before editing afterwards. Store only redacted public receipts here and in the Vault.

## Accepted local evidence — 2026/11/02

Signed source `ba3a1765d3dfa16c180a4807734e26a9a5745728` passed the native lane in
512,236 ms: **20 cases, 20 successful canonical finalized transactions**, 17 proof responses,
19 sponsorships plus the deposit. The SDK add-device call submitted exactly once, advanced the
owner counter to 14, left the inbox unchanged and preserved the 7-unit shielded NIGHT holding.
Host sign-in discovered both authorities. Real handler decisions were approve/reject/approve;
only the approved add signed, and unsupported SDK flow kinds made no request. All source,
compiled, installed and prepared input checks matched; all three owned containers stopped.

- [Native parent/finality receipt](native-parent-receipt.json), [outer suite](native-suite-receipt.json).
- [Actual protocol cases and hashed messages](protocol-result.json), [parent](protocol-parent-receipt.json), [suite](protocol-suite-receipt.json).
- [Six integrity controls](integrity-controls.json), [source/build/dependency pins](source-inputs.json).
- [Native transport receipt](native-transport-receipt.json), [capacity samples](node-capacity.json), [summary](qualification-summary.json).
- [Failed attempts](failed-attempts.json): v1 stopped before wallet setup at an ESM import;
  v2 retained a funded account but stopped before SDK sponsorship/submission at an incomplete
  proving-provider shape. Neither failed full suite is relabelled or replayed. Original state
  and protected private fixture backups are retained outside Git/Vault.

The transaction proving bridge must supply ledger `lookupKey` with checked circuit assets and
parse circuit `check` bytes into ledger check results. A `PassportProver` alone is a circuit
port, and cannot be passed directly to `Transaction.prove`. This lane uses the pinned public
upstream resolver for that bridge, without changing released package bytes.

No reader registration or viewing secret was delivered: the entire inbox remained unchanged.
This is not a fresh reader-enrollment acceptance run. Creation/grants used the local host signer;
only the SDK enrollment used remote handlers. Actual popup/transfer ownership, real providers,
full hosted creation/rotation/withdrawals, both-arm remote signing, images and repeated full
release qualification remain open. #81/#231 stay open for their broader acceptance criteria.
