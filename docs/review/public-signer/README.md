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

Native acceptance is pending until an exact-source receipt is recorded below.
