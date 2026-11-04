# Application contract → Passport ACC

Local candidate for [#275](https://github.com/input-output-hk/midnight-passport-sdk/issues/275).
The new compiler export command is **not published in RC6**. This example consumes
four installed packages: `protocol`, `account`, `keys` and `contract`. It imports
no private Lace implementation or SDK workspace source.

## What it demonstrates

`contracts/merchant.compact` is a fixed-price merchant terminal configured for one
verified deployed ACC. Its constructor fixes the payer ACC, asset, merchant
`UserAddress`, price and capacity. An owner-issued caller-bound JubJub grant lets
a holder pay through that terminal. `pay(approval)` invokes the ACC withdrawal and
increments the terminal's count. A post-call capacity guard supplies an application
failure case. The ACC remains the user's separate custody/authorization contract.

This deliberately avoids accepting arbitrary contracts that merely expose an ACC
interface. The deployer must verify the configured ACC's operation/module keys and
maintenance policy; constructor configuration is a trust decision. A multi-user
application needs its own reviewed registration/payment design, not removal of
this restriction. A payment count is not a general order-ownership, fulfillment or
authentication protocol.

`prepare-payment.mjs` uses public account checks and an injected authoriser. It
checks the merchant policy, live scope and caller commitment, requests review,
rereads for changes and prepares the ACC signature. It never submits a transaction.
The returned `account` is metadata; the generated merchant call takes only
`prepared.approval` because its payer is fixed in state.

## Prepare an independent consumer

Use the repository's pinned Nix shell for Node, pnpm and Compact. In the SDK source,
build and pack the candidate into a **new** output directory:

```sh
pnpm run build
RELEASE_VERSION=0.1.0-dev.20261103 DIST_TAG=dev \
  RELEASE_TARBALL_DIR=/absolute/new-candidate-bundle \
  node scripts/release-packages.mjs pack
```

Packing writes no registry. The packer temporarily updates package manifests and
restores them; do not edit manifests concurrently. The version above identifies the
local evaluation only. Compare every archive with the bundle's manifest before
installing; this relationship does not authenticate a publisher.

Create a new private consumer outside the SDK checkout. Copy these public example
files into it: `prepare-payment.mjs`, `qualify-offline.mjs` and
`contracts/merchant.compact` (as `merchant.compact`). Install the four matching
tarballs plus Compact runtime 0.20.0. Give pnpm overrides the same file references so
their inter-package dependencies resolve to those archives rather than the registry:

```json
{
  "name": "passport-merchant-consumer",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.34.5",
  "dependencies": {
    "@input-output-hk/mn-passport-protocol": "file:bundle/input-output-hk-mn-passport-protocol-0.1.0-dev.20261103.tgz",
    "@input-output-hk/mn-passport-account": "file:bundle/input-output-hk-mn-passport-account-0.1.0-dev.20261103.tgz",
    "@input-output-hk/mn-passport-keys": "file:bundle/input-output-hk-mn-passport-keys-0.1.0-dev.20261103.tgz",
    "@input-output-hk/mn-passport-contract": "file:bundle/input-output-hk-mn-passport-contract-0.1.0-dev.20261103.tgz",
    "@midnight-ntwrk/compact-runtime": "0.20.0"
  },
  "pnpm": {
    "overrides": {
      "@input-output-hk/mn-passport-protocol": "file:bundle/input-output-hk-mn-passport-protocol-0.1.0-dev.20261103.tgz",
      "@input-output-hk/mn-passport-account": "file:bundle/input-output-hk-mn-passport-account-0.1.0-dev.20261103.tgz",
      "@input-output-hk/mn-passport-keys": "file:bundle/input-output-hk-mn-passport-keys-0.1.0-dev.20261103.tgz",
      "@input-output-hk/mn-passport-contract": "file:bundle/input-output-hk-mn-passport-contract-0.1.0-dev.20261103.tgz"
    }
  }
}
```

Copy the verified archives to `bundle/`, then:

```sh
pnpm install --ignore-scripts --ignore-pnpmfile --no-frozen-lockfile
pnpm exec mn-passport-export-compact \
  --manifest-sha256 77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f \
  --output "$PWD/dependencies"
compact compile --skip-zk --compact-path "$PWD/dependencies" \
  merchant.compact "$PWD/merchant"
node qualify-offline.mjs dependencies merchant receipt.json
```

Retain the lock and its hash. A second fresh consumer can replay that lock with
`--offline --frozen-lockfile`. Do not overwrite failed roots or receipt files.
Type-check `prepare-payment.mjs` with TypeScript 6.0.3, Node types 22.20.1 and
`--noEmit --allowJs --checkJs --strict --skipLibCheck --module NodeNext --moduleResolution NodeNext --target ES2022`.
The example's files resolve their dependencies from the consumer, not this checkout.

## What the offline check establishes

The executable verifies exported dependency bytes against the independently pinned
compiler manifest, then executes the actual generated merchant and installed ACC
modules. Software keys create and authorize a synthetic account/grant; a local state
provider supplies the real pinned verifier keys. The accepted call must emit the
ACC sub-call followed by the application root, with communication commitment data.
It checks wrong caller, invalid signature, expired/revoked grants, module
substitution, replay and a post-call capacity failure. Failure does not commit either
original state in the fixture.

**No proof, node transaction, merchant wallet credit or real passkey is established.**
Native admission and rollback still require separate proof-backed qualification.
The synthetic funding operation tests the circuit's balance mirror only. The
receipt deliberately records zero proofs, node transactions and provider ceremonies.
Inspect chain transaction effects and both contract states before reporting a real
payment as settled. An uncertain submitted transaction must not be replayed under a
new request ID.

## Native and privacy boundaries

The caller compiles with default v2 encoding because Compact 0.35.0's v3 backend
cannot forward curve-point arguments. The ACC stays on its immutable v3 build;
both use runtime 0.20.0. `--skip-zk` creates no usable new caller proving keys.
Native work must use a fresh owned environment, verified existing ACC key cache,
caller keys, sufficient disk/memory and the documented value-capable transaction
pipeline. The fee-only Passport sponsor is not a general transfer wallet.

The forwarded grant/signature fields are disclosed by the reference. Do not infer
shielded callee-witness support or production privacy. A caller pin authenticates
the immediate claiming contract, not the browser, fee payer, root or a particular
circuit. The signature covers the ACC withdrawal, not unrelated application data.
No total-loss recovery, full Lace compatibility, account upgrade, external-chain
asset or partial shielded-spend capability is added.

### Opt-in native worker

`qualify-native.mjs` is the local qualification worker, not a browser helper or
published package entry point. Its operator must first prepare a fresh external
consumer with the four candidate archives, matched Midnight.js/wallet dependencies,
the generated merchant artifacts and verified existing ACC prover keys. It also
requires separately pinned public reference `wallet.ts` and `wave-deploy.ts`
helpers. The wallet helper must use the consumer's artifact registry; the wave
helper must retain maintenance material before submission and perform no automatic
submission retry. These reference helpers are infrastructure, not portable APIs.

The parent must hold the stable native qualification lease, verify clean signed
source and installed/runtime bytes, inspect the retained dedicated container IDs,
check capacity and `dedicatedIndexerReadiness()` before starting the worker, then
verify canonical node finality for every submitted contract action. The worker
requires an independently supplied SHA-256 for `native-config.private.json`; its
`files` map pins worker/helper/installed/artifact inputs and `output` selects a new
`native-run-*` directory. Existing outputs are refused. Source and inputs remain
frozen until the parent finishes its end audit and owned-resource cleanup.

The worker uses the dedicated chain's public genesis funding wallet and a separate
fresh recipient wallet. It retains finalized bytes before sends, splits an exact
12-unit NIGHT input, deposits it, and attempts a 4-unit merchant payment. It checks
the ACC debit, application count and recipient wallet credit separately. Wrong
caller/signature, replay, revocation and the post-call business guard record the
actual failure stage. An unreturned submission remains unknown; rerunning under a
new output is not reconciliation. Private credentials, LevelDB, exact transactions
and failed roots must stay outside Git/Obsidian. Export only reviewed public
addresses, hashes, counts and bounded outcomes.

Until a source-bound native receipt is recorded, this worker adds no proof-backed
acceptance claim. Expiry and tamper controls remain explicit separate cases; a
business guard rejected during construction is not a malicious proof admitted or
rejected by the node. Stop only owned workers/container IDs and retain all volumes.
