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
missing-contract response for an absent address. A deployed registry with a
known name, an independent chain read, and a known online profile each require
their own acceptance evidence. Configure such a profile only after recording
those pins and checking it against the corresponding chain.

The 2.1.0 tarball includes a read generation and an older managed write
generation. Its root export can fail at load because the managed module expects
runtime 0.15.0, and its write wrapper reports writes paused. The demo uses only
the read subpaths. A claim flow requires compatible registry write artifacts
and separate proof and submission checks. A local `.night` profile does not
establish public `passport.night` issuance or name-control recovery.
