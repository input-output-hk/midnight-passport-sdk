# Review and reconcile one original shielded deposit

Source-candidate example for issue [#246](https://github.com/input-output-hk/midnight-passport-sdk/issues/246).
Copy/adapt `reviewed-deposit.ts` into a trusted host after reviewing its ports. It imports public
package APIs and is compiled strictly and executed in the fast test suite. It adds no package,
service endpoint, demo button or native sender implementation. The required recovery exports
are absent from published RC6.

## Host actions

| Action | Review before key use | Sender invocation | Meaning |
| --- | --- | --- | --- |
| `status()` | None | Never | Last local panel snapshot. No journal/network read or fresh finality. |
| `start()` | Fresh review of the captured original intent | Possible, once admitted by durable journal CAS | Initial attempt for this exact request. A second start in this controller is blocked after an approved operation. |
| `reconcile()` | Fresh review, including after restart | Never | Unlock the original journal and use read-only sender/finality evidence. Missing or prepared records remain unresolved. |

The host owns the actual review UI. Show origin, network, binding, destination ACC, sender wallet,
request ID, asset color and **base-unit amount**, plus whether this action can invoke the sender.
Obtain a literal boolean `true`; a thrown review, refusal or truthy non-boolean does not unlock
keys. The typed review is frozen and captures the request/coin/pins before asynchronous approval.
Replacing the caller's request fields or configured port methods during review cannot switch them.
The nonce is retained privately and is never part of the status/review payload.

The existing account `FlowDescriptor` describes owner-circuit operations. This example's private
`DepositReview` deliberately describes an external wallet deposit and journal unlock instead.
It is not a new SDK consent ABI. Unlocking a PRF journal is not wallet spending approval, viewing
permission, ACC owner signing or HD-wallet derivation. Keep the sender wallet's approval separate.

```ts
// All objects below are trusted host composition; retain originalRequest privately across restart.
const operation = reviewedDepositOperations({
  originalRequest, pins, journalKeySource, store, senderPorts, evidence,
  origin: trustedHostOrigin,
  senderLabel: 'Host sender wallet',
  approve: showPrivateDepositReview,
  onStatus: renderAllowlistedOperationStatus,
});
await operation.start();
// Explicit user action after a lost response; same captured request, not a retry/new ID.
await operation.reconcile();
```

No method accepts a replacement request. Restart by reconstructing the controller with the same
private original request, checked pins, protected journal/key origin and durable sender records.
Do not invent new inputs from the public status: it intentionally omits the nonce and sealed entry.
A controller is not the host's durable global request registry or cross-process wallet queue.

## Copy for uncertain outcomes

**Outcome unresolved. Retain this request and original sender records; reconcile the same intent.
Do not resend or allocate a replacement request ID.**

Use this even for a sender exception that says “wallet locked,” “cancelled” or “not allowed” after
the durable dispatch fence. Neither its wording nor an empty lookup proves no send. Display the
original request ID and an allowlisted transaction ID if independently observed. No raw sender
message, cause, stack, journal plaintext, nonce, entry, viewing key or intent digest is published.
Identifiers still correlate operations; apply the host's access/retention policy to the panel.

A successful reconciliation can update the protected journal from dispatching to submitted and
confirmed. It **never invokes the sender**. The wrapper rejects absent/prepared records on every
read and blocks preparation/dispatch transitions and sender calls defensively. This is narrower
than `resumeShieldedDeposit`, whose prepared-state continuation can dispatch. A prepared request
needs separately reviewed host/operator policy; this example has no “force retry” or abandonment.
[#269](https://github.com/input-output-hk/midnight-passport-sdk/issues/269) remains deferred.

A confirmed status returns the original historical receipt, not a current balance or guarantee
that its viewing key is still active. Observer exceptions, including rejected promises, are
contained and do not turn a confirmed deposit into failure or trigger any resend. A later declined
review concerns only that new attempt; preserve earlier outcome evidence.

## Host obligations and limits

Use one controller per original intent. Serialize unrelated operations at the host and isolate
credentials/accounts when composing the PRF source. The controller's in-memory busy flag only
protects overlapping calls to that instance. It does not lock other instances or mutable state
inside a trusted wallet adapter. Methods are captured, but adapters must stay pinned to the
approved wallet/network and must validate transaction intent before signing.

Bound injected I/O. The example wraps the full invocation in the same key source's `withSession`,
keeping PRF material alive through proof/confirmation waits. It adds no cancellation or timeout
API. Cancellation after a dispatch cannot roll back the transfer. Provider prompt counts,
provider isolation and native proof/finality remain separately unqualified.

The byte store needs a dedicated private namespace, real atomic crash-durable CAS and retained
immutable revisions. Use reviewed sender idempotency and canonical finality adapters. An entire
valid old backup can still roll back local evidence; authentication is not anti-rollback fencing.
Neither an idle panel nor absent/prepared journal is proof of no earlier send. Do not discard
unknown requests, replace key origins or reconstruct private intents from logs.

The demo funding button remains unshielded. This example does not expose shielded funding in the
browser demo, relax exact-value shielded withdrawals, qualify full Lace compatibility or change
the immutable ACC binding.

## Verification

After `nix develop -c pnpm run build`, run:

```sh
nix develop -c node --test tests/partner-recipes.test.mjs
```

The suite compiles this example with strict TypeScript against declared public exports, then
runs its emitted JavaScript with real AES-GCM/private filesystem revisions and synthetic sender,
chain, finality and approval UI. It covers denial/throw/non-boolean decisions, mutation and
concurrent approval, locked/cancel-looking sender errors after the fence, unknown and known
transaction outcomes, lost sender response, failed submitted publication, missing/prepared
records, changed private intent and synchronous/asynchronous observer failure. This is source
composition acceptance, not installed registry, native wallet, browser-provider or image acceptance.
