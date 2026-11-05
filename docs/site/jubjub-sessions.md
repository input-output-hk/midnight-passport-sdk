---
layout: default
title: Consented JubJub sessions (source preview)
permalink: /jubjub-sessions/
---

## Status and purpose

This is the **local source increment after RC7**, tracked in
[#281](https://github.com/input-output-hk/midnight-passport-sdk/issues/281).
It is not part of the published `0.1.0-rc7` packages or images. The existing
`acc-s3r1.1` binding already supports the grants used here; no contract or owner
migration is required. Native session proof/node and real-provider acceptance are
still separate qualification gates. Synthetic browser results do not establish
full Lace compatibility.

The demo lets a user explicitly approve a narrow, short-lived spending session.
Authentication alone does not grant spending authority. The account owner must
issue an **on-chain grant** to the session's JubJub public key. Subsequent matching
withdrawals use that key without another passkey access, after a transfer review.

## Try the source demo

Run the usual `nix develop -c pnpm demo up --funding` setup from `AGENTS.md`; reuse
existing private funding files and the pinned contract export. Never run a second
sponsor wallet on an occupied stack. P-256 is the default; `--arm jubjub` also
supports this flow, with fresh PRF unlocks for owner operations.

1. Create/open your ACC, connect the built-in wallet if it is the destination, and
   fund the ACC. Amounts are **smallest units**, not whole NIGHT.
2. In the withdrawal form select an asset and enter the recipient. The session
   uses those exact fields, not the separate manual-grant form.
3. Under **Consented JubJub session**, choose 10, 15 (default), or 30 minutes, a
   per-transfer cap and a total cap. Choose **Authorize JubJub session**.
4. Review permission to use the passkey, then the exact account/network/asset/
   recipient/caps/lifetime. Declining starts no credential access. Approve the PRF
   unlock and the owner signatures needed to issue and publish the grant.
5. Check the active grant ID, absolute expiry, remaining-time heading and spend
   totals. The lifetime starts before key derivation and proving; slow setup
   consumes it. Activity does not extend it.
6. Withdraw within the scope. The exact-transfer dialog identifies the scoped
   JubJub route. It still requires user confirmation but no passkey ceremony.
7. To use the owner path explicitly, uncheck **Use an active matching session for
   withdrawals**. Transfers outside the active grant also display the fresh owner
   passkey route before signing. There is never automatic owner fallback after a
   failed or uncertain session send.
8. **Lock local session** clears the page's key. **Revoke session grant** locks it
   and obtains fresh owner approval to revoke on chain. Renew by revoking the
   previous known grant, then authorizing a fresh session.

Hiding the tab, leaving/reloading the page, explicit lock, a backwards clock or
absolute expiry locks the local signer. Returning to the tab does not unlock it.
Public grant metadata is retained across reloads so it can be revoked; the key and
grant opening are not persisted. A grant may still occupy an active roster slot
after expiry, so revoke it to reclaim that capacity (the binding has 16 slots).

## Authority policy

| Operation | Authorization |
| --- | --- |
| Matching unshielded withdrawal within per-transfer and total caps | Transfer review and session JubJub signature; no credential API access |
| Withdrawal outside scope, exhausted/locked/expired session, or explicit owner route | Transfer review and fresh owner passkey; no reuse of the child key |
| Grant issue, renewal, expansion, revoke, revoke-all or bookkeeping recovery | Existing owner path and fresh passkey/PRF as required |
| Device enrollment/removal, viewing-key rotation | Existing owner path and fresh passkey/PRF as required |
| Independent built-in HD wallet connection/seed derivation | Separate consent and PRF unlock; session key cannot derive it |
| Public state/rosters, funding and connected-wallet balance refresh | No session signature or passkey ceremony |
| Shielded transfer, arbitrary contract call, unrestricted owner action via session | Unsupported; no broad delegation is created |

“Critical” is defined by these routes, rather than by a claim that all transfers
are harmless. Approve only a recipient and caps you are comfortable delegating.
The first implementation has no rolling window, read grant, arbitrary caller,
background agent, automatic renewal or cross-tab key sharing. The demo still uses
the existing owner APIs for its other actions.

## PRF derivation and key ownership

The `keys` package adds `createSessionJubjubAuthoriser(source, pure, context)`.
It uses the existing `PrfKeySource.deriveSecret` port with MIP-0015 domain
`midnight-passport:session-grantee:v1` and JSON-encoded context:

```text
[networkId, bindingId, accountAddress, grantOriginRpId, publicRandomSessionId]
```

The demo pins the PRF ceremony to the open ACC's credential ID. Its source derives
from the existing Lace PRF root through the existing wallet-seed/MIP-0015 recipe,
then clears both PRF outputs, intermediate seed and owner-authoriser PRF bytes.
Only the independent child bytes remain in memory. This neither changes the
existing owner key recipe nor enrolls the child as an owner. Reading a PRF result
or computing its public key does not give it chain authority.

The same passkey and same complete context derive the same child; each session
uses a fresh random **public** 32-byte ID. Thus it is a deterministic per-passkey
key tree, rather than one indefinitely reusable software owner key. A copied key
from an expired/revoked session cannot sign a renewed session's grant. The session
ID is not a recovery secret; the demo deliberately does not restore sessions.
Neither this child nor the ACC viewing secret is the independent HD-wallet seed.

The returned authoriser accepts only the pinned account and
`withdraw_unshielded_with_grant_jubjub`, exposes no key bytes, and checks its
absolute deadline before and after asynchronous key use. `expiresAt` in its
`SessionKeyContext` is **epoch milliseconds**; the grant's `expiresAt` is **epoch
seconds**. Hosts must issue a matching nonzero chain expiry and dispose on lock
and teardown. The helper alone does not issue a grant or enforce a UI policy.
Do not share an unlocked owner key source across unrelated consent contexts.

## Contract checks and local checks

The grant commits the asset and fixed recipient and enforces its permitted
operation, per-call/total caps, active generation, nonce and expiry. The holder
rereads live state before signing and submission and checks its spent opening.
The source increment also rechecks expiry after a slow review/signature, before
calling the transaction transport. The existing exact-value shielded guard is
unchanged; this session flow does not support shielded spending.

The page additionally checks account, network, binding, grantee, origin, exact
scope and expiry against the confirmed grant opening. It has one session
operation at a time, a non-sliding wall deadline plus monotonic elapsed deadline,
and cancellation checks. Local lock cannot cancel a transaction already submitted;
a subsequently confirmed result is still recorded.

Local key disposal is **not on-chain revocation**. A browser exploit can use or
copy a live key within its grant scope. On-chain expiry/revocation bounds that
copied authority, subject to transaction validity and chain time. JavaScript
cannot guarantee erasure of engine temporaries, and this is not hardware-backed
session-key isolation or an independent security audit.

## Interrupted or uncertain operations

A pending issue/spend is checkpointed **before** its transport effect. A lost
response or failed post-issue confirmation locks the key and blocks another
session or owner-fallback withdrawal. Reload retains this uncertainty fence.
Public checkpoints contain only status, account/grant IDs, expiry, asset,
recipient, caps, spent total and an available transaction hash. No PRF, seed,
signing key, session child ID, grant salt/opening or witness is stored there.

Inspect the operation log, original transaction IDs, owner grant roster and
retained owner journal. Use existing operator inspection/reconciliation for the
same intent; a missing acknowledgement never proves no send. The demo has no
one-click operator attestation that clears an uncertain issue/spend. In that
state, use the independent owner controls for investigation and revocation after
reconciliation. **Do not clear site data or delete the checkpoint to retry a send.**
The public checkpoint is a local crash/reload guard, not a tamper-proof distributed
journal; production hosts must compose their durable operation policy.

## Evidence and tests

Run under Nix:

```sh
pnpm run build
node --test tests/keys-session-authoriser.test.mjs tests/account-grant-holder.test.mjs
pnpm --filter passport-dapp exec node --import tsx --test test/session.test.ts test/grant-handoff.test.ts
pnpm test:demo-browser
```

Portable tests cover deterministic domain separation, restricted circuits,
expiry/clock rollback, disposal, scope substitution, account/network/binding,
caps, concurrent operations, late unlock and settlement after lock, unknown
responses and public checkpoint restart behavior. Generated ACC pure circuits
are used for actual key derivation, grant commitments and JubJub signing guards.
Chromium exercises the real controls, PRF-capable software credentials, session
controller and holder signing path with synthetic owner/ledger/funding drivers,
including critical passkey step-up, lock, expiry, reload and no fallback after an
uncertain spend. These tests do not produce or verify a native transaction proof,
move real funds, validate Google/iCloud restore or qualify a partner integration.
