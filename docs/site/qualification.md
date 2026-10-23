---
layout: default
title: Qualification and safety boundaries
permalink: /qualification/
---

The next milestone qualifies the SDK's **supported subset**. A passing unit test,
a browser build and a confirmed transaction establish different things. The local
qualification harness records the distinction and refuses to treat missing inputs,
skips or an unimplemented scenario as a passing check.

## Supported entry removal

`account.removeDevice(commitmentHex)` removes **one opaque ACC set entry** after
rotating the sealed viewing and roster keys. It requires a live target, complete
usable survivor registrations, verified holdings and active read-grant targets.
It refuses self-removal, shared/ambiguous reader identities and incomplete inputs.
Both owner arms refuse an active read grant that would return the fresh key to the
excluded reader; revoke or reconcile that separate channel first.

The contract does not maintain a unique identity for each signing key. A direct
contract caller can enroll another entry for the same key at another counter or
epoch. Removing one entry therefore does not certify complete revocation of a
compromised key. Use the demo's **Remove device entry** action only with this
boundary understood. A refused roster is not a request to bypass validation.

Viewing exclusion is independent of signing permission. A removed reader should
not receive the new viewing/roster generation through the supported flow. It can
still know earlier viewing secrets, ciphertext openings and plaintext. A copied
or provider-synced credential is also not automatically an independent trust device.

## Recovery is a separate capability

Opening a known ACC with a surviving enrolled passkey is implemented. Finding the
address does not recreate a lost passkey, PRF output, wallet HD seed or total-loss
recovery secret. Provider restoration depends on that provider restoring the
same credential and PRF behavior; virtual credentials do not qualify that promise.

The retained `acc-s3r1.1` binding comes from source `6458ed5`, with Compact 0.35.0,
Midnight runtime 0.20.0 and compiler manifest
`77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f`.
Its legacy recovery finaliser increments the epoch but does not clear prior set
entries. **Do not use it as a complete compromised-device retirement fallback.**
Total-loss recovery is not exposed by this SDK.

The reference service creates accounts with an unretained birth recovery key,
zero wrap and three-day veto window. That describes the service's create path,
not imported accounts, secure memory erasure or the history of an existing ACC.
Schema version, device count and epoch alone cannot prove which verifier code is
installed. Operators must verify the deployed binding and maintenance authority.

The reviewed correction clears prior entries atomically, but is not registered
as a new SDK binding. Its separate offline comparison does not substitute for
fresh key hashes, proof/node acceptance, verifier-wave sizing or migration consent.
See [ADR 0012](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/adr/0012-retain-binding-with-explicit-removal-and-recovery-limits.md).

## Evidence tiers

| Tier | Establishes | Does not establish |
| --- | --- | --- |
| Source comparison | Exact source pins and compared declaration surface | Runtime semantics, installed verifiers or binary proof compatibility |
| Contract simulator | Executed generated circuits with actual software signatures and controlled clock | Proof creation, node acceptance, finality, browser/provider behavior |
| Unit/port | SDK validation and orchestration against declared fakes | Actual chain effects |
| Virtual browser | Real browser WebAuthn handling with synthetic CDP credentials | Google/iCloud synchronization or recovery |
| Proof/localnet | The declared transaction flow on the configured standalone stack | Other networks or every provider/host |
| Packed consumer | Installation/types/runtime identity of local release tarballs | An actual authenticated registry installation |
| Published consumer | Exact installed registry/image bytes and compatible runtime | Every product use case |
| Manual provider | Recorded provider/browser/version/device ceremony | Any provider or version not actually tested |

The foundation's contract tests deliberately confirm known legacy limitations.
A green result means **the asserted boundary was observed**, not that full
revocation or recovery is safe. RC5 published evidence remains separate from
historical `0.1.0-dev.12` consumer/browser evidence.

## Run the harness locally

Use a checkout with dependencies installed and SDK packages built:

```sh
nix develop -c pnpm install --frozen-lockfile
nix develop -c pnpm run build
nix develop -c pnpm qualify list
nix develop -c pnpm qualify plan foundation
PASSPORT_REPO=/path/to/passport nix develop -c pnpm qualify run foundation \
  --output /private/evidence/foundation-1.json
```

`PASSPORT_REPO` is read-only. It must contain the exact pinned/reviewed source
objects named by the audit. No checkout switch or upstream write is performed.
For three clean executions of the same scope and source:

```sh
# Run foundation twice more to new output paths, then:
nix develop -c pnpm qualify repeat /private/evidence/foundation-1.json \
  /private/evidence/foundation-2.json /private/evidence/foundation-3.json
```

The repeat check rejects reused run IDs, different source bytes, different suites,
skips and incomplete outcomes. It qualifies repeatability only for that suite.
It always reports `releaseQualified: false` in this foundation.

Available suites include `foundation`, `browser`, `localnet`, `outages`, `consumer` and `release`.
The opt-in [live restart suite]({{ "/live-qualification/" | relative_url }}) uses a
dedicated stack, original protected intents and actual proofs. Its scope and
real-provider matrix remain separate from the complete release gate.
`plan` shows required environment **names**, not their values. The localnet suite
requires explicit standalone consent (`PASSPORT_RC_LOCALNET=1`,
`MN_NETWORK_ID=undeployed`), existing loopback services and the funding token file.
It creates a disposable synthetic ACC and transfers ten NIGHT **base units** with
same-ID funding replay. It does not reset a chain, stop an existing service or
create a second funding request to work around an uncertain one.

The browser suite expects a healthy demo and runs the existing virtual-authenticator
preflight. Full browser and real-provider acceptance remain opt-in/separate. The
consumer suite requires existing packed tarballs and `RELEASE_VERSION`; it does
not publish packages. The broader release suite includes explicit unavailable
outage, actual-registry and manual-provider gates and cannot pass as a completed
release suite in this slice.

## Receipt and resource rules

Receipts pin the source commit, dirty state, complete current workspace fingerprint,
actual shipped module hash, binding and compiler manifest. Each declared scenario
retains its evidence tier and outcome. Missing cases or relabelled tiers are rejected.
Only aggregate counters, bounded output digests and fixed error codes are exported;
raw child output, free-form errors and arbitrary metadata are not copied into receipts.

A new evidence path is mandatory. An exclusive `.lock` prevents overlapping runs
and remains after a crash for reconciliation. Inspect the lock and any child
funding journal before retrying; preserve an uncertain request ID. Timeouts stop
only the subprocess group created for that scenario. Output volume is bounded.
No human passkeys, wallet seeds, proof witnesses or bearer tokens belong in the
receipt, GitHub cache or public handover.

Every PR still runs the normal lint/format/build/test/type gate. New simulator and
negative harness tests are part of that fast gate. Full key generation and real
proof/browser qualification remain on their own resource/time budgets. Hosted
30–45-second warm-job timing must be measured after a permitted push.

## Next acceptance gates

- #230: the local opt-in durable owner API has simulator/process tests; complete hosted/proof interruption qualification remains open.
- #231: complete disposable proof/browser/outage suite and repeated evidence.
- #232: actual provider and two-browser ceremonies.
- #235: broader key-profile/consumer coverage.
- #236: automated actual-registry/image/docs acceptance.
- #240: qualified total-loss recovery on a suitable binding.

The [first-slice review map](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/review/stability-foundation/README.md)
links exact implementation/evidence boundaries and the issue acceptance index.

### Interrupted entry removal and unanchored history

Both arms authenticate a removal target only from the current ledger-matching roster.
The historical-registration port is removed: earlier readable envelopes may carry
sender-chosen secrets and cannot prove an earlier on-chain key generation.

Removal retains the target's registration under the fresh roster key but sends the
new viewing key only to survivors. A retry after the key switch can therefore resolve
the target from authenticated **current** metadata and still refuse a read grant to
that reader. After removal the registration matches no live entry and is ignored.
Older interrupted accounts lacking that retained metadata still refuse and need
operator reconciliation. Missing/ambiguous targets never fall back to earlier secrets.
Original protected owner journals are a separate host capability in the next stack slice.

## Current consumer assessment

Follow the [consumer integration guide]({{ "/consumer-integration/" | relative_url }})
for actual registry entrypoints, source pins, runtime identity and opt-in protocol
diagnostics. `consumer-source` and `consumer-published` are distinct suites; neither
turns an installed package into a full hosted-wallet compatibility claim.

## Local durability milestone

The opt-in owner continuation API and authenticated published-grant reconstruction
are described in [Mutation durability and grant recovery]({{ '/durability/' | relative_url }}).
These additions are local, unreleased work. Default demo owner buttons still need
transaction reconciliation after interruption; a journal alone does not supply
durable remote submissions. Another enrolled reader cannot invent the issuing
reader's grant opening.

### Runtime identity and repeated receipts

Build through Nix before running a suite. The workspace identity includes tracked and
untracked source **and ignored `packages/*/dist` inputs** actually imported by tests.
Compiled symlinks are refused. Older receipts that hash only source keep that narrower
scope and are not upgraded to new-source acceptance.

`qualify repeat` checks three distinct passing receipts with matching source/runtime,
binding and scope in chronological order. These local receipts are unsigned; the tool
cannot detect omitted intervening runs. Operators must retain the entire run sequence
when asserting consecutiveness. `omittedRunsAudited: false` makes that boundary explicit.
Keep outputs outside the tracked tree (or in a private ignored directory), since output
locks/evidence appearing inside source inputs correctly invalidate a source-stability check.

The generic repeat checker binds workspace source, compiled package inputs, binding
and scenario scope. External tarballs, authorized source checkouts, installed host
roots and environment choices need their scenario-specific receipts checked separately;
three outer receipts alone do not establish identical external inputs. Full release
consumer/provider acceptance remains an independent gate.
