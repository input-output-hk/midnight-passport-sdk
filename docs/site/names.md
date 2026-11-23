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

For a local Ledger 9 source preview, the
[candidate demo profile](../../examples/midnames-local/README.md#provisional-acc-local-demo-profile)
can explicitly pin `acc-s3r1.1-zkir036` with independently verified assets.
Its naming reader accepts that provisional verifier roster only on the
`undeployed` chain with the standalone registry and loopback indexer. This is
not an online or published SDK binding.

Set these public build inputs together. Use a registry and indexer for the same
network as the Passport demo.

| Input | Value |
| --- | --- |
| `VITE_MIDNAMES_NETWORK_ID` | Exact Passport demo network, such as `undeployed` |
| `VITE_MIDNAMES_NAMESPACE` | `night` or an explicitly configured canonical namespace |
| `VITE_MIDNAMES_REGISTRY_ADDRESS` | 64 lowercase hex characters for the pinned registry |
| `VITE_MIDNAMES_CLAIM_PROTOCOL_VERSION` | Required for standalone claim reconciliation: exact Indexer v4 transaction `protocolVersion` observed on this chain (`2001100` for the shared stack and release-image isolated fixture); this is distinct from the `/api/v4/graphql` API version |
| `VITE_MIDNAMES_INDEXER_URL` | Public HTTPS GraphQL endpoint, or HTTP on loopback |
| `VITE_MIDNAMES_INDEXER_WS_URL` | Public WSS endpoint, or WS on loopback |
| `VITE_MIDNAMES_VERIFICATION_INDEXER_URL` | Second HTTPS GraphQL endpoint on a distinct origin; required for a non-`undeployed` network or non-loopback primary indexer |
| `VITE_MIDNAMES_VERIFICATION_INDEXER_WS_URL` | Second WSS endpoint on a distinct origin; required together with its HTTP endpoint for those profiles |
| `VITE_MIDNAMES_NODE_URL` | Separate node JSON-RPC HTTPS endpoint, or HTTP on loopback; required for online lookup and set by the local launcher |
| `VITE_MIDNAMES_CHAIN_ANCHOR_HEIGHT` | Positive decimal height of a previously confirmed block on the intended chain; required with the node URL |
| `VITE_MIDNAMES_CHAIN_ANCHOR_HASH` | That block's 64-character lowercase hash, without `0x`; required with the node URL |
| `VITE_MIDNAMES_KNOWN_NAME` | Exact canonical name from an independent, dated observation; required on non-`undeployed` networks or with a non-loopback indexer |
| `VITE_MIDNAMES_KNOWN_ACC` | Its independently observed 64-hex deployed ACC address; required on non-`undeployed` networks or with a non-loopback indexer |

The panel rejects partial configuration. It accepts exact canonical lowercase
names within the chosen namespace. Each lookup captures one indexer block,
checks the registry verifier roster and resolves the name from that block using
the Midnames `/core` subpath. Only its contract target proceeds. The adapter
checks the activated ACC and complete verifier roster at **the same block**.
Missing names, wrong target types and unavailable reads have separate outcomes.
With a configured node pin, the adapter first checks the anchor and the
indexer's selected block hash against that node's canonical, finalized chain.
It refuses an unfinalized, noncanonical or wrong-chain block before reading the
registry or ACC. Online profiles require this pin on a node origin separate
from both indexers. The node can be behind the indexer, in which case lookup
refuses until a finalized block becomes available. The indexer remains trusted
for the **contract-state bytes** returned at the selected block; the node check
is not a state proof. The demo presents the result for inspection and value
routes re-resolve before submission.

For any non-`undeployed` network or non-loopback indexer, the two known-mapping
inputs and a complete second indexer path are fail-closed readiness gates.
Before **every** lookup, the adapter reads the known name through both
configured paths and requires the expected deployed ACC. It then requires both
paths to agree on the requested contract target. A missing, moved,
malformed, or unavailable known record stops the requested lookup and any
remote standalone claim availability or receipt check; it never falls back to
a different destination. The operator must obtain and record the
known pair from an independent source with its observation date before setting
these public inputs. Each path uses one internally consistent indexer block
with the same pinned network, registry and ACC verifier checks; a missing
record on only one path, a changed target, or an unavailable path refuses the
lookup. Different origins alone do not prove
independent backends, matching chain height, or independently verified live
mapping. The operator must establish those properties separately before
claiming online qualification. Claim availability and finality still read the
primary path after the known-name gate; this slice does not qualify an online
claim flow.

For the local `undeployed` profile, a separately stored
[Indexer API v4 witness](../../infra/localnet/README.md#independent-local-indexer-api-v4-read-witness)
can attach to the existing shared node without starting another chain. The
[read-only verifier](../../examples/midnames-local/README.md#check-an-independent-indexer-read-path)
compares the serialized registry and activated ACC state at one pinned claim
block hash across the primary and witness indexers, verifies both selected
blocks against the canonical finalized node, then exercises the configured
two-indexer resolver on the known `paidfix.night` → ACC pair. Its
[redacted local receipt](../../examples/midnames-local/evidence/independent-indexer-local-provenance-20261122.json)
records equal state hashes and a matching name resolution at signed source
`aa0d436d`. Both indexers use the same node and the historical claim-block
pin; their agreement is a local replaceability check, not an authenticated
state proof or online provider qualification.

The reference demo pins the published Midnames 2.1.0 reader. Its generated
reader matches the pinned
[`ledger-9-live` commit](https://github.com/midnames/ns-sdk/tree/f8f2edd425221b95c9158d74e7318d2fbb4f61b2),
and the app checks that byte identity in its tests.
Midnames 2.1.0 uses a Ledger 9 reader built with runtime 0.21.0 and Midnight JS
5.0.0. The ACC still uses runtime 0.20.0. The indexer hands out tagged bytes,
so each decoder uses its own runtime. The exact dependency exceptions in
`pnpm-workspace.yaml` apply to this demo qualification. Registry integrity,
lifecycle-script blocking and the cooldown for other versions still apply.
The upstream 2.1.0 provider still carries historical API v3 default URLs.
This demo never selects those defaults: configuration and the Midnames reader
require explicit, paired Indexer API v4 HTTP and WebSocket URLs, including
for the separately configured verification reader.

The generated registry and the Ledger 9 HTTP read format have a local test.
A read-only check against the existing demo indexer also returned the expected
missing-contract response for an absent address. An online profile requires
evidence for its deployed registry, a known name, and the corresponding chain
before it is enabled.
The local [finalized-state verifier](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/examples/midnames-local#open-the-local-passport-and-midnames-demo)
uses the node's canonical finalized block as a single Indexer API v4 offset
for the registry and target ACC. This avoids reading those two contracts on
different indexer tips in that operator check. The interactive resolver also
checks its selected indexer block against the configured node's finalized
canonical chain on each supported-target lookup. It still trusts indexer
contract-state bytes at that block. Neither check qualifies an online provider
or proves the returned state cryptographically.
When two indexers are configured, each lookup requires them to select the
same finalized canonical block before reading either target. Both reads use
that block hash for the registry and ACC. A lagging provider refuses instead
of making an older target appear to agree with a newer one. The separate
node pin is required for a two-indexer profile, including local loopback.
For a different requested name, the known mapping pin and requested target
are read at that same selected block within one resolution; the next
resolution selects and checks a fresh block.
This source behavior has no qualified online mapping or independent backend receipt.
The [matched-tip local receipt](../../examples/midnames-local/evidence/independent-indexer-matched-tip-20261122.json)
at signed source `3a860393` exercises that configured resolver with two
self-hosted indexers on the shared Ledger 9 node. The read was invoked from
Node; it is not a physical-provider or online-profile qualification.

As checked on 19 November 2026, the pinned SDK's historical Midnight-hosted
preprod indexer endpoint returns HTTP 410. The [current network endpoint
guide](https://docs.midnight.network/guides/networks-and-environments) uses Blockfrost project
authentication for preprod. The guide records a 7 November Preview reset;
a read of the SDK's pinned Preview registry address through the current v4
indexer returned no contract on 14 November. No independently known online name-to-ACC contract
mapping has been qualified, so this demo does not enable an online Midnames
profile. Keep a project token in a host-controlled indexer proxy or provider,
never in `VITE_` browser inputs. The reference browser does not host an
authenticated proxy itself.

A [22 November single-provider mainnet read](../../examples/midnames-online/evidence/mainnet-passport-name-v4-observation-20261122.json)
reached Midnames' registry through its Indexer API v4 endpoint and observed
`passport.night` with a shielded **primary** target at one indexer-selected
block. The name's existence is distinct from Passport control of its parent,
delegated subdomains, or a contract-call route to an ACC. This read lacks an
independent node-finality check and a second provider, so it cannot admit an
online Passport profile.

For a local host using Midnight Preprod, the optional
[Blockfrost indexer proxy](../../examples/midnames-online/README.md) exposes the
v4 HTTP/WebSocket paths to the browser and adds the project ID only upstream.
It is a transport example, not an online naming qualification. The Preprod
registry, independently known name-to-ACC mapping, and a genuinely separate
second indexer must still be verified before enabling the online profile.
The optional [known-mapping host check](../../examples/midnames-online/README.md#check-one-known-mapping-at-a-finalized-block)
accepts a dated, independently observed name-to-ACC pin and two tokenless
Indexer API v4 readers. It waits for both readers to expose the same
node-finalized block, reads the registry and activated ACC at that block, and
refuses a changed target or a noncanonical block. It sends a Blockfrost project
ID only to the exact official node RPC origin. The browser proxy above rejects
this host CLI because it requires a browser Origin; operator-controlled CLI
endpoints need their own access policy. This source-only check has synthetic
tests, not a live public provider receipt. It cannot establish that the
operator's known pair was independently observed or that two origins have
separate backends, so it does not enable the online demo profile.

| Passport naming constraint | Implemented local subset | Deviation or remaining gate |
| --- | --- | --- |
| [MIP-0007](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0007-name-service-registry-and-resolver.md) contract-call routing | Resolve a canonical path from the configured registry root and accept only its contract target, never its default field or a wallet target. Check the target's deployed ACC verifier roster. | The live Midnames 2.1.0 single-contract registry has a transitional target field, not the proposed delegated operation-context resolver or contract-owned-name arm. |
| [P2](https://github.com/midnightntwrk/passport/blob/main/docs/plans/PROMISES.md) on-chain name binding | Check the registry's pinned verifier roster and require two configured readers to agree on a contract target for online profiles; require a matching owner commitment and ACC target for claim confirmation. | Each indexer remains a trusted read input. Independent backend/chain-state agreement, public `passport.night` ownership, complete named onboarding, and total-loss continuity remain open. |
| [P8](https://github.com/midnightntwrk/passport/blob/main/docs/plans/PROMISES.md) substitutable infrastructure | The reader accepts injected providers; local qualification uses an owned indexer and prover rather than a Midnames-hosted lookup service. Online source configuration requires distinct indexer origins and fails closed on disagreement. | Distinct origins alone do not establish independent providers. The online authenticated provider and independently known name-to-contract smoke are unqualified. The optional claim sponsor is a host policy and has no demonstrated online replacement. |

The 2.1.0 tarball includes a read generation and an older managed write
generation. Its root export can fail at load because the managed module expects
runtime 0.15.0, and its write wrapper reports writes paused. The demo uses only
the read subpaths. Its local claim flow recompiles the pinned branch's registry
source with ZKIR v3, deploys a new contract, and qualifies proof and submission
against that contract. A local `.night` profile does not
establish public `passport.night` issuance or name-control recovery.

### Standalone registry profile

For an operator walkthrough, use the [local demo launcher and setup
recipe](../../examples/midnames-local/README.md#open-the-local-passport-and-midnames-demo).
It attaches to a compatible running Ledger 9 stack or starts a separate
Passport-owned project from the pinned Compose template. It verifies the
recorded name claim and ACC against live chain state before enabling the
browser's local resolver and named NIGHT control. A fresh chain needs ACC
activation, registry bootstrap and a finalized name claim first.

For a disposable `undeployed` network, set
`VITE_MIDNAMES_REGISTRY_PROFILE=standalone-0.35` alongside the five settings
above, and pin `VITE_MIDNAMES_CLAIM_PROTOCOL_VERSION` from a known indexed
transaction. This selects the independently pinned standalone verifier roster
and the transaction format used to reconcile an original claim. A missing or
unsupported protocol pin refuses the claim profile rather than reporting a
finalized transaction as unavailable.
Resolver-only standalone profiles can omit the claim pin; they provide name
lookup without claim recovery or dispatch.
The default profile remains `midnames-2.1.0`. A registry with a different
roster is refused. See the [standalone preparation recipe](../../examples/midnames-local/README.md).
The same recipe now includes a dedicated bootstrap command for an already
healthy, operator-controlled local stack: it deploys the pinned registry after
an activated ACC exists, records its address and original transactions, and
keeps the root naming secret in a private local receipt. This is a local
deployment path, not a replacement for an independently known online mapping.
The shared-chain claim fixture keeps an owner-held secret separate from the
sponsor and refuses to report a name until the exact original transaction has
finalized with `SUCCESS`. Its first fresh-sponsor shared-stack qualification
was rejected by the node with error 104 despite two DUST spends. The separate
[reconciliation command](../../examples/midnames-local/README.md) checks the
fenced original, finalized funding, expiry and absence before releasing the
run's native lease. No shared-chain `alice.night` claim is qualified yet.
A separate root-assisted fixture also reached the node but received the same
error 104 before creating a name. A read-only Ledger 9 replay identified an
overclaimed storage-deletion credit in both `create_domain` transactions:
1,364 bytes declared against 1,136 actually deleted. A corrected local
`create_domain` finalized for `gasfix.night`; its subsequent uncorrected
`transfer_domain` was rejected with the same error (788 bytes claimed against
656 measured). The local owner fixtures now construct both calls without a
deletion credit before proof, in either the guaranteed or fallible transcript
partition. After exact reconciliation of the partial issuance, a transfer-only
recovery finalized `gasfix.night` under its distinct owner. A fresh paid claim
at signed `3c9f998` then finalized `paidfix.night` through a separately seeded
sponsor funded by local genesis. Both names resolve to the activated ACC on the
shared Ledger 9 chain, and both final receipts are **PASS**. The paid fixture's
first funded attempt stopped before proving; its two funding transactions and
absent claim were reconciled before the fresh run. These scoped fixtures do not
qualify browser onboarding, passkey recovery, public `passport.night` issuance
or online sponsor funding. No live `alice.night` mapping was established by
the earlier failed receipts.
A later [read-only Compact 0.36 evaluation](../../examples/midnames-local/evidence/compact036-readonly-20261119.json)
recompiled the same pinned registry source for runtime 0.21.0. All 13 ZKIR
circuits and all 13 prover/verifier key pairs matched the 0.35 standalone
manifest byte for byte. Its generated reader decoded `paidfix.night` and the
same ACC at a node-finalized block. This narrows the migration question but
does not qualify 0.36 proof, transaction gas, submission, browser registration,
or a change to the deployed profile. The local 0.35 deletion-credit guard stays
in place.

A later [isolated Compact 0.36.1 native receipt](../../examples/midnames-local/evidence/compact0361-native-name-control-20261123.json)
extends that result to a paid, owner-proved name claim and a separate
owner-authorized transfer. Each exact original finalized `SUCCESS` at a
node-checked canonical block; `v36claim23.night` resolved to the same activated
ACC before and after its owner commitment changed. The generated 0.36.1
registry used the same 13 verifier keys as the deployed standalone registry,
the existing deletion-credit guard, Compact runtime 0.21 and one physical
Midnight.js 5.0.0/Ledger v9 1.0.0 proof tree. A separate pinned Ledger v9
1.0.2 wallet balanced sponsor fees through serialized bytes. This is an
isolated local compatibility result, not a new ordinary demo profile or a
qualification of online names, full browser issuance, or real passkeys.

The source reader also accepts an explicit local `standalone-0.36.1` profile
for this registry's byte-identical verifier roster. A retained-chain read
checked the paid claim, owner transfer, and current name-to-ACC binding at
node-canonical blocks through that profile. Verifier equality alone cannot
identify which compiler produced a deployed contract, so the host must pin
the deployment address and its own build record. The reference page keeps
registration and named sending disabled for this profile until its 0.36.1
browser proof and send path is qualified. The ordinary local demo remains on
`standalone-0.35`.

For an online deployment, the host must configure its actual registry address
and a funded sponsor wallet through `PASSPORT_SPONSOR_SEED` in the service
environment; the local genesis seed does not fund Preview or Preprod. The wallet
needs NIGHT and usable DUST to pay for transactions. See the
[Midnames SDK source](https://github.com/midnames/ns-sdk),
[Midnames guides](https://docs.midnight.domains/) (including its
[Preprod connection guide](https://docs.midnight.domains/preprod/connect/)), and Midnight's
[wallet funding guide](https://docs.midnight.network/guides/acquire-tokens).

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
zero submissions. A later standalone demo run used a Chromium virtual passkey
to prove one fixed claim, then recovered its original receipt after dropping
the send response and restarting Chromium. That fixture injected a quote after
proof to exercise dispatch recovery; it did not establish pre-proof user review.
Real passkey provider recovery and
online profile qualification remain open.

A later isolated source run at signed `e456638` exercised a separate
quote-before-naming-proof lane. After deploying the ACC and registry, the
fixture issued a distinct quote, showed its exact fields in owner Chromium,
and checked that no naming proof request preceded the automated approve click.
The virtual credential's PRF and live-term-checked proof followed that click.
The sponsor-balanced receipt retained the same quote digest; the browser then
sent one claim, refused an alternate credential, and recovered the original
after a lost response and Chromium restart with 20 live indexer requests.
Fresh run `midnames-claim-preproof-20261116b` passed with unchanged inputs,
three stopped owned containers, retained volumes, and a released lease. An
earlier functional attempt on the same source had Docker cleanup time out;
its parent remained `FAIL`, and its exact containers and lease were reconciled
before the fresh run. The quote was made by this fixture, the approval was
automated, and virtual credential enrollment occurred before the quote. This
does not qualify the sponsor HTTP quote endpoint, the full demo create/open
page, a human review, or a real passkey provider.

The host registry reader can inspect the stored owner commitment and target
from the same verifier-checked snapshot. Generated-state tests check the
commitment of a claimant distinct from the root owner. Confirmation of a
future claim requires both fields to match the original intent and evidence
that the original transaction finalized successfully.

### Recover the sponsor's original claim in the demo

For `standalone-0.35` with namespace `night`, create or open the target Passport
ACC with its passkey, then use **Register a .night name** on Passport account →
Balances. This optional post-ACC step can happen later with the same account.
Reviewing a valid claim
quote stores the selected `.night` name per registry, ACC, and credential in
this browser. Reopening with the same credential restores that selection and
checks any retained original claim. Checking availability and importing a
receipt only inspect the entered name; after a reload, enter it again unless a
quote was reviewed. Setup remains pending until the original
transaction and current registry record match. Selection alone does not claim
the name; browser storage loss or a different device requires recovery from
the original receipt. Name-owner rotation after total credential loss is not
qualified by this source preview.
An exact indexed `FAILURE` with matching transaction bytes, identifiers and
claim call, plus an absent current registry record, is reported as failed rather
than pending. A `PARTIAL_SUCCESS` can also identify a failed registration claim
when the indexed segments show only the sponsor's DUST fee succeeded and the
sole claim intent failed. This requires the pinned standalone transaction shape;
any missing, extra, duplicated or different segment remains a conflict. The fee
is not refunded. **Release failed original for a new attempt** checks the same
failure outcome again and checks that the name is still unregistered and the ACC is supported.
With the local sponsor, it first verifies the exact prepared bytes and dispatch
fence, the indexed transaction and its canonical finalized block, then archives
the sponsor's entire private journal with a durable failure and fee-outcome marker.
Only after the sponsor confirms that archive does the browser clear its selection
in one durable transaction. The receipt and its original identifiers remain available in local
history after reload; importing the same failed transaction again is refused.
Review a fresh quote before preparing another claim. Other `PARTIAL_SUCCESS`
outcomes, malformed or mismatched transactions, provider outages, and missing
finality do not enable release. This is a source-preview local recovery path;
the isolated `undeployed` Ledger 9 run at signed `c757388` qualified one exact
indexed paid claim-segment failure, explicit Chromium release, archive recovery
after browser restart, and one distinct host-sponsored retry that finalized to
the same ACC. The original and retry each dispatched once. The runner verified
unchanged inputs, stopped its three owned containers, retained volumes, and
released its native lease. The retry's new quote, proof, and dispatch remained
host-driven in that run. A later signed `b58668e8` isolated run used the
reference browser to review saved terms, send the fresh claim once through
the sponsor HTTP fence, and reconcile its original after a lost response and
reload. The retry indexed `SUCCESS` to the same ACC. The new quote, proof, and
balance were still host-driven; this does not qualify browser review before
proving or a real passkey provider.
The [older release-stack retry receipt](../../examples/midnames-local/README.md#release-ledger-9-native-claim-retry)
repeated the host-driven failure-and-retry path on node 2.1.101, indexer
4.4.101, and prover 9.0.2. It retained the Compact 0.35 artifacts and used
Ledger 9 `1.0.2` throughout the reference client. The first claim's fee-only
`PARTIAL_SUCCESS` was archived and released after a browser reload; a different
original then finalized `SUCCESS` for the same ACC.
On later signed source `46add31e`, a fresh isolated run used the actual
Passport name form for the retry. It obtained one sponsor-issued quote before
the owner proof, prepared and sent the reviewed claim once, then recovered its
indexed `SUCCESS` and live binding in the same persistent browser profile after
the sponsor response was lost. The failed original had already been archived
and released in a separate browser profile. The ACC login connector supplied an
already activated test account, and the credential was virtual. This qualifies
that bounded local page-to-chain retry, not a combined ACC creation ceremony,
one browser profile across both attempts, a real passkey provider or an online
registry. See the [redacted page-owned receipt](../../examples/midnames-local/evidence/release-ledger9-page-claim-retry-20261120.json).
On signed source `e3ec3608`, a new isolated run moved the indexed failure
release into the actual Passport page's retry profile. That profile imported
the exact original, confirmed the failed claim and archived sponsor journal,
released it, retained it across reload, then obtained one quote, proved,
prepared and sent the new claim once. It recovered indexed `SUCCESS` and the
live same-ACC binding after a lost sponsor response. The
[redacted same-profile receipt](../../examples/midnames-local/evidence/release-ledger9-page-same-profile-20261120.json)
qualifies local release-to-retry continuity with a virtual credential. The
first original was still prepared outside the page, and ACC login still used
an already activated fixture account. This does not establish full onboarding,
real-provider custody, public `passport.night` issuance or online substitution.
On signed source `4a6c7642`, a further fresh isolated Ledger 9 run moved both
original preparations into the same persistent Passport page profile. The
first original finalized with a failed claim segment and a paid sponsor fee;
the sponsor archived it before the page released its local reservation. The
page then proved and prepared a new reviewed original, sent it once, and
recovered indexed `SUCCESS` and the same-ACC binding after a lost response.
The [redacted two-original receipt](../../examples/midnames-local/evidence/release-ledger9-page-two-originals-20261120.json)
records the exact transactions and canonical blocks. The ACC connector still
supplies an already activated test account, and the naming credential is
virtual. This does not prove combined ACC creation, real-provider custody,
online registry agreement or total-loss name continuity.
Issue #334 remains open for the broader failure matrix and combined
onboarding/provider paths.
If legacy storage contains multiple original claims,
enter an original name to inspect it before preparing another.
The synthetic full-app Chromium fixture now follows create/open into this form:
it refuses release after a conflicting status or an unavailable recheck, then
releases a failed fixture and retrieves its archived original after reload
without creating a second ACC. The fixture substitutes the registry status; it
also checks that displaying an exact synthetic claim quote happens before the
first owner-proof or sponsor-preparation call, and that explicit approval calls
each once. This synthetic fixture alone does not prove an actual failed
transaction, a real sponsor quote, or a passkey ceremony. The separate native
run above proves the indexed failure, browser release, and a later browser-sent
prepared retry. The newer isolated run at signed `46add31e` also proves one
sponsor-issued pre-proof quote, owner proof and browser send through the
Passport name form; `e3ec3608` connects release and retry in one browser
profile. The combined ACC create/open ceremony and real-provider
custody remain unqualified.
**Check registry status** reads the pinned registry and verifies the open ACC
before reporting an unregistered name. Availability is an observation at the
time of the read. A retained receipt takes precedence and is reconciled
against the original transaction.

Start the [standalone owner and sponsor services](../../examples/midnames-local/README.md#send-an-acknowledged-receipt-from-the-browser)
to enable **Review claim quote** in the local demo. The form shows the exact name, network, ACC,
registry, payee, future subdomain payment address, sponsor payment wallet, NIGHT price,
DUST ceiling and expiry. **Approve and
prepare claim** records that quote before owner-side proving. The form records
the public owner commitment before asking the sponsor to balance the proved
transaction. It then saves the matching receipt automatically. **Review terms
before send** shows the saved payment terms; only the second **Confirm reviewed
terms and send** click dispatches the claim. **Check original claim** reads both
the indexer and the local sponsor's dispatch fence, so an unsent preparation is
identified as such. If its quote expires, the sponsor can verify and archive
that exact unsent original before a fresh quote; a fenced or uncertain send
stays pending. A public receipt imported without the matching saved
quote can be checked and reconciled, but cannot be sent from this browser.

The sponsor also searches a bounded set of its private retired journals for an
exact issued quote. A quote moved with another original cannot be mistaken for
that original: its terms and digest must match, and the occupying balance intent
must belong to a different quote. The sponsor records an exact pre-intent
refusal beside the archived quote, allowing only that browser's unprepared
reservation to be released. Missing, malformed or conflicting archive data
keeps the reservation pending for investigation.
For a quote that never entered balance, the sponsor has no recorded owner
commitment to assign: its refusal is bound to the exact quote and competing
original, while the browser releases only its own quote-and-owner reservation.
An earlier caller cannot claim that owner or strand a different browser's
recovery. A quote with a recorded owner decision still requires that exact
commitment.
The [synthetic Chromium recovery receipt](../../examples/midnames-local/evidence/archived-competing-quote-browser-20261122.json)
checks two separate browser storage profiles, sponsor HTTP refusal, reload,
exact local release and a distinct fresh quote. It sends no claim transaction.
The [claim-screen harness](../../examples/midnames-local/evidence/archived-competing-quote-ui-20261122.json)
also invokes the real preparation UI after reload: one Review action releases
only the matching saved reservation and displays new terms, without a passkey
proof or claim submission.

If the preparation response is lost, reopen with the original credential and
select **Continue registration**, then **Check saved claim** when offered. The host looks up the original preparation.
If its quote expired before a transaction was prepared, the local sponsor checks
that it has no prepared transaction or dispatch fence, retains an exact
retirement record, and checks that the name is still available. A recorded
balance intent is archived; a quote that never reached the sponsor keeps its
issued record and gains a durable refusal marker. The browser then releases
only that matching quote and shows fresh terms. A sponsor still balancing the
original refuses this recovery until the work has stopped; the browser keeps
the original in that case. The local demo quotes expire after four minutes so
the displayed review deadline matches the sponsor wallet's transaction TTL.
You can also import the original public
receipt when its quote digest and owner commitment match. Once the owner commitment is recorded,
the browser can recover the receipt after expiry and leaves preparation
unchanged. The optional adapter requires an owner-side prover and a sponsor
that can retrieve the prepared receipt by quote and owner commitment. The
standard demo continues to support importing a public receipt.
When the sponsor durably refuses before recording any balance intent, the
browser releases that refused quote and asks the user to review fresh terms.
An unavailable response or an already recorded intent keeps the original
quote for recovery.

To recover an external claim, enter the name and paste the sponsor's original
public receipt. Save it, then
use **Check original claim**. After a reload, open the same account with the
same credential, enter the name again, and check the saved receipt.
If another credential opens the same ACC, its local check reports the retained
original as a claim conflict rather than treating it as that credential's own
record or as a provider outage. Reopen with the original credential and receipt.

The sponsor prepares this receipt before dispatch. Its fields are
`networkId` (`undeployed`), `registryAddress`, `accountAddress`, `name`,
`ownerCommitment`, and `transaction` with the original finalized
`identifiers` and byte `sha256`. Keep the original receipt available when a
response is lost. The preparation adapter also returns `quoteSha256`, the
SHA-256 digest of the canonical quote JSON. IndexedDB retains public fields scoped to the original
credential and protects the record from replacement by another tab. The
checker reads the original identifiers, verifies the exact transaction bytes
and the registry inserts linking the name to its domain ID, owner commitment
and contract target. It then checks the current owner and activated ACC target. An absent
transaction stays pending; an unavailable read is distinct. Partial success, malformed
or changed transaction bytes, and a mismatched owner or target are conflicts.

The isolated fixture prepares the proof in a separate owner process. The
sponsor balances it and accepts an explicit reviewed send action
for a quote-bound receipt already saved to the open credential. The sponsor
checks the exact registry payment and permits NIGHT inputs and change only at
the quoted sponsor payment wallet. It also checks that the registered domain's
future subdomain payment address matches the quote. This fixture constructs its dispatch quote
after proving and seeds the browser journal; it tests quote-bound send and
recovery, not a user's pre-proof quote review. It acknowledges the
durable dispatch record while the wallet waits for the node. The demo shows
the result as pending until the original receipt verifies against the indexer.

In the standalone qualification, Chromium dropped the acknowledgement after
one sponsored submission with two DUST spends. After restarting Chromium, the
demo recovered the same claim from the live indexer. This run used a synthetic
browser credential. The form accepts the public receipt. Name ownership
depends on retaining the separate owner secret.
An owned rerun on signed source `979b9e2` again proved in a separate owner
Chromium process, accepted exactly two DUST spends under the sponsor policy,
made one browser submission, refused an alternate credential, and recovered
the original receipt after a lost response and browser restart. The fixture
attaches its quote after proof, so it does not qualify human pre-proof review
or the Balances panel's full ACC create/open handoff.
The [merged native qualification fix](https://github.com/input-output-hk/midnight-passport-sdk/pull/342)
then passed the same isolated browser claim flow on clean signed source
`9a19757`: one sponsored dispatch, recovery after the lost response and
Chromium restart, alternate-credential refusal, and 23 live indexer requests.
The native runner verified unchanged source and cached inputs, stopped its
three owned containers, retained their volumes, and released its lease. The
local receipt is preserved outside the public documentation. This is a
synthetic localnet credential, not a real WebAuthn provider or an online
`passport.night` claim; total-loss name-owner continuity remains open.
The synthetic full-app handoff check (`nix develop -c pnpm --filter
passport-dapp test:midnames-handoff` after the package build) exercises
create/open navigation, the Balances panel, public-receipt checks and
credential scoping. It also checks that an unavailable quote, a quote for a
different ACC, and a changed name cannot start owner proving or sponsor
preparation. A synthetic durable pre-intent sponsor refusal releases its
attempt for a fresh reviewed quote; the later retry retains one original
receipt without creating another ACC. These are browser-source checks, not
proof of an actual sponsor refusal or chain transaction. Its connector and
naming responses are fixtures: it is
not a native ACC deployment, real passkey, claim transaction or provider run.
The [browser claim design](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/adr/0018-standalone-midnames-claim.md) describes
the proof and sponsor checks for browser-initiated onboarding.

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

The sender reopens the fixture's synthetic genesis wallet after setup and uses
the recipient ACC's public encryption key. The
recipient retains its viewing secret and independently verifies that the
decrypted inbox entry matches the output in the successful original transaction
and is still held by the account. An uncertain send keeps its original
identifiers for reconciliation.

On the isolated Ledger 9 chain, the sender submitted once and the deposit of
10 smallest units of a synthetic token finalized at block 73. The owner
verified the original output and the held amount. Separate live reads covered
an unknown name, a different network, and an incompatible contract.
An owned rerun on signed source `979b9e2` finalized the independent sender's
one dispatch at block 74 and again matched the original output, decrypted
inbox coin, and current holdings. It used a fresh isolated registry and ACC;
the prior run's block and contract addresses are not reused.
Another fresh isolated run on signed source `d492487` (the tree merged in
PR #341) passed the same one-dispatch owner-holding checks. It is an
earlier-head native result, separate from the later `9a19757` browser-claim
qualification.

At signed source `b87ed6c`, a separate sender displayed that resolved intent
on its own localhost browser page before preparing the named deposit. An
automated Chromium click approved it. The isolated `undeployed` run finalized
one dispatch, and the recipient verified the original output against its
decrypted, still-held coin. The runner verified unchanged inputs and exact
owned cleanup. This is browser rendering and ordering evidence, not a human
approval or an online `passport.night` run. The sender page has only public
resolution fields; payment authority stays in the sender process, while
recipient signing, viewing and name-ownership secrets remain with the owner. See the
[browser review recipe](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/examples/midnames-local#review-the-named-deposit-in-the-sender-browser).

On the designated **shared** Ledger 9 chain, a later run at signed `8165c73`
used the existing `paidfix.night` claim and activated ACC. The independent
sender's browser displayed the exact destination before automated approval;
one `deposit_shielded` transaction finalized at block 5361. The recipient
reopened that same ACC with its saved local mock passkey and read the matching
10-unit synthetic coin at inbox #2 through the demo's chain-verified holdings
view. The [redacted receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/shared-ledger9-paidfix-deposit-20261118.json)
records source, chain, registry, claim, ACC and deposit pins. An earlier
rejected deposit attempt was reconciled from its original identifiers after
expiry before this new send. Its Ledger 9 rejection was excess deletion
credit in the generated call, not a shortage of NIGHT or DUST; the local
fixture now forgoes that credit before proving and balancing. This remains
one local profile with automated sender approval and a development credential.

Run the [standalone fixture](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/examples/midnames-local)
from a source checkout containing #317. The fixture uses local `.night` on
`undeployed` and a self-hosted indexer and proof server. Public
`passport.night`, provider substitution and ACC-to-ACC sends require separate
qualification.

### Send NIGHT from one ACC to another by name

For the connected browser preview, the built-in wallet must have usable DUST to
pay the withdrawal fee. Holding NIGHT alone does not produce DUST: the wallet's
**Enable DUST generation** action registers its own NIGHT output in a separate
transaction. Fund the displayed wallet address, register, verify finality, then
wait for the DUST balance to become positive. The browser saves the registration
transaction identity before dispatch and retains an uncertain original for
reconciliation. The fee-only service sponsor refuses value-bearing offers.

The standalone Node fixture implements the named **NIGHT** route for
`acc-s3r1.1` on `undeployed`. It requires an activated contract target and
shows the source, network, recipient, bridge wallet, amount and both
operations before owner approval. The pinned registry address is encoded in
the displayed `providerId` as `midnames:<registry address>`. The owner signs
`withdraw_unshielded_with_jubjub` to the controlled wallet. Once that leg is
final, the wallet uses its exact output to call `deposit_unshielded` on the
reviewed recipient ACC and update its balance. The ACC signature binds the
withdrawal, bridge, asset and amount. The host journal binds the name and
recipient contract to the deposit, which is permissionless.

The two transactions settle independently. Their shared unshielded wallet
output links the transactions in the ledger. If the deposit has yet to dispatch,
the original intent can continue once its withdrawal is confirmed. Once a leg
has dispatched, the host checks its original transaction identifiers.
Re-resolution can detect a repoint before either leg, based on the most recent
observed registry state. After withdrawal, a repoint leaves the value in the
controlled wallet pending reconciliation. Shielded ACC-to-ACC sends, browser
passkey consent for this route and online profiles remain unqualified.

The isolated run started at 10 and 0 smallest NIGHT units. It finalized the
withdrawal at block 147 and paused at 6 and 0. After the journal was reopened,
the original wallet output funded the deposit at block 150, leaving balances
of 6 and 4. Both legs dispatched once. An independent indexer read matched
the withdrawal output to the deposit input.
An owned rerun on signed source `979b9e2` reached the same 10/0 → 6/0 → 6/4
balances. It finalized withdrawal and deposit at blocks 94 and 97, consumed
the exact bridge output, and recorded one owner approval and signature for
the withdrawal, one dispatch per leg, and zero replay broadcasts. The fresh
registry and ACC addresses differ from the earlier run.
The fresh signed `d492487` run also passed after an interruption between the
two legs: the reopened journal consumed the exact withdrawal output and
reached 10/0 → 6/0 → 6/4 with one owner approval and signature for the
withdrawal, one dispatch per leg, and no replay broadcast. This is an
earlier-head result;
the merged `9a19757` fixture changes concern claim-browser diagnostics and
assertions, not the named NIGHT route.

At signed `ec83ce9`, the isolated owner fixture displayed the exact source and
recipient ACCs, resolved name, registry/provider, bridge wallet, smallest-unit
NIGHT amount and both operations in a localhost browser before any owner
signature or payment dispatch. An automated Chromium click approved the
combined review. The durable intent then withdrew once, paused at 6/0,
reopened and deposited the exact original bridge output once, ending at 6/4
with one owner signature and no replay broadcasts. Frozen inputs and exact
owned cleanup passed. This supports the local browser ordering and two-leg
receipt; human passkey approval, an owner send page in the Passport demo,
online `passport.night` and MIP-0007 delegated routing remain open. See the
[browser NIGHT recipe](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/examples/midnames-local#review-the-two-leg-night-payment-in-the-owner-browser).

The separate signed `a20a9b9` isolated browser decline passed with an explicit
**Decline** click, unchanged 10/0 ACC balances, no owner signature, no
withdrawal/deposit dispatch and no admitted payment journal. The parent
verified unchanged inputs, exact-owned cleanup and lease release. Page close
and timeout now fail instead of masquerading as a decline; this remains an
automated local refusal, not human passkey approval.

A separate signed `e8fd610` isolated run tested a registry change after the
same automated browser approval. The root-owned `alice.night` record was
updated on-chain to a third activated ACC. Fresh resolution returned that new
ACC, but the original payment journal retained the reviewed recipient. The
payment refused before any owner signature or withdrawal/deposit dispatch;
source, old recipient and new recipient balances stayed 10/0/0. The parent
verified unchanged inputs, stopped only its three owned containers, retained
volumes and released the lease. This demonstrates one local refusal when a
name changes before signing; online provider reads and human approval remain
unqualified.

For the source-only browser host, the NIGHT journal stores one active
intent per source ACC and network on the same origin, scoped to a public
credential identifier. IndexedDB transactions fence the original withdrawal
and deposit IDs before dispatch, retain them across reloads, and refuse a
different credential or new request while one is active. The host may archive
only after its finality reader confirms both original legs; the archived IDs
remain available for audit. This local storage neither authorizes a payment
nor coordinates another website. The opt-in Passport demo page wires this
journal to its two-leg named-send control.

The current source exposes `beforeSubmit` on `withdrawUnshielded` so a host can
commit those original IDs before the standard Midnight adapter dispatches a
finalized transaction. An unsupported chain adapter refuses before owner signing;
a rejected callback prevents dispatch. The opt-in local named-send UI uses
this hook. Connected local candidate journeys and the fresh single-head
create-to-claim-to-payment run are recorded below.

An optional source-only owner port now connects that callback to the named NIGHT
orchestrator. The callback checks the finalized network, source ACC and JubJub
withdrawal circuit, re-resolves the reviewed name, then fences the exact original
withdrawal identifiers before allowing dispatch. A lost response keeps the
original. A name refusal before entering the owner API can retire the
unsubmitted intent with an audit record. A durable owner-start marker keeps
later no-ID outcomes blocked, including a callback refusal.
A source helper maps the selected JubJub account to the reviewed NIGHT amount and
bridge address. The source host wires it to the bridge and finality ports,
and the opt-in local demo page has a send control. It has one connected local
synthetic-passkey result, but no physical-provider or online result.

A source-only browser finality reader can check the original hash, ordered watch
IDs and decoded Ledger 9 transaction against a successful indexer row, then
require the node's canonical finalized block at that height. It fails closed
on missing, malformed or inconsistent evidence. The indexer remains a trusted
source for transaction inclusion in that block; the node check does not
independently prove inclusion. The connected local candidate browser run used
this reader for both original payment legs.

The source owner-review model can also include the full named route in the
actual credential ceremony: canonical name, registry, recipient ACC, bridge,
amount, and both ACC operations. The optional account-owner helper check
requires that approved named scope again at the finalized withdrawal callback,
before the journal fence. This is host authorization and a dispatch guard;
the pinned ACC circuit signs the withdrawal to the bridge, not the name or
recipient ACC. The local candidate browser run exercised this review with a
synthetic passkey; real-provider qualification remains open.

The source bridge-output guard is shared with the local NIGHT recipe. It binds
the fenced withdrawal hash and watch IDs to a single exact controlled NIGHT
output, observes that output in the wallet, then checks the balanced deposit's
input before dispatch. A wallet balance alone cannot authorize a substitute
coin. Before wallet signing, the worker now re-reads the active journal and
derives the expected output from the finalized, decoded original withdrawal.
It refuses a page request that pairs the original hash with a different
same-value bridge coin. The connected local candidate run checked the exact
bridge output and finalized the deposit. The later
[one-head browser run](../../examples/midnames-local/evidence/candidate-onehead-create-claim-pay-20261122.json)
also issued a new name for its source ACC before paying a named recipient;
online qualification remains open.

The internal browser wallet now has a device-held deposit adapter. It balances,
signs and retains one exact prepared `deposit_unshielded` original, then accepts
one dispatch of that original after independently reading the host's durable
IndexedDB fence. It rejects extra
ACC actions, other unshielded inputs and change outputs. The opt-in local demo
control uses this worker; the candidate browser run finalized one deposit with
the recorded original. The source tests remain a distinct evidence tier.

A source-only host composition now joins the selected JubJub ACC, configured
Midnames resolver, scope-bound browser journal, canonical-block finality reader,
unbound `deposit_unshielded` prover and device-held wallet. It derives the bridge
output from the original finalized withdrawal, then asks the worker to prepare
one exact deposit and fences that deposit before dispatch. Each attempt opens
and closes its own journal handle, so a failed proof can resume from the stored
withdrawal without a second withdrawal. The reference page has an opt-in local
connected send control and a native candidate result across signed heads.
Physical-provider acceptance remains open. Transaction inclusion still relies
on the configured indexer.

The demo wallet's separate internal worker port can report its raw bridge
address and whether this exact output is available after NIGHT sync. It checks
that the requested owner is the wallet's own address. The public connector API
remains read-only. The opt-in local browser send control uses the internal
deposit port. Wallet startup checks the pinned v1 service configuration
before passing its proof-server URL to the worker.

The source-only named NIGHT control is on **Passport account → Withdraw**. It is
enabled only for the local `undeployed` JubJub demo with an external Midnames
reader, pinned `standalone-0.35` registry profile, loopback service/indexer/
chain endpoints, and `VITE_MIDNAMES_NIGHT_SEND=1`. The Midnames primary HTTP/WS
indexer pair must match the service-discovered ACC/finality indexer pair;
a separate verification reader may remain distinct. It checks the recipient ACC
and source balance, shows the full named route and both ACC operations, then
stages that exact route for the actual owner credential review. It retains
original transaction IDs across reloads and refuses an automatic second owner
attempt when an existing journal has no withdrawal ID. A
[connected local Ledger 9 browser run](../../examples/midnames-local/evidence/candidate-connected-browser-night-send-20261122.json)
finalized both original legs of one named payment and recovered those exact IDs
after reload. It used a synthetic passkey and spans signed heads. Real-provider
acceptance and online deployment remain open.
A later [one-head local run](../../examples/midnames-local/evidence/candidate-onehead-create-claim-pay-20261122.json)
created and activated a fresh ACC, registered its own `.night` name, and paid a
different named ACC in the same persistent browser profile. The first payment
archived after one explicit original-only check. The page now waits for a
fenced deposit's finality; a separate payment on the next signed head completed
and archived automatically. Neither result qualifies a physical passkey or an
online Midnames provider.

The local candidate launcher sets `VITE_MIDNAMES_NIGHT_SEND=1` only with
`--night-send --claim --funding` and `--candidate-assets`. Its default candidate
page leaves the control disabled.

A fresh isolated Ledger 9 [prover comparison](../../examples/midnames-local/evidence/ledger9-night-by-name-prover-comparison-20261122.json)
found that the release `9.0.2` prover refuses the pinned Compact 0.35 JubJub
NIGHT withdrawal proof before an original exists. With the same release node
and indexer but the pinned `9.0.0-rc.8` compatibility prover, an automated
browser-reviewed synthetic owner payment finalized one withdrawal and one
exact-output deposit, moving the two ACC balances from 10/0 through 6/0 to
6/4. This qualifies that local compatibility profile only. The optional
shared-stack compatibility prover is configured in the
[localnet guide](../../infra/localnet/README.md#isolated-prover-for-the-pinned-compact-035-acc).
The first stable `9.0.0` prover also refused the same withdrawal. An
[offline ACC key comparison](../../examples/midnames-local/evidence/compact036-acc-withdrawal-key-probe-20261122.json)
found that the exact source produces 52 byte-identical ZKIR files with Compact
0.36, while the newer ZKIR key generator deterministically changes the JubJub
withdrawal key pair. The deposit control keys remain identical. This does not
prove the HTTP 400 cause or qualify new keys for an existing deployed ACC.
An [isolated stable-prover diagnostic](../../examples/midnames-local/evidence/stable-withdrawal-036-key-probe-20261122.json)
received nonempty `9.0.2` proof bytes with the 0.36-generated withdrawal
pair after an automated browser review. It stopped before the full transaction
or either payment leg; the source and target ACC balances remained 10/0.
A second signed run held the withdrawal preimage fixed: the old pair returned
HTTP 400 and the new pair returned nonempty proof bytes from the same stable
prover. It stopped before transaction proof or dispatch. The
[full offline key inventory](../../examples/midnames-local/evidence/compact036-acc-key-inventory-20261122.json)
found that 48 of 52 ACC prover/verifier pairs change under the 0.36 tool.
A later [isolated hybrid diagnostic](../../examples/midnames-local/evidence/stable-hybrid-night-send-20261122.json)
deployed only the new JubJub withdrawal verifier on a source ACC, retaining
the old runtime, ZKIR and 51 other verifier keys. With the release `9.0.2`
prover, one synthetic browser-reviewed owner signature led to one indexed
withdrawal and one indexed recipient deposit. Balances moved 10/0 → 6/0 →
6/4, with exact bridge-output consumption and no replay. This source is an
unsupported diagnostic hybrid, not a versioned SDK binding. An existing
retired 0.35 ACC still has its old on-chain verifier. Full 0.36 artifact/key
versioning and qualification, online naming and real-provider acceptance
remain open.

A later [full-roster isolated diagnostic](../../examples/midnames-local/evidence/stable-full-roster-night-send-20261122.json)
deployed a fresh source with all 52 alternate on-chain verifier keys and
completed the same indexed two-leg payment on stable `9.0.2`, with one
dispatch per leg and 10/0 → 6/0 → 6/4 balances. The complete roster was
checked against the pinned inventory and the maintenance authority was
retired. The SDK still exposes only the old supported binding: the new source
used the 0.35 module/runtime/ZKIR, and the other ACC circuits and key
restoration have not been qualified. [ADR 0020](../../docs/adr/0020-ledger9-acc-key-generation-binding.md)
records the required separate version identity and admission gates.

A newer [isolated candidate-binding run](../../examples/midnames-local/evidence/candidate-acc-named-night-send-20261122.json)
used the complete pinned `acc-s3r1.1-zkir036` module, ZKIR, key tree and
manifest for **both** ACCs. The root-owned `alice.night` registry record
resolved to the recipient candidate ACC; a synthetic owner sent 4 NIGHT by
one withdrawal and one exact-output recipient ACC deposit using stable prover
`9.0.2`. Both 52-verifier rosters matched on chain, the intent resumed between
legs, and balances moved 10/0 → 6/0 → 6/4 with no replay. The local
qualification reader is an explicit fixture seam. The SDK and ordinary demo
still refuse this provisional binding. A separate [isolated candidate paid-claim run](../../examples/midnames-local/evidence/candidate-acc-page-paid-claim-retry-20261122.json)
deployed and activated the full candidate ACC, then used the Passport page with
a virtual naming credential and fixture connector to prepare two paid claim
originals in one browser profile. The first claim failed on chain after the
registry policy was disabled; the sponsor archived its exact original and the
page released it after reload. A fresh reviewed retry dispatched once and
recovered indexed success and the same-ACC binding at a canonical finalized
block after a lost response. The candidate reader was injected only into the
isolated page harness. Combined ACC creation and claim in the ordinary demo,
real passkey approval, the broader recovery matrix and online naming remain
unqualified.

The low-level `adapter-midnight-js` NIGHT deposit preflight recognizes the
candidate manifest only with an explicit `provisionalLocal` opt-in and loopback
Ledger 9 / Indexer API v4 endpoints. A separate
[shared-chain proof-only diagnostic](../../examples/midnames-local/evidence/candidate-acc-shared-deposit-proof-20261122.json)
checked the deployed candidate verifier, fetched the pinned deposit artifacts
from an owned loopback key server, and proved one unbalanced 4 NIGHT deposit
call with the shared 9.0.2 prover. It did not balance or submit a transaction
and makes no ACC balance-change claim. The diagnostic composed the call using the
adapter's measured-deposit helper. At signed `a0617f03`, a later
[exported-adapter proof-only run](../../examples/midnames-local/evidence/candidate-acc-shared-adapter-deposit-proof-20261122.json)
called `proveUnboundNightDeposit` itself. The adapter fetched the candidate
verifier and manifest, checked the deployed and fetched verifier against its
pin, and returned one unbound proof with one prover call and zero dispatches.
At signed `0d47432b`, a later
[settled native deposit](../../examples/midnames-local/evidence/candidate-acc-shared-adapter-settled-deposit-20261122.json)
used a separately funded synthetic wallet. An earlier exact 4 NIGHT split
was independently reconciled after an observer query error. The exported
adapter proved the deposit; the wallet balanced and signed that exact output,
and the indexer confirmed one deposit transaction and the recipient ACC's
0 → 4 NIGHT balance change. This did not withdraw from another Passport ACC
or run the browser worker. The browser send page and funding service remain
disabled until the connected two-leg route and browser recovery qualify.

See the [standalone recipe](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/examples/midnames-local).
