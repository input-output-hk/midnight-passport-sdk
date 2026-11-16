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
| `VITE_MIDNAMES_VERIFICATION_INDEXER_URL` | Second HTTPS GraphQL endpoint on a distinct origin; required for a non-`undeployed` network or non-loopback primary indexer |
| `VITE_MIDNAMES_VERIFICATION_INDEXER_WS_URL` | Second WSS endpoint on a distinct origin; required together with its HTTP endpoint for those profiles |
| `VITE_MIDNAMES_KNOWN_NAME` | Exact canonical name from an independent, dated observation; required on non-`undeployed` networks or with a non-loopback indexer |
| `VITE_MIDNAMES_KNOWN_ACC` | Its independently observed 64-hex deployed ACC address; required on non-`undeployed` networks or with a non-loopback indexer |

The panel rejects partial configuration. It accepts exact canonical lowercase
names within the chosen namespace. Each lookup checks the registry verifier
roster and resolves the name from that observed state using the Midnames
`/core` subpath. Only its contract target proceeds. The adapter then checks
that the address is an activated ACC with the complete verifier roster for the
pinned binding. Missing names, wrong target types and unavailable reads have
separate outcomes. An indexer is a trusted read input, and a lookup reflects
its observed state. The demo presents the result for inspection.

For any non-`undeployed` network or non-loopback indexer, the two known-mapping
inputs and a complete second indexer path are fail-closed readiness gates.
Before **every** lookup, the adapter reads the known name through both
configured paths and requires the expected deployed ACC. It then requires both
paths to agree on the requested contract target. A missing, moved,
malformed, or unavailable known record stops the requested lookup and any
remote standalone claim availability or receipt check; it never falls back to
a different destination. The operator must obtain and record the
known pair from an independent source with its observation date before setting
these public inputs. The two paths use the same pinned network, registry and
ACC verifier checks; a missing record on only one path, a changed target, or
an unavailable path refuses the lookup. Different origins alone do not prove
independent backends, matching chain height, or independently verified live
mapping. The operator must establish those properties separately before
claiming online qualification. Claim availability and finality still read the
primary path after the known-name gate; this slice does not qualify an online
claim flow.

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

As checked on 14 November 2026, the pinned SDK's historical Midnight-hosted
preprod indexer endpoints return HTTP 410. The [current network endpoint
guide](https://docs.midnight.network/relnotes/network) uses Blockfrost project
authentication for preprod. The same guide records a 6 November Preview reset;
a read of the SDK's pinned Preview registry address through the current v4
indexer returned no contract on 14 November. No independently known online name-to-ACC contract
mapping has been qualified, so this demo does not enable an online Midnames
profile. Keep a project token in a host-controlled indexer proxy or provider,
never in `VITE_` browser inputs; this reference browser does not provide that
authenticated proxy itself.

| Passport naming constraint | Implemented local subset | Deviation or remaining gate |
| --- | --- | --- |
| [MIP-0007](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0007-name-service-registry-and-resolver.md) contract-call routing | Resolve a canonical path from the configured registry root and accept only its contract target, never its default field or a wallet target. Check the target's deployed ACC verifier roster. | The live Midnames 2.1.0 single-contract registry has a transitional target field, not the proposed delegated operation-context resolver or contract-owned-name arm. |
| [P2](https://github.com/midnightntwrk/passport/blob/main/docs/plans/PROMISES.md) on-chain name binding | Check the registry's pinned verifier roster and require two configured readers to agree on a contract target for online profiles; require a matching owner commitment and ACC target for claim confirmation. | Each indexer remains a trusted read input. Independent backend/chain-state agreement, public `passport.night` ownership, complete named onboarding, and total-loss continuity remain open. |
| [P8](https://github.com/midnightntwrk/passport/blob/main/docs/plans/PROMISES.md) substitutable infrastructure | The reader accepts injected providers; local qualification uses an owned indexer and prover rather than a Midnames-hosted lookup service. Online source configuration requires distinct indexer origins and fails closed on disagreement. | Distinct origins alone do not establish independent providers. The online authenticated provider and independently known name-to-contract smoke are unqualified. The optional claim sponsor is a host policy and has no demonstrated online replacement. |

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
zero submissions. A later standalone demo run used a Chromium virtual passkey
to prove one fixed claim, then recovered its original receipt after dropping
the send response and restarting Chromium. That fixture injected a quote after
proof to exercise dispatch recovery; it did not establish pre-proof user review.
Real passkey provider recovery and
online profile qualification remain open.

The host registry reader can inspect the stored owner commitment and target
from the same verifier-checked snapshot. Generated-state tests check the
commitment of a claimant distinct from the root owner. Confirmation of a
future claim requires both fields to match the original intent and evidence
that the original transaction finalized successfully.

### Recover the sponsor's original claim in the demo

For `standalone-0.35` with namespace `night`, create or open the target Passport
ACC with its passkey, then use **Finish Passport setup** on Passport account →
Balances. This is a post-ACC step for the same address. Reviewing a valid claim
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
failure outcome again, checks that the name is still unregistered and the ACC is supported, then
archives the original receipt and clears the selection in one durable browser
transaction. The receipt and its original identifiers remain available in local
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
host-driven; this does not qualify browser review before proving or a real
passkey provider. Issue #334 remains open for those broader paths.
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
run above proves the indexed failure, browser release, and host-driven retry;
pre-proof browser quote review and real-provider custody remain unqualified.
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
transaction. It then saves the matching receipt automatically. **Send prepared
claim** shows the saved payment terms again and requires a second confirmation
click before dispatch. A public receipt imported without the matching saved
quote can be checked and reconciled, but cannot be sent from this browser.

If the preparation response is lost, reopen with the original credential,
review the saved quote, and select **Recover prepared receipt**. The host
looks up that original preparation. You can also import the original public
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
sponsor balances it and accepts an explicit **Send prepared claim** action
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

Run the [standalone fixture](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/examples/midnames-local)
from a source checkout containing #317. The fixture uses local `.night` on
`undeployed` and a self-hosted indexer and proof server. Public
`passport.night`, provider substitution and ACC-to-ACC sends require separate
qualification.

### Send NIGHT from one ACC to another by name

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

See the [standalone recipe](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/examples/midnames-local).
