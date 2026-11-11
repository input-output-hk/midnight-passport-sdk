---
layout: default
title: Naming service adapters
permalink: /names/
---

# Naming service adapters

**Available in RC8; absent from RC7.**
This is a read-only seam, not a deployed Passport naming protocol. Registration,
reservation, payment, reverse lookup and ownership proof are outside this API.
Name creation remains outside onboarding. No additional npm package is introduced.

## SDK interface and host adapter

`mn-passport-account/ports` exports `PassportNameService`, `PassportNameQuery`,
`PassportNameRecord` and `PassportNameProvider`. Implement the port in your host
or provider adapter. `mn-passport-account/names` exports the same types plus
`resolvePassportName` and `PassportNameError`, without browser, Node or React
dependencies. The demo supplies its own in-memory implementation.

```ts
import {
  resolvePassportName,
  type PassportNameService,
} from '@input-output-hk/mn-passport-account/names';

// Supply an adapter from your trusted host composition root.
export async function inspectName(names: PassportNameService) {
  return resolvePassportName(names, {
    name: 'alice.passport.test',
    networkId: 'undeployed',
  });
}
```

The adapter declares `provider: { id, namespace, mode }`. Mode is `mock` or
`external`, metadata from host configuration rather than an authenticity proof.
`resolve(query)` returns the exact name, namespace, network and lowercase
64-character ACC address, or `undefined` for absence. Optional `expiresAt` is
Unix epoch milliseconds; omission is not a permanence guarantee. Throw on failure.

The helper captures scope before awaiting the adapter, rejects mismatches and
malformed addresses, checks expiry after lookup, and copies only public fields
into an immutable result with `providerId` and `mode`. Provider extensions and
exception text are not forwarded. No automatic cache/retry or chain access.
Inject `{ now: () => milliseconds }` for deterministic tests.

Names are exact strings of up to256 UTF-16 code units without whitespace or
Unicode control/format characters. No implicit trim, case folding, Unicode
normalisation or DNS/upstream-name validation occurs. Providers define their own
canonical naming policy; hosts apply it explicitly. Provider IDs/namespaces are
bounded alphanumeric/dot/underscore/colon/hyphen identifiers (128 characters);
networks use the same form with a64-character bound. These are seam bounds, not
a universal naming standard.

| Error code | Meaning |
| --- | --- |
| `InvalidQuery` | Invalid query/provider configuration or clock value. Malformed input refuses before lookup. |
| `InvalidRecord` | Malformed result or a name, network or namespace mismatch. |
| `Expired` | Record already expired when received. |
| `Unavailable` | Lookup failed; distinct from an absent name. |

## Demo composition

**Name service · mock adapter** composes the helper with
`apps/passport-dapp/src/mock-name-service.ts`. Its fixed synthetic records are
`alice.passport.test` → repeated`11` hex and `bob.passport.test` → repeated`22` hex.
Provider `demo-memory`, namespace `passport-demo`, is scoped to the configured
demo network. These are **not deployed accounts** or names assigned to the user.
The adapter keeps no persisted state; reload recreates its fixtures.

Lookup needs no open account or passkey and never changes a transfer recipient.
Missing names clear the previous result; invalid queries/failures have distinct
status. Replace the injected adapter in the composition root to attach a real
service. Its authentication, timeout/cancellation, canonicalisation and evidence
policy belong there. Never embed privileged registry credentials in a browser.

## Authority and limits

A checked address is only a provider-supplied hint. It does not establish account
deployment, name ownership, current control or permission to view/spend assets.
There is no registry proof, automatic device enrollment or grant. Future payment
flows must independently validate account/network/circuit support and freshness,
then review the final resolved address and amount before authorization. An ACC
address is not an HD wallet's unshielded receiving address; do not substitute it
into that withdrawal field.

This interface works independently of the demo UI. It adds no `lace-sdk`
integration or qualified React Native support. Tests cover custom providers,
invalid/mismatched/expired responses, delayed expiry, absence versus failure,
scope mutation and redaction. Chromium exercises mock lookup/missing/invalid
names without credential calls or recipient changes, not real-provider acceptance.

## Source preview: Midnames 2.1.0

The reference demo can opt into a read-only Midnames registry while keeping the
published account package interface. The adapter is in
`apps/passport-dapp/src/midnames/`. It loads the Midnames reader only when a
configured lookup runs. The default demo still uses the synthetic provider.

Set these public build inputs together. Use a registry and indexer for the same
network as the Passport demo.

| Input | Value |
| --- | --- |
| `VITE_MIDNAMES_NETWORK_ID` | Exact Passport demo network, such as `undeployed` |
| `VITE_MIDNAMES_NAMESPACE` | `night` or an explicitly configured canonical namespace |
| `VITE_MIDNAMES_REGISTRY_ADDRESS` | 64 lowercase hex characters for the pinned registry |
| `VITE_MIDNAMES_INDEXER_URL` | Public HTTPS GraphQL endpoint, or HTTP on loopback |
| `VITE_MIDNAMES_INDEXER_WS_URL` | Public WSS endpoint, or WS on loopback |

The panel rejects partial configuration. It accepts exact canonical lowercase
names within the chosen namespace. Each lookup checks the registry verifier
roster and resolves the name from that observed state using the Midnames
`/core` subpath. Only its contract target proceeds. The adapter then checks
that the address is an activated ACC with the complete verifier roster for the
pinned binding. Missing names, wrong target types and unavailable reads have
separate outcomes. An indexer is a trusted read input, and a lookup reflects
its observed state. The demo presents the result for inspection.

Midnames 2.1.0 uses a Ledger 9 reader built with runtime 0.21.0 and Midnight JS
5.0.0. The ACC still uses runtime 0.20.0. The indexer hands out tagged bytes,
so each decoder uses its own runtime. The exact dependency exceptions in
`pnpm-workspace.yaml` apply to this demo qualification. Registry integrity,
lifecycle-script blocking and the cooldown for other versions still apply.

The generated registry and the Ledger 9 HTTP read format have a local test.
A read-only check against the existing demo indexer also returned the expected
missing-contract response for an absent address. An online profile requires
evidence for its deployed registry, a known name, and the corresponding chain
before it is enabled.

The 2.1.0 tarball includes a read generation and an older managed write
generation. Its root export can fail at load because the managed module expects
runtime 0.15.0, and its write wrapper reports writes paused. The demo uses only
the read subpaths. A claim flow requires compatible registry write artifacts
and separate proof and submission checks. A local `.night` profile does not
establish public `passport.night` issuance or name-control recovery.

### Standalone registry profile

For a disposable `undeployed` network, set
`VITE_MIDNAMES_REGISTRY_PROFILE=standalone-0.35` alongside the five settings
above. This selects the independently pinned standalone verifier roster.
The default profile remains `midnames-2.1.0`. A registry with a different
roster is refused. See the [standalone preparation recipe](../../examples/midnames-local/README.md).

The standalone qualification activated the pinned ACC and deployed the registry
in two verifier waves. In two isolated runs the node explicitly rejected the
positive-price claim with `OutsideTimeToDismiss`. Both transactions used one DUST spend. This matches the
[Ledger 9 single-DUST admission issue](https://docs.midnight.network/relnotes/ledger-9#a-fee-paid-with-a-single-dust-spend-can-be-rejected).
A shorter transaction TTL reproduced the rejection.

A separate live fixture used the registry root owner to create a name. The
Midnames 2.1.0 reader returned the expected owner commitment and the exact
activated ACC address. The reference provider read the same registry through
the same isolated indexer. This qualifies local lookup with the standalone
profile.

A separate positive-price fixture delegated DUST from a fresh synthetic funding
wallet to the sponsor. The claim finalized with exactly two DUST spends. The
registry reader returned the expected distinct claimant commitment and the
activated ACC. After restarting the isolated node and indexer, a fresh process
confirmed the original transaction identifiers and read the target again with
zero submissions. This is standalone fixture evidence. Browser claim preparation,
name-owner custody and online profile qualification remain open.

The host registry reader can inspect the stored owner commitment and target
from the same verifier-checked snapshot. Generated-state tests check the
commitment of a claimant distinct from the root owner. Confirmation of a
future claim requires both fields to match the original intent and evidence
that the original transaction finalized successfully.

### Recover the sponsor's original claim in the demo

For `standalone-0.35` with namespace `night`, open the target Passport ACC
with its passkey and go to **Settings → Developer tools → Name service**.
Enter the name and paste the sponsor's original public receipt. Save it, then
use **Check original claim**. After a reload, open the same account with the
same credential, enter the name again, and check the saved receipt.

The sponsor prepares this receipt before dispatch. Its fields are
`networkId` (`undeployed`), `registryAddress`, `accountAddress`, `name`,
`ownerCommitment`, and `transaction` with the original finalized
`identifiers` and byte `sha256`. Keep the original receipt available when a
response is lost. IndexedDB retains public fields scoped to the original
credential and protects the record from replacement by another tab. The
checker reads the original identifiers, verifies the exact transaction bytes
and the registry inserts linking the name to its domain ID, owner commitment
and contract target. It then checks the current owner and activated ACC target. An absent, partial, aggregated or changed transaction stays pending.
A mismatched owner or target is reported as a conflict.

This recovery surface reads the isolated indexer. Claim preparation and
submission run in a separate sponsor environment. Never paste passkey
material, keys, raw transaction bytes or witnesses into the form. Recovering
the receipt does not recover ownership after loss of the name-owner secret.

### Deposit a shielded asset by name

The standalone Node example sends a shielded test token to `alice.night` using
the configured Midnames 2.1.0 registry. The sender reviews the exact name,
network, registry identifier, full ACC address, asset color and amount. The
resolver requires the operation-specific contract target and checks the
activated ACC against the 52-verifier binding. After building, proving and
balancing the `deposit_shielded` call, the sender reads the current encryption
key and resolves the name again. A changed destination or key, unavailable
provider or incompatible account stops the send. This check uses the last
observed registry and ACC state before broadcast. Registry updates and deposits
are separate on-chain operations.

The sender uses its own wallet and the ACC's public encryption key. The
recipient retains its viewing secret and independently verifies that the
decrypted inbox entry matches the output in the successful original transaction
and is still held by the account. An uncertain send keeps its original
identifiers for reconciliation.

On the isolated Ledger 9 chain, the sender submitted once and the deposit of
10 smallest units of a synthetic token finalized at block 73. The owner
verified the original output and the held amount. Separate live reads covered
an unknown name, a different network, and an incompatible contract.

Run the [standalone fixture](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/examples/midnames-local)
from a source checkout containing #317. The fixture uses local `.night` on
`undeployed` and a self-hosted indexer and proof server. Public
`passport.night`, provider substitution and ACC-to-ACC sends require separate
qualification.

### Send NIGHT from one ACC to another by name

The standalone Node fixture implements the named **NIGHT** route for
`acc-s3r1.1` on `undeployed`. It requires an activated contract target and
shows the source, network, registry, recipient, bridge wallet, amount and both
operations before owner approval. The owner signs
`withdraw_unshielded_with_jubjub` to the controlled wallet. Once that leg is
final, the wallet uses its exact output to call `deposit_unshielded` on the
reviewed recipient ACC and update its balance. The ACC signature binds the
withdrawal, bridge, asset and amount. The host journal binds the name and
recipient contract to the deposit, which is permissionless.

The two transactions settle independently. If the deposit has yet to dispatch,
the original intent can continue once its withdrawal is confirmed. Once a leg
has dispatched, the host checks its original transaction identifiers.
Re-resolution can detect a repoint before either leg, based on the most recent
observed registry state. After withdrawal, a repoint leaves the value in the
controlled wallet pending reconciliation. Shielded ACC-to-ACC sends, browser
passkey consent for this route and online profiles remain unqualified.

See the [standalone recipe](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/examples/midnames-local).
