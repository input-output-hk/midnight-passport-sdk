---
layout: default
title: Shielded deposit recovery
permalink: /shielded-deposit-recovery/
---

# Recover the original shielded deposit

**Next source candidate; these recovery exports are absent from published RC6.** This is a
library orchestration boundary over host-supplied storage, wallet and finality ports. It is
not a shielded faucet endpoint or a native qualified sender adapter. The demo funding button
continues to make unshielded deposits. Exact-value shielded withdrawal rules are unchanged.

## Problem and guarantees

Sealing a coin is randomised. Calling a one-shot deposit function again can produce a different
ciphertext, and taking a new initial inbox count can hide the original confirmed entry.
A wallet's request-ID deduplication alone does not fix that reconciliation error.

With `ports.recovery` configured, `depositShielded(request, ports)` records the original account,
network, binding, manifest, coin, encryption key, exact ciphertext and initial inbox-prefix identity
before dispatch. Atomic compare-and-swap selects a single dispatcher. A durable dispatch fence
is written before invoking the sender. All continuations use the original bytes; none re-seals
or automatically re-sends an uncertain dispatch. `resumeShieldedDeposit(request, ports)` requires
that original evidence and refuses missing state before chain, sealer or sender work.

The existing unjournalled call stays source-compatible and **one-shot only**. Do not use it to
retry an uncertain operation. Existing RC6 callers must retain their original sender evidence
and use their host's reconciliation tools; this API cannot reconstruct an older missing journal.
A new journal for a previously used request ID is not a migration or proof of no earlier send.

| Retained phase | Continuation |
| --- | --- |
| `prepared` | Recheck the original key and inbox prefix, win the dispatch CAS, then invoke the sender once. |
| `dispatching` | Read-only sender lookup for the original intent digest and transaction ID. Missing evidence stays unknown; no automatic send. |
| `submitted` | Poll the original ciphertext and canonical successful original-transaction evidence. No second wallet call. |
| `confirmed` | Return the same retained historical receipt without chain, sealer or sender work. |

A process can die after writing the dispatch fence but before calling the wallet. This intentionally
remains unknown unless the host can reconcile it. Do not delete that fence, allocate a new request
ID or steal a sender lock to make progress. Operator no-send/fencing recovery is a separate policy.

## Compose the ports

The host owns the sender wallet's durable journal and shared wallet queue. A deposit journal is
not a distributed wallet lock. Configure `recovery` with:

- `pins`: the actual network ID, binding ID and independently verified compiler manifest hash.
  The chain, sender and finality adapters must all use those same pins.
- `journal`: authenticated, confidential, crash-durable storage with atomic CAS across **all**
  writers. Keep a global request-ID namespace; a changed request or context must not get a new
  independent slot under the same ID.
- `reconcileSender(intent, intentSha256)`: read-only lookup in the original sender's durable
  records. Return `unknown` when unavailable. A submitted outcome binds its transaction ID to
  the exact intent digest. An empty lookup is never permission to replay a send.
- `confirmTransaction({ intent, intentSha256, txId, inboxIndex })`: read-only successful canonical
  finality evidence for that transaction, ACC, binding, circuit, coin and exact entry/index.
  A transaction ID, HTTP 200, current balance or matching coin description alone is insufficient.
  Return boolean `false` for unavailable/stale evidence; no submit/proof/repair side effects.

The sender's `depositShielded` receives the original coin and entry, plus `intentSha256` in
journalled mode. It must retain their association before its effect, reject conflicts, and retain
its own IDs through process restarts. It still owns proof, fees and value input.

For a Node host, the keys package provides `encryptedShieldedDepositJournal(pins, keySource,
byteStore)`. Compose it with `fileMutationByteStore` from the service package in a **dedicated
private directory**, separate from other mutation journals. The existing byte store uses private
immutable revision files, atomic publication and durability acknowledgements. Supply a protected
`PrfKeySource` from the chosen host key origin; `deviceSecret` is not requested by the journal.
Key derivation and consent/session budgets remain the host's responsibility.

```ts
import { depositShielded, resumeShieldedDeposit } from '@input-output-hk/mn-passport-account';
import { encryptedShieldedDepositJournal } from '@input-output-hk/mn-passport-keys';
import { fileMutationByteStore } from '@input-output-hk/mn-passport-service';

// pins, journalKeySource, senderPorts and evidencePorts are the host's checked composition.
const journal = encryptedShieldedDepositJournal(
  pins, journalKeySource, fileMutationByteStore(privateDepositDirectory),
);
const ports = {
  ...senderPorts,
  recovery: { pins, journal, ...evidencePorts },
};
const receipt = await journalKeySource.withSession(() =>
  depositShielded(originalRequest, ports),
);
// Later, after a lost response or restart: same ID/account/coin/pins, retained original journal.
const sameReceipt = await journalKeySource.withSession(() =>
  resumeShieldedDeposit(originalRequest, ports),
);
```

This sketch does not provide a native sender/finality adapter. Never substitute an unconditional
`true` confirmation or a balance-only probe in a production host.

## Bound one approved journal session

The **same `journalKeySource` instance** passed to `encryptedShieldedDepositJournal`
wraps each complete `depositShielded` or same-ID `resumeShieldedDeposit` invocation
above. Nested journal calls then reuse its active operation session. Obtain host
consent for that original account/network/intent first, and keep the value-bearing
wallet's independent signing/approval. An outer PRF session grants neither account
spending authority nor sender assets.

A deterministic regression uses the actual `webauthnPasskey` adapter, actual encrypted
filesystem journal and deposit helper with a software authenticator/fake sender and
finality. Its cold baseline measures **10 PRF credential assertions** without the
outer session and **1** with it. Creation/enrollment contributes a separate signed
assertion; a fresh client may also need credential identification. When PRF outputs
are returned at creation, the first wrapped operation uses **0** additional PRF
assertions. A later independent same-ID continuation requires **1** fresh assertion.
These count API calls, not user-visible prompts or real Google/iCloud behavior.

Success, callback failure, unknown sender outcomes, PRF cancellation, wrong credential
and missing PRF all release the operation session. A later invocation must unlock
again. Read-only reconciliation with no sender evidence stays `dispatching`/unknown,
never a replacement send. The regression also checks zeroed derived journal-key
buffers and protected disk revisions. It does not qualify a native sender/provider.

**Lifetime trade-off:** wrapping the complete invocation keeps PRF material live
through wallet/proof/confirmation waits until the last session user exits. Bound
injected I/O and obtain consent before entering. Do not overlap unrelated operations
on the same WebAuthn source: the current adapter shares overlapping sessions and
this example does not make them account-isolated. It adds no background unlock,
long-lived secret cache, wallet lock or cancellation/timeouts to the deposit API.
Broad session isolation/provider qualification remain #245/#232; operator no-send
fencing remains #269. Do not wrap unrelated ACC operations just to reduce counts.

The [strict composition example](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/shielded-deposit-session/approved-deposit.ts)
constructs the journal and both methods around one captured key-source instance.
It expects reviewed sender, protected storage and finality ports supplied by the host.

## Review and check an uncertain deposit

The [reviewed host example](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/examples/shielded-deposit-review)
adds a typed private review and a redacted operation panel around the candidate APIs. It captures
one original request/coin/pins, requires fresh explicit approval before each journal unlock, and
separates **Start deposit** from **Check original deposit**. A local `status()` snapshot has no
key, network or wallet work. This is an example for trusted host composition, not a new SDK
consent API or shielded browser-demo feature.

Show the trusted host origin, sender wallet, network/binding, destination ACC, request ID, color
and base-unit amount before approval. Explain that the PRF ceremony unlocks a protected journal;
the sender wallet separately approves spending. The nonce and sealed journal intent stay private.
Declining this review performs no new key/sender work and says nothing about an earlier attempt.

Use this copy for any post-fence uncertainty, including a wallet error that appears to describe a
pre-send cancellation or locked wallet:

> Outcome unresolved. Retain this request and original sender records; reconcile the same intent.
> Do not resend or allocate a replacement request ID.

The example's explicit `reconcile()` action cannot call the sender. It refuses absent/prepared
records on every read and blocks dispatch transitions. This is narrower than the general SDK
`resumeShieldedDeposit`, which can dispatch a prepared original request. Unknown lookup stays
unresolved; only original canonical evidence confirms it. The panel retains the original request
and any validated transaction ID, with fixed status codes/copy. Raw error messages, causes,
journal plaintext, nonce, entry and key material never enter it. Status identifiers still need
host access/retention controls. A failed display callback cannot change a confirmed result. After confirmation, the panel keeps
that historical outcome and receipt; `latestAttempt` separately shows a later declined or failed
check. Render both rather than presenting a check failure as loss of the earlier confirmation.

Hosts must supply their own UI, durable original-request registry, pinned sender/finality ports,
credential/account isolation, bounded I/O and wallet queue. The controller's busy flag only
serializes its own calls; it is not a distributed lock or rollback fence. No new-ID retry,
prepared-state override, cancellation/rollback or operator no-send certificate is provided.
The demo funding button remains unshielded; #246's broader owner-circuit consent work and
#269's fenced no-send recovery remain open.

## Confirmation, limits and privacy

Confirmation requires exactly one byte-identical original entry at or after the **original** inbox
boundary, the same preceding inbox prefix, and successful original-transaction evidence. Stale,
duplicate or reordered observations refuse or remain unconfirmed. It does not trust an arbitrary
older ciphertext of the same coin. An initial snapshot is bounded to 65,536 entries and a protected
record to 8 KiB. A host with a larger inbox needs a separately designed/proven evidence adapter.

A rotation before dispatch refuses without re-sealing. A rotation after dispatch preserves the
original entry and can set `viewingKeyChanged`; earlier viewing envelopes may be needed. A cached
confirmed result is the original historical receipt, not a fresh holdings or current-key report.
The remaining key-rotation/on-chain execution race is still the sender/contract adapter's concern.

Admission copies coin bytes into owned Uint8Arrays before asynchronous chain or journal work,
including when a Node caller supplies Buffer inputs. Later caller mutation cannot change the
admitted coin. Same-ID changed account, amount, color, nonce, network or binding refuses before further work.
Confirmation timers and poll counts are bounded, and invalid/regressing clocks refuse. The host
must impose I/O deadlines on injected calls; the library cannot cancel a port that never settles.
All failures retain the original journal and sender IDs. No automatic new-ID retry is provided.

The journal contains protected coin/intent information. Encrypt and authenticate it; never log
or copy its plaintext to browser storage, public receipts, Git or a knowledge vault. Back up all
retained encrypted revisions, their protected key origin, the sender journal and original chain
context. Restore them together; restoring an old/mismatched subset is not a safe replay policy.
Do not place this state in GitHub cache or treat an unknown dispatch as disposable temporary data.

## What is tested

Deterministic fake sender/finality tests use actual randomised sealing, AES-GCM journal encryption,
private filesystem revisions and fresh Node processes. Six process-loss boundaries (five resumed results and one retained unknown) preserve one
sender effect and the same original receipt. Additional tests cover concurrent admission, missing
state, changed identity/context, noncanonical observations, absent finality, rotation and storage
or ciphertext corruption. These tests do not establish native proof, real-provider, published-image
or full Lace acceptance. See issues #261 and #266 for delivery/review state.

### Operator follow-ups

A sender exception, including a pre-send refusal such as a locked wallet, remains `dispatching`
until independently reconciled. Raw sender errors are not reflected into public errors; retain
private sender diagnostics. This version has no fenced no-send/abandon transition. A prepared
intent invalidated by a key rotation also requires operator policy rather than re-sealing.

The inbox bound applies to every observation. Later growth beyond 65,536 entries can leave an
original submitted deposit unconfirmed by this bounded helper; retain its ID and original state.
It is not evidence for a replacement spend. Large-inbox evidence and fenced no-send recovery
need separate qualification. Authentication detects corruption/context mismatch, not rollback
of an entire valid backup. Sender-side durable ID deduplication is mandatory even with this journal.

The operator recovery and rollback-fencing follow-up is [#269](https://github.com/input-output-hk/midnight-passport-sdk/issues/269); it is not implemented by this API.

A missing or malformed post-submission account observation reports `MutationUnsettled`, preserving the submitted record. Reconcile the same request; it is not a pre-send account refusal.

Post-admission sender lookup, finality, journal transition/read, and poll-sleep failures report
safe `MutationUnsettled` errors with `retryable: false`. Private port diagnostics stay in the
host's private records. Reconcile the original ID; these failures never establish a no-send result.
Polling rejects an intermediate clock regression as well as a time before polling began.

Malformed sender lookup replies and non-boolean dispatch-CAS acknowledgements also refuse with
`MutationUnsettled`. Only a literal `true` CAS acknowledgement authorises the sender; a truthy
object is insufficient. The unjournalled one-shot path reports sender uncertainty and later
observation failures as nonretryable `MutationUnsettled`, retaining the original request ID and
any valid transaction ID in the public error. This does not add automatic recovery to that path.

If the sender or read-only lookup returns a valid transaction ID but the submitted-state write
or subsequent observation fails, the safe error also retains that original request/transaction
ID. Preserve it in the host's private reconciliation record. A later empty sender lookup cannot
prove the send did not happen. Durable sender records remain mandatory; a public error is not
a replacement journal and this helper never fabricates a missing submitted revision.

Within an invocation, an observed sender/lookup transaction ID pins all later journal transitions.
A transient submitted-CAS miss retries only the original transition using that known ID, without
requiring a lagging lookup and without another wallet call. A conflicting retained transaction
refuses before finality; the error keeps the first observed ID. Process restarts still require
protected retained state or the original sender's durable records.

Sender transaction IDs are opaque bounded public identifiers (1–256 characters). Alphanumeric
characters and `:._~+/%=-` punctuation are supported, including dotted and base64 forms; invalid
reply text is not exposed as an identifier. Hosts retain original raw sender diagnostics privately.

The confirmation deadline and observation count belong to the invocation's first submitted-state
poll, not each CAS contention round. A lost confirmation acknowledgement cannot reset either
budget. A regressing clock conservatively reports unsettled with the original IDs; it does not
permanently invalidate the request. Reconcile that same ID when the observation source is healthy.
Hosts that need elapsed-time clocks should inject a safe-integer monotonic clock and still bound I/O.
