# Credential policy: source audit and regression map

## Status and policy

This document accompanies the local credential-policy candidate built on
`c343a4de305a7688dbb4c8ae0c8e7e6c08ca0131`. That SHA is the **base**, not a claim
that the dirty candidate, tests or documentation are a signed release. Final
validation receipts must name the exact executed source. No new published package,
provider or native-proof acceptance is asserted here.

The latest user policy is: **use the passkey for login and critical operations;
reuse approved material for routine work**. It supersedes the earlier local policy
that allowed all owner operations without another credential request after owner
unlock. A full JubJub owner still has full on-chain authority; the new restriction
is implemented by the demo host. Exact transaction consent remains separate from
key access. No derivation label, ACC circuit profile or funding limit changes.

### Authority boundaries

- Verified login may adopt a reviewed 10/15/30-minute routine memory lease. It keeps
  derived wallet seed and reader material, not raw PRF outputs or an owner key.
- Explicit **Unlock account** can retain a full-owner signer in a separate memory
  lease. Each critical operation still needs fresh pinned PRF approval, matching
  both owner and reader to that captured lease. Fresh approval does not renew it.
- A separately approved scoped grant has its own recipient/asset/cap/expiry. Its
  matching transfer can require zero credential calls, with no owner fallback.
- Wallet connection and extension permission are separate from ACC authority.
  The ordinary HD seed is not the random ACC viewing secret or owner PRF.
- Local lock does not revoke a chain owner/grant or disconnect a running wallet.
  A copied full-owner scalar bypasses this host's credential policy on-chain.

## Audit ledger

“Requests” below means browser credential API accesses. It is not a measured count
of provider sheets, biometric touches or user reviews. Counts assume no profile
retry, completed setup and matching context unless the row says otherwise.

| Path | Intended request behavior / preservation | Source anchors and regression evidence |
| --- | --- | --- |
| Credential registration | Create plus strict P-256 compatibility probe. Missing PRF/cancellation refuses before deployment when detected there. Do not fold PRF into strict `wa-json134` signing material. | `packages/adapter-webauthn/src/adapter.ts`; existing WebAuthn profile/PRF suites |
| P-256 ACC creation | One post-registration PRF scope through setup; reuse both create-time results, otherwise one fallback PRF request. Actual activation/publication rules and two sealed-publication signatures stay intact. | `packages/account/src/p256-creation.ts`; `tests/p256-credential-scope.test.mjs` |
| JubJub ACC creation | Existing signing/PRF semantics retained. Shared registration still runs the P-256 probe; no claim of parity with upstream creation counts. | `packages/account/src/jubjub-connector.ts`; provider/creation-path redesign deferred |
| Active P-256 login | One discoverable `identify-and-unlock` assertion supplies PRF and the actual ES256 ownership proof; live entry and sealed reader checks remain. | `packages/account/src/with-login-session.ts`, WebAuthn `sessions.ts`; `tests/adapter-login-session.test.mjs` |
| Active JubJub login | One discoverable PRF assertion, matched to live PRF-derived owner and sealed reader. Challenge/RP/origin/UV are checked; no independent ES256 verification is claimed without an enrolled P-256 key. | `jubjub-connector.ts`; actual-core adapter-login regressions |
| Cold P-256 known-address recovery | First open on a fresh adapter works without a preloaded public key. Authenticate the sealed registration/public key/policy and same identify proof; reject missing/ambiguous registration, wrong proof or removed owner without another ceremony. | `packages/account/src/p256-address-open.ts`; cold-FIRST cases in `tests/p256-credential-scope.test.mjs` |
| Verified login → routine lease | Optional post-verification hook runs within the login PRF scope. Wallet-seed-only handoff adds zero requests. Demo adopts a reviewed lifetime; other hosts opt in. Failed/stale/hidden/expired adoption is locked. | `ports/index.ts`, `with-login-session.ts`, `adapter-browser/src/compose.ts`; `tests/login-key-handoff.test.mjs`, `apps/passport-dapp/test/login-routine-adoption.test.ts` |
| Public ACC state/balances/device/grant rosters | Zero Passport credential calls; these reads do not prove private reader or spend authority. | Account read APIs; authenticated-operation-hook public-read regressions; isolated Chromium journeys |
| Private holdings | Zero with the matching approved routine reader; still verify live account, encryption key and chain-backed coins. After lock/expiry, explicitly approved holdings can make one pinned reauthentication and prepare a new routine lease for following actions. Pin its lifetime before consent; never silently replace an already reviewed lease that expires while consent is open. | `routineViewingKey`, `apps/passport-dapp/src/routine-reader.ts`; routine adoption/reader and account holdings suites |
| Built-in wallet connect / refresh | Connect uses the matching routine seed with zero requests, or one explicitly consented pinned PRF request that also warms a new routine lease after lock/expiry. Refresh uses the connected wallet with zero Passport requests. A wallet remains a separate component with its own lifetime. | `apps/passport-dapp/src/wallet/seed.ts`, routine access; wallet seed/lifecycle and browser journeys |
| Wallet without open ACC | One discoverable PRF request selects that wallet and derives its seed. No fallback seed, owner identity substitution or automatic routine lease. | `discoverPasskeySeed`, wallet seed tests |
| Joining-device preparation / enrollment | A new joining credential still requires its own registration/probe/PRF path. Owner enrollment is a distinct critical operation with exact fingerprint/reader review; no identity substitution or automatic enrollment. | Existing joining-device handoff validation, owner enrollment and browser two-context suites |
| Independent grant holder | One discoverable login/PRF scope; derive and verify the selected holder against the exact grant before spend. No mixing with the ACC owner's identity or implicit lease adoption. | `apps/passport-dapp/src/grant-holder-demo.ts`; grant-holder and browser journey cases |
| Sponsor funding / external Lace connect | Zero Passport credential calls. Funding token/policy and external-wallet consent remain independent. Neither produces an ACC owner key. | Funding and external-wallet adapters; their existing policy/refusal suites |
| Critical primary-owner operation | Existing fresh PRF/signature path. P-256 must sign each real circuit challenge; a multi-transaction mutation can require multiple requests. | Primary browser composition and strict authoriser; existing both-arm account tests |
| Critical cached full-owner operation | One fresh pinned PRF approval per reviewed logical operation, deriving the same owner and reader. Internal method calls share only that operation's approval; action/method mapping rejects an unrelated critical method. Decline, context/reader/key mismatch or lease loss refuses before effects; no extension or fallback. | `apps/passport-dapp/src/credential-policy.ts`, `critical-approval.ts`, `routine-access.ts`; `critical-approval.test.ts` |
| Async critical review arguments | Capture admitted public inputs before awaiting approval; preserve exact recipient/amount/device/grant, selected route and lease. Recheck before new dispatch; retain already-dispatched acknowledgements. | `packages/account/src/authorization.ts`; `tests/authenticated-operation-hook.test.mjs` |
| Sensitive opening export / recovery-publication | Critical even if shown near read-only tools. Fresh approval precedes secret opening access or publication work; opening export is admitted only for its export/transfer-permission action, sharing that operation's approval memo. Multi-call bookkeeping belongs to the same reviewed operation. Public roster reads remain free. | `apps/passport-dapp/src/grant-opening.ts`, critical action policy and grant flow wiring |
| Separately approved scoped grant transfer | Zero additional calls only within exact asset/recipient/caps/expiry; keep exact transfer review and no automatic owner route. Local disposal is not revocation. | Session controller, grant guard and existing portable/browser/native source receipts at their original pins |
| Encrypted journal and durable credentials | Preserve original journal key origin, IDs, mutation uncertainty and optional login scope, including prototype/receiver-bound methods. Legacy ports gain no fictitious capability. | `packages/account/src/durable-credentials.ts`; `tests/durable-credential-session.test.mjs` and durable mutation tests |
| Profile retry / overlap / cancellation | Each actual retry gets separate approval. No rewriting signed bytes or implicit fallback after PRF refusal. Login/create overlap is refused in both directions; outputs and late handoff access are disposed. | WebAuthn adapter/session and login-key-handoff overlap tests; synthetic consent journeys |
| Hosted/remote signer | Host/agent approval and key ports remain separate authorization surfaces. No inference that a browser login approves hosted signing, and unsupported operations remain refused. | Existing remote adapter consent and refusal suites; not a newly qualified transport in this slice |

## Why the SDK fixes are necessary

### Address-first recovery

A browser adapter loses its in-memory public-key map after reload. The old P-256
address-opening path asked for a selected device public key before establishing it
from the authenticated registration. An earlier directory-based open could seed
that map and hide the defect. The regression deliberately calls `openAccountAt`
**first** with a fresh adapter, then tests wrong/removed/ambiguous cases. Recovering
authenticated public metadata does not replace a lost passkey or its PRF output.

### Shared creation PRF scope

P-256 creation previously released its derivation session before sequential sealed
publication checks. A new outer setup scope preserves the same PRF outputs through
those checks, while keeping the compatibility probe and each actual signature.
The adapter clears held outputs at session completion; later access asks again.
Pure-JubJub creation is not silently changed into a new registration profile.

This changes the durable **source-program transcript** for creation. An older
continuation can safely refuse a mismatched `consent.flow` sequence. Do not rewrite
historical transcripts/journals or retry an uncertain deployment to force replay.
Operator-guided compatibility/migration remains separate from this optimization.

### Verified routine handoff

The core optional `PassportPorts.onAccountOpened(account)` runs only after
successful verified `openAccount`/`openAccountAt`, before the optional credential
scope exits. Browser composition provides
`BrowserPassportConfig.onAccountOpened(account, keys)`, where `BrowserLoginKeys`
exposes only `deriveWalletSeed(): Uint8Array`. Retained accessors refuse after the
scope ends. Creation and failed verification never invoke this hook. Hook failure
rejects opening and disposes the login scope.

The host owns returned seed copies and their cleanup. The demo captures its
account/network/binding/credential, page revision and approved absolute lifetime;
late/failed adoption cannot restore a locked or replaced lease. There is no SDK
process-global auto-cache, hidden companion enrollment or implicit wallet connection.

### Critical approval is host policy

The reusable full-owner factory remains a software signer. The demo's
`routeAuthenticatedAccount` hook captures arguments before async fresh approval,
then rechecks context, route and lease. The demo guard compares fresh PRF-derived
owner and reader to the captured owner session. It never renews that session and
deduplicates only within one reviewed logical operation. An action/method mapping
rejects an unrelated critical method even if fresh approval already succeeded.
Opening export is admitted only for export/transfer-permission actions and shares
that same operation approval memo. Direct consumers of the low-level full-owner
primitive must implement their own equivalent policy.

Exact-value shielded withdrawal checks, unknown-effect fences and preservation of
post-dispatch receipts remain. Neither this policy nor the owner cache enables
partial shielded spending or full Lace interoperability.

## Validation and evidence boundaries

Focused source checks can be rerun after installing locked dependencies:

```sh
nix develop -c pnpm exec tsc -b tsconfig.build.json
nix develop -c pnpm exec tsc -p tsconfig.json
nix develop -c node --test tests/p256-credential-scope.test.mjs tests/login-key-handoff.test.mjs tests/durable-credential-session.test.mjs tests/authenticated-operation-hook.test.mjs
nix develop -c pnpm test:demo-browser
```

Run application unit tests with `nix develop -c pnpm --filter passport-dapp test`;
the new files are `apps/passport-dapp/test/critical-approval.test.ts` and
`login-routine-adoption.test.ts`. The release/full gate must record final commands,
source pins and receipts separately. Counts are deliberately not asserted here.
Software-authenticator/fake-ledger tests use actual SDK verification and derivation;
Chromium UI journeys have synthetic account/chain/wallet drivers. Neither proves
native proof acceptance, genuine provider UX or synchronized passkey recovery.

### Deferred qualification and bounded follow-ups

1. Measure actual Google/iCloud/native-browser behavior, including restored
   credentials and both PRF outputs. API-call counts do not predict provider UI.
2. Requalify the current combined browser/critical policy with native proofs at an
   exact source pin; earlier native receipts stay immutable at their original pins.
3. Design a pure-JubJub credential creation path before removing its shared P-256
   probe. Do not relax the strict P-256 enrollment/signing profile globally.
4. Qualify encrypted-journal and multi-stage grant scope coalescing independently.
   Distinct operation scopes may need additional PRF access outside the demo's
   captured fresh-owner operation. Never remove consent or change journal key origin
   merely to hit a prompt count.
5. Stronger concurrent cross-operation key-session isolation remains #245.
   One adapter's nested PRF scope is not authority isolation for unrelated callers.
6. Older durable creation transcripts need an explicit compatibility decision if
   resumed across this source change. Safe refusal is preferable to rewriting
   historical evidence or automatically replaying an unknown effect.

This ledger reviews the credential request families and the listed fixes. It is
not a claim that every line, circuit, browser provider, race or interoperation is
proven. Preserve original receipts, pending enrollments, journals and unknown IDs.


## Local candidate verification — 2026-11-07

The frozen candidate passed the full Nix gate: **1,532 tests passed, 7 existing
skips, zero failures**, plus lint, formatting, package build and all three app
type checks. AST budgets remained unchanged across 231 authored source files.
All nine package coverage floors passed across 146 executable authored sources:
**93.62% lines, 92.41% functions and 84.91% branches** globally.

**188 Chromium journeys passed** across P-256/JubJub with stable runtime inputs.
They cover login → holdings → wallet without another request, locked routine
reauthentication followed by reuse, reviewed lifetime pinning, critical-action
approval/decline and receipt preservation after expiry. The runner closed all its
owned resources. Actual Chromium virtual-authenticator smoke separately checked
one login assertion, scoped seed handoff, later fresh key reproduction, independent
one-request wallet discovery and missing-PRF refusal without fallback.

These receipts describe the dirty candidate based on the base SHA above; the
signed commit and independent exact-head review are recorded separately in the
Obsidian evidence packet. Neither the browser driver nor the virtual authenticator
qualifies native proofs, genuine provider UX or synchronized credential recovery.
The running demo, user account data and unrelated stacks were preserved.
