# Enrolled survivor, grants/holdings and wallet reconnect

2026/10/25. Local source qualification for #230/#231/#232/#239. No release or
real-provider acceptance is implied. The immutable binding, artifact manifest and
exact-value shielded withdrawal guard are unchanged.

## Review order

1. `scripts/qualification/identities.mjs` and identity tests: three independently
   generated, privately persisted software identities per crypto arm. Distinct
   credential, signing and reader keys survive serialization. P-256 uses actual
   ES256 signatures with the strict test policy; this is not a passkey provider.
2. `lifecycle-stages.mjs` and boundary tests: enroll the survivor before the target;
   terminate the host after submitting the target's add-device call, then after
   submitting removal's viewing-key switch. Resume original protected operations.
3. `apps/passport-service/qualification/live-worker.ts`: actual live grant map and
   qualified shielded holding, surviving readers and independent grantee, missing
   target entry/current-key refusal, then a real rotation authorized by the survivor.
   Each participant has a separate local account record and encrypted owner journal.
4. `live-outages.mjs` / `live-lifecycle.mjs`: dedicated container ownership checks,
   original plans/bytes, read-only indexer-outage probes, unique send identifiers,
   explicit actor/reader assertions, source/dist/reference/image fingerprints.
5. `wallet-reconnect.mjs`, `wallet-transfer.ts`, `wallet-reconnect.e2e.ts`: the actual
   built-in read-only wallet's socket is disconnected. A distinct standalone payer
   durably records a two-unit NIGHT transfer before its one send while the indexer
   is stopped. Node finality bounds the offline inclusion height; included raw bytes
   confirm the original IDs/hash after restart. The same observer must acquire a
   fresh balance and reopen its socket. Stop/recreate retains the same private seed
   and three public addresses, and closes subscriptions.
6. `apps/passport-dapp/src/wallet/lifecycle.ts` and tests: stopped handles and new
   connections refuse; an asynchronous balance result cannot escape after stop.
   Cleanup runs once even if it rejects. No wallet derivation recipe changes.
7. [Engineer runbook](../../site/live-qualification.md#enrolled-survivor-and-wallet-reconnect)
   and [compatibility boundary](../../compatibility.md).

## Limits to retain

Removal spans multiple transactions. After the key switch and before final entry
removal, the target can still have on-chain signing authority. The suite exercises
an original protected continuation with no concurrent adversarial signer. It does
not establish atomic or complete compromised-identity retirement. Earlier knowledge
cannot be erased. The removed-device negative test checks current access, not the
absence of all historical keys.

The independent survivor uses a preserved private software fixture. Shared trusted
read-public opening bookkeeping permits active-grant delivery; this does not prove
profile-loss reconstruction or recovery of private grantee signing keys. The grantee
is separately generated and must actually open the current secret.

The wallet case executes the demo's actual SDK composition in Node with a synthetic
HD seed, a direct standalone transfer and smallest-unit values. It does not test a
browser/provider ceremony, ACC withdrawal, ordinary-wallet signing through Lace,
provider sync, seed-loss recovery or interrupted constructor/key-origin recovery.
Connection status describes the logical provider session, not network freshness.

## Accepted scoped evidence — 2026/10/25

Signed frozen source `094c7f0` passed one both-arm round: **21 case entries,
88 host-confirmed transactions, zero duplicate host sends**, four actual post-submit
host deaths and four actual indexer-outage probes. Each arm retained its active grant
and seven-unit shielded holding, completed original enrollment/removal continuations,
and proved authorization by the independently enrolled survivor. Removed-identity
known-address opening refused without host changes.

The final actual wallet case added one indexer outage and a separate two-unit NIGHT
transfer finalized during downtime. The same instance acquired the new balance and
reopened its socket; recreation retained addresses/seed/balance, stale handles refused,
and subscriptions closed. Source/dist and reference fingerprints matched at the end.

Pre-freeze full gate: 877 passed, seven existing conditional skips, zero failures.
Jekyll: 19 pages, 372 local links and anchors, zero errors. See [verification.json](verification.json)
for exact source, hashes and scope. Later documentation-only forward changes do not
change any SDK, demo-wallet, live-harness or compiled executable inputs.

A development wallet diagnostic passed after correcting ESM-only dependency loading;
its earlier failed attempt prepared/sent nothing and is retained separately. Private
fixtures, journals, transaction bytes and logs stay outside the repository and Vault.
No remote issue closure, merge or publication occurred in this slice. Broader
#230/#231/#232/#239 and release/provider acceptance remain open.
