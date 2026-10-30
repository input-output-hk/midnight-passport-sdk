# RC6 current published host slice — #81 / #231

Date: 2026/10/30. Local follow-up on the existing branch after the RC6 release;
no new SDK package/image publication or host modification.

## Review order

1. `scripts/consumer/installed-inputs.mjs`: reuse the same exact installed-byte
   audit for the nine SDK packages and host archive. Preserve the existing tar
   checksum/path/link/size checks and SDK roster; no archive is extracted to disk.
2. `scripts/consumer/host-inputs.mjs`: exact public host name/version, external
   SHA-256 and SHA-512 SRI, both public entry condition files, SDK publication
   receipt hash and all nine package SHA/SRI. A supplied pin still needs independent
   publisher verification; this script never authenticates its own trust root.
3. `scripts/qualify-host-consumer.mjs`: fresh external private roots, exact registry
   dependencies, no hooks/scripts, optional offline frozen-lock replay, retained
   failed setups and independently pinned config. Check all host/SDK bytes and
   physical runtime identities before importing the host and again afterward.
   Receipts bind the harness file hashes; completed outputs cannot be overwritten.
4. `tests/host-consumer-inputs.test.mjs`: mismatched version/SHA/SRI, publication
   set, export path, code overlay, symlink and config-tamper controls. The malicious
   host-code sentinel is never imported. Existing installed-SDK regressions still run.
5. `docs/examples/jubjub-grant-scope.ts` and its unit/public-host probes: scope,
   bookkeeping and decoded inbox require an explicitly supported JubJub scheme.
   Structural assignment does not remove an extra host `granteeScheme` field.
   Legacy omitted schemes retain their JubJub meaning; do not relabel another curve.
6. Both real-host declaration fixtures: explicit hosted-authoriser conversion,
   checked grant mapping, negative direct-authoriser/wider-scope assignments,
   exact generated ACC bytes and current runtime pins. No unsafe casts added.
7. `tests/fixtures/lace-published-runtime.js`: actual public export imports,
   `createRemotePassportSeams` plus installed SDK hosted adapter, thirteen protocol
   cases with a synthetic request transport. Module construction checks endpoints;
   it does not initialize a wallet, execute an account flow or reach a live network.
8. The opt-in `consumer-host-integrity` scenario, engineer/agent instructions and
   final sanitized acceptance receipt. No registry install or WASM build joins the
   30–45 second required CI lane.

## Acceptance and evidence classes

Target: nine published `0.1.0-rc6` packages and public `@laceio/sdk@0.1.2-canary.2`,
experimental and Midnight ESM/CJS entry conditions. Stable `0.1.1` lacks those
entries. The earlier canary0/source/native receipts retain their historical pins.

Fresh actual registry installation and offline frozen replay compare **521 SDK
files and 378 host files**. Public declaration compilation, physical current
Compact/ledger identity, WASM browser build and thirteen synthetic transport cases
pass. Tampering with the actual installed host, SDK, lock, config or host archive
is refused before imports; original bytes were restored. Independent authorised
current-source types/generated ACC checks are recorded privately and do not prove
that private main and a public package carry the same implementation.

The first unadapted declaration runs failed. The corrected fixtures use explicit
consent and grant-scheme adapters; those failures are retained privately, never
turned into successful native/Lace/provider acceptance. The actual canary peer
range warning remains recorded; no ordinary wallet transaction compatibility follows.

The [outer receipt](suite-receipt.json) at clean signed source
`47e1d6976872d15c26db5114a4f35fbfbe6ca1f1` passed in 8,274 ms with the retained
frozen lock. The [inner receipt](consumer-receipt.json) bytes match its stdout hash;
all ten harness hashes match that signed source. [Assessment](assessment.json),
[five actual tamper refusals](tamper-controls.json) and [full local gate](code-gate.json)
record their separate scopes. The full gate passed 1,017 tests with seven existing
conditional skips and zero failures. Source-private receipt hashes permit an
authorised audit without publishing its source pin. All state/input bytes were
restored after the negative controls. Private source pins, raw install logs/locks and source contents stay out of
public Git. Public evidence includes hashes and supported/refused outcomes only.

## Limits retained

No real signer handler/page or provider ceremony, no new native transaction or
full-wallet/module acceptance, no new circuit support, no partial shielded spend,
no altered ACC/runtime/version axes and no widened consent. Broad #81/#231 stay
open; real-provider #232, typed circuits #82, value host #202, partial/change #201,
operator and recovery acceptance remain separate.
