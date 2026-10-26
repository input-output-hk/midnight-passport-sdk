---
layout: default
title: Recover grant bookkeeping
permalink: /grant-recovery/
---

**Source milestone work for #239; not part of published RC5.** Account control,
published grant bookkeeping and a grantee's private signing key are separate
capabilities. The retained binding is `acc-s3r1.1`.

## What survives losing a local profile?

| Material | Recovery boundary |
| --- | --- |
| ACC address | A known address or directory hint grants no access by itself |
| Device identity and reader | The original selected key origin is still required; this helper cannot replace a lost passkey or PRF output |
| Current ACC viewing context | The reader must open a sealed envelope matching the live ledger key |
| Grant bookkeeping | Published `grant` and `object` records can be reconstructed only by a reader that decrypts them, after checking live commitments |
| Read public key for rotation | Recovered bookkeeping must match the live read-key hash; missing openings never remove active IDs from the roster |
| Full staged grant, issue scope and publication intent | Requires the original protected journal; incomplete publication cannot reconstruct missing parts |
| Private grantee signing/read keys | Remain in the grantee's own key source; never reconstructed by the owner helper |

Grant records are sealed to the **issuing reader**. Another enrolled device can
open the shared ACC viewing context and still be unable to decrypt those records.
It must refuse preserving rotation if a surviving read grant cannot be resealed.

## Compose the recovery path

Use the checked network/binding and the trusted relying-party ID from host
configuration. Do not take the origin from a DApp or inbox field. Authenticate and
approve the selected account/action first; normal key-session policy still applies.

```ts
import { createGrantBookkeepingRecovery, createPassportAccounts }
  from '@input-output-hk/mn-passport-account';
import type { PassportPorts, PrfKeySource }
  from '@input-output-hk/mn-passport-account/ports';
import { createMidnightGrantSource }
  from '@input-output-hk/mn-passport-adapter-midnight-js';
import * as acc from '@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1';

// Invoke only for an already authenticated, approved action.
export async function rotateWithPublishedBookkeeping(
  ports: PassportPorts, selectedReader: PrfKeySource,
  trustedRpId: string, address: string,
) {
  if (!ports.viewingKey) throw new Error('Sealed viewing keys are required');
  const chain = typeof ports.chain === 'function' ? await ports.chain() : ports.chain;
  const commitments = createMidnightGrantSource({
    network: ports.network, binding: acc,
    openings: { readReadPublicKey: async () => undefined },
  });
  const recovery = createGrantBookkeepingRecovery({
    networkId: ports.network.networkId, origin: trustedRpId,
    chain, viewingKey: ports.viewingKey, commitments, pure: acc.pureCircuits,
  });
  const grants = createMidnightGrantSource({
    network: ports.network, binding: acc, openings: recovery,
  });
  return selectedReader.withSession(async () => {
    const api = createPassportAccounts({
      ...ports, chain, readGrants: grants, grants,
      grantCommitments: grants, grantDetails: grants, grantRoster: grants,
    });
    if (!api.openAccountAt) throw new Error('Address opening is unavailable');
    const account = await api.openAccountAt(address);
    if (!account.rotateViewingKey) throw new Error('Rotation is unavailable');
    return account.rotateViewingKey();
  });
}
```

This example uses the existing account API; it adds no crash continuation. An
interrupted owner mutation needs its original protected coordinator intent and
[host outcome source]({{ '/host-durability/' | relative_url }}), composed with the
same recovery-backed targets. Never start a new rotation after an unknown send.

`recover(account, grantId)` returns protected `GrantBookkeeping`, including salt
and object-opening capability material. Do not log it, export it implicitly or put
it in a public receipt. `readReadPublicKey` supplies only the target-source field;
it remains account-linked metadata. Full staged scope and grantee keys are absent.

Successful JubJub creation and directory reopening now save the verified local
account record needed by grant APIs, as known-address opening already does. The
live counter is authoritative; a cached local counter never replaces live checks.

## Refusals and revocation

| Observation | Result / next action |
| --- | --- |
| Complete parts, original reader and matching stable commitments | Recover bookkeeping; later operations recheck the current roster |
| Missing/conflicting parts, another reader, changed snapshot or unauthenticated absent commitment | `GrantBookkeepingUnsettled`; preserve the original journal and inspect the selected reader/publication |
| Inactive individual grant tombstone | `GrantRevoked` |
| Wrong origin, object opening or committed read key | Reconstruction refuses with `GrantScopeInvalid` |
| Missing/wrong read public key from an opening provider | The adapter retains the active ID without a usable key; preserving rotation refuses with `GrantRosterUnsettled` |
| Revoke-all cleared the map | No individual commitment/auth nonce remains; reconstruction reports `GrantBookkeepingUnsettled`, without inventing a tombstone |

Selective read revocation rotates away from the target, preserves other readers
and holdings, then confirms the inactive grant. Revoke-all rotates away from all
grantees, clears the map and confirms the next generation. These are multiple
transactions. Native grant interruption has no automatic continuation contract;
preserve original requests, outputs and receipts for reconciliation. Revocation
cannot erase historical viewing knowledge.

Qualification hands owner-decoded published view seals to independent grantee
read keys. It tests opening the current ledger key, not unaided grantee inbox
discovery or a complete grantee application integration.

## Qualification

```sh
nix develop -c pnpm build
nix develop -c pnpm qualify run grant-recovery \
  --output /private/evidence/grant-generated.json
```

The fast suite executes the generated contract with real software signatures in
both arms, and tests missing/stale/conflicting parts and legacy record reads.
It does not prove transactions or qualify holdings. It runs in normal PR CI.

The native suite creates fresh synthetic accounts, two read grants and a qualified
seven-unit shielded holding per arm, then enrolls a survivor. It reconstructs
bookkeeping in separate empty profiles, refuses independent-reader/missing/wrong
opening attempts before tracked transport/profile writes, rotates, selectively revokes, then revokes all.
Fresh profiles receive no original grant journal; protected files are retained and
hash-checked. See the [live runbook]({{ '/live-qualification/#grant-profile-loss-and-revocation' | relative_url }}).
Only a matching signed-source native receipt establishes this scope. Fast tests
alone do not qualify proofs, real providers, full Lace integration or a release.

The live runbook also provides explicit per-arm suites for targeted qualification.
Keep each receipt's arm, original source and verdict. A completed arm in a later
failed run is not an overall pass; any retained scoped evidence needs a recorded
end fingerprint audit and an explicit component comparison after harness changes.

## Recorded milestone evidence — 2026/10/26

One software-identity native round per arm exercised the scope above. JubJub's five
completed entries are retained at signed source `4a45aa0`, with a separate end
source/reference fingerprint audit; that overall run later **failed** during
P-256 setup. P-256's explicit single-arm suite **passed** at `7483786`. A recorded
comparison verifies that SDK, native worker, shared assertions, compiled runtime
and reference inputs were unchanged across those sources; only allowlisted
harness/tests and documentation changed. There is no same-source both-arm CLI PASS.

Across these two scopes: 44 confirmed host transactions, no duplicate host sends,
34 direct native owner-call attempts, and preserved holdings/remaining readers.
Direct setup transactions are excluded from those counts. The focused generated
suite passed ten tests without skips; the full source gate passed 889 tests with
seven existing conditional skips and zero failures. The
[review record](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/docs/review/grant-recovery)
contains exact source pins, hashes, component comparison and limitations. This
adds source milestone evidence; published RC5 and provider/Lace acceptance are unchanged.


### Review scope of refusal and harness checks

The refusal counter measures attempted chain/transport calls plus fresh-profile
account-record and directory writes. It does not count passkey ceremonies, key
creation or sealing; no claim of zero prompts or zero key-origin work follows.
The injected idempotent-write negative control currently uses the generated
JubJub arm. Both native arms count real writes, but no injected native-write fault
or P-256-specific injected counter fault is qualified by that control.

The newer parent also requires exact grant-case names/results, positive profile
writes and arm-specific rotation/selective/all-revoke circuit inventory. Applying
this validator to retained summaries is an additional read-only check, not a new
native proof run. Removed-reader recheck copies now reject symlinks before and
after copying, before starting workers. Existing receipts keep their old source.

Exact fault-to-error mappings added after historical combined/survivor runs remain
source assertions; the grant runs have no outage faults. Those old live receipts do
not establish the new mapping on every native crash/prover boundary. Additional
current-harness outage runs remain #230/#231/#232 qualification work. The fixture
holding in this scope is deliberately seven units, not a generic arbitrary-value
holding claim. Multi-account profile switching and exhaustive continuation races
also remain outside this grant-recovery acceptance.
