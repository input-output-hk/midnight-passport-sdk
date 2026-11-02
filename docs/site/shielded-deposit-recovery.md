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
const receipt = await depositShielded(originalRequest, ports);
// Later, after a lost response or restart: same ID/account/coin/pins, retained original journal.
const sameReceipt = await resumeShieldedDeposit(originalRequest, ports);
```

This sketch does not provide a native sender/finality adapter. Never substitute an unconditional
`true` confirmation or a balance-only probe in a production host.

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

Same-ID changed account, amount, color, nonce, network or binding refuses before further work.
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

The inbox bound applies to every observation. Later growth beyond65,536 entries can leave an
original submitted deposit unconfirmed by this bounded helper; retain its ID and original state.
It is not evidence for a replacement spend. Large-inbox evidence and fenced no-send recovery
need separate qualification. Authentication detects corruption/context mismatch, not rollback
of an entire valid backup. Sender-side durable ID deduplication is mandatory even with this journal.

The operator recovery and rollback-fencing follow-up is [#269](https://github.com/input-output-hk/midnight-passport-sdk/issues/269); it is not implemented by this API.

A missing or malformed post-submission account observation reports `MutationUnsettled`, preserving the submitted record. Reconcile the same request; it is not a pre-send account refusal.
