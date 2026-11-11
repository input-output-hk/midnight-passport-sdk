---
layout: default
title: Use-case coverage and release evidence
permalink: /use-case-coverage/
---

Local source after RC7 adds mock name-resolution coverage: the SDK's read-only
port/resolver has scope, shape, expiry, absence/failure and redaction tests. The
Chromium demo lane checks lookup, missing/invalid input, no credential access and
unchanged transfer recipient. These synthetic fixtures do not qualify a live
name provider, registration, name ownership or account deployment. See
[naming adapters]({{ '/names/' | relative_url }}).

The source [workspace/Activity increment]({{ '/demo-ui/' | relative_url }}) adds
real navigation through the existing journeys, desktop collapse/Audit links,
mobile sheet focus/Escape, separate mobile passkey consent, public Audit export,
unknown-ID retention during navigation, active-spend navigation and independent
white-label renderer cleanup. These remain synthetic connector/credential tests;
they do not widen native or real-provider acceptance.

## Passport conformance for named shielded receive

The standalone source fixture uses Midnames 2.1.0 on `undeployed` and the
`acc-s3r1.1` binding. Run it from the
[named deposit recipe](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/examples/midnames-local).
The owner receipt requires exact successful original-transaction evidence and
a decrypted coin matched to a current on-chain holding.

| Passport requirement | Evidence | Scope |
| --- | --- | --- |
| P2 I-2.2/I-2.3 · authoritative on-chain name | The pinned registry resolves its unique name path to the operation-specific ACC contract target. The sender verifies the activated ACC and resolves again after proof and balance. The source tests cover absence, wrong network, non-contract and incompatible targets, repoints, and provider outage. | Local `.night` fixture. Public `passport.night` has separate network and registry requirements. |
| P6 · secrets stay with their holder | A separate process reopens the synthetic genesis wallet used by setup. Its payment authority is independent of the recipient ACC. The owner alone decrypts the receipt and verifies the commitment. | Synthetic local owner and sender. |
| P8 · substitutable providers | The fixture uses a self-hosted indexer and proof server and reads authoritative state from the chain. A failed read stops the send. | One pinned local profile was tested. Cross-provider substitution and a public provider remain unqualified. |

The [refusal tests](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-dapp/test/midnames-deposit.test.ts)
exercise failures before broadcast and unknown outcomes after dispatch. The
example covers wallet-to-ACC receive. The named NIGHT payment below uses a
separate owner-authorized withdrawal and recipient deposit.

## Passport conformance for a named NIGHT payment

| Requirement | Evidence and boundary |
| --- | --- |
| P2 and MIP-0007 routing | The standalone registry record had a different profile default. The payer selected the verified ACC contract target, recorded the provider and full destination, and re-resolved before signing and before each dispatch. Automated tests refuse changed names, non-contract targets, and unsupported assets before the relevant step. |
| P6 owner authorization | The synthetic device signs the source ACC's withdrawal challenge locally. It binds the NIGHT asset, amount and bridge user address. The durable review binds the name and target ACC to the permissionless deposit. The deployed withdrawal signature format does not include the name, registry or final ACC. |
| P8 provider boundary | The isolated run uses a self-hosted prover, node and indexer. Alternative providers, browser credentials, and online registry profiles require separate evidence. |
| Two-leg recovery | The source balance changed from 10 to 6 smallest NIGHT units while the target remained at zero. The reopened journal used the original withdrawal output to finish the deposit. The target then showed 4 and the source stayed at 6. Unknown dispatches stay fenced for original-ID reconciliation. |

The [standalone recipe](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/examples/midnames-local)
covers the source-only NIGHT route. Shielded ACC-to-ACC sending remains outside
this qualification.

### Naming acceptance for #247

The typed resolver and the standalone `.night` registry demonstrate
operation-specific on-chain target lookup, supported-binding verification and
separate account authorization. The claim, shielded receive and NIGHT payment
fixtures cover those boundaries on `undeployed`. Production namespace and
registrar policy, public registry substitution, binding transfers, and a
native real-credential name-to-open flow still require separate evidence.

Both payment paths were rerun on merged source `22ae4594` against fresh isolated
chains. The shielded deposit finalized at block 68. The NIGHT withdrawal and
deposit finalized at blocks 94 and 97, and the deposit consumed the exact
withdrawal output after reopening the journal. The browser's standalone claim
availability check is a read-only preflight. Browser-initiated proof and sponsor
submission are separate from the existing lost-response recovery evidence.

## Current published release and evidence tiers

The published preview is **0.1.0-rc9**. Its
[release record]({{ '/release-notes-rc9/' | relative_url }}) describes the
installed packages, mounted images and native source evidence. The
application→ACC merchant recipe retains its own pinned local native receipt.
Named shielded receive was qualified on later local source.

## Supported evaluation use cases

| Use case | Public API / demo | Automated success and corner cases | Evidence boundary |
| --- | --- | --- | --- |
| Create and reopen an ACC | `createPassportAccounts`; Create/Open/Open by ACC address | SDK tests: pins, missing PRF, wrong credentials, interrupted publication. Browser: decline before credentials, permanent-retirement acknowledgement, create/reload/reopen/address | Browser lane uses a synthetic account API. Separate full virtual-authenticator and source-native lanes establish their declared real integration scope |
| Inspect public state and rosters | `state`, `deviceRoster`, `grantRoster`; refresh/read buttons | API parsing/snapshot tests; actual UI updates without ceremony | Public reads do not establish private reader or spend authority |
| View chain-matched shielded holdings | `readShieldedHoldings`; Read shielded holdings | Opening/commitment/refusal tests, both-arm populated native receipts; browser renders synthetic matched coins after viewing review | No shielded deposit/withdrawal button or arbitrary coin/change support |
| Fund and withdraw localnet NIGHT | `remoteFaucet`, `withdrawUnshielded`; Fund/Withdraw/Refresh wallet balance | Policy/request-ID/value-route tests; browser ten→one→nine, invalid recipient, replayed funding ID, unknown result and service outage | Browser balances are synthetic. Funding/native receipts separately qualify only declared standalone assets and exact source/image boundaries |
| Rotate viewing keys | `rotateViewingKey`; Rotate sealed viewing key | Incomplete/stale readers and grants refuse; native populated lifecycle; browser viewing review before preparation, exact review, result and later reopen | Multiple transactions are not atomic. Unknown effects need reconciliation; one entry removal is not complete compromised-key revocation |
| Enroll/remove an entry | `addDevice`, `removeDevice`; public handoff and owner controls | Handoff validation and fingerprint, survivor/refusal SDK/native tests; browser independent contexts, malformed handoff, enroll/open/remove | Synthetic browser connector does not enforce real on-chain membership. Native receipts cover actual supported reader delivery separately |
| Issue/use/revoke/recover grants | `issueGrant`, `spendUnshieldedWithGrant`, `revokeGrant`, bookkeeping recovery; grant controls | SDK caps, expiry, wrong holder, state changes, openings and revocation; browser prepare/issue/export/spend/revoke/refuse/recover | Browser holder settlement is simulated. Recovery cannot invent an unpublished opening or a lost grantee key |
| Connect the separate HD wallet | WebAuthn `passkeySeed`, wallet SDK host; Connect/Refresh wallet | Credential pinning and seed-policy tests; browser actual mock PRF plus simulated wallet balances; independent native wallet reconnect/credit evidence | Refresh needs no new passkey. Provider restoration of the same credential/PRF is unqualified here |
| Plan operation proving requirements | `contract/capabilities`, `account/preflight`; SDK capabilities panel | Catalog drift, tamper, exact method/profile tests; browser operation/read-grant changes with no credential or driver calls | Advisory metadata only: no claim of host/key-endpoint readiness, ownership, available funds or proof success |
| Compose an application→ACC payment | `mn-passport-export-compact`, merchant client example; engineer recipe link | Installed/compiler/offline checks; native positive payment and seven construction refusals | JubJub unshielded caller-pinned scope only; no browser merchant button, arbitrary contract acceptance or production privacy claim |
| Review/resume a shielded deposit | `depositShielded`, protected journal and reviewed host example | Real encryption/filesystem revisions, captured original inputs, refusal, unknown and reconciliation tests | Host recipe, not a demo funding endpoint. Synthetic sender/finality tests do not establish native submission acceptance |
| Deposit a shielded asset by name | Standalone Node sender using the real Midnames adapter and `deposit_shielded` | Native `undeployed` receipt: one finalized 10-unit test-token deposit to `alice.night`, with owner decryption and verified holding. Automated pre-dispatch refusal and unknown-outcome tests. | Source-only wallet-to-ACC receive on the standalone `.night` profile. |
| Send NIGHT between named Passport ACCs | Standalone Node fixture using JubJub withdrawal and `deposit_unshielded` | Native `undeployed` payment interrupted after withdrawal. The reopened journal spent its exact output and confirmed 10→6 on the source, 0→4 on the target, with one dispatch per leg. Tests cover repoints, insufficient funds, invalid routes and retained receipts. | Source-only NIGHT route. Browser passkeys and online profiles require separate qualification. |

These are mapped tests, not exhaustive coverage of every parameter, circuit,
interleaving or provider. The 52 proof/66 pure circuit inventory does not imply
52 fully supported typed/browser workflows.

The current-source single-request login has separate actual-core regressions:
P-256 ES256 verification, unchanged Lace PRF vectors and sealed readers reopen
active P-256/JubJub accounts (including address recovery) with one credential call
against a fake ledger. Tests also cover signed extra JSON/extension data,
wrong-key/policy refusal, absent PRF, cancellation, no fallback, overlap refusal
and output disposal. JubJub negatives distinguish its PRF-derived live owner and
sealed-reader checks from P-256 signature verification, for which JubJub has no
enrolled key. Browser journeys check combined-purpose consent and one-call
login through their synthetic account driver. These are not real-provider or
native-proof qualification. Login neither enrolls nor unlocks a companion owner.

## Run deterministic browser journeys

With locked dependencies, Chrome and built SDK packages:

```sh
nix develop -c pnpm run build
nix develop -c pnpm test:demo-browser
```

No running demo, Docker, sponsor wallet or provider credential is needed. The
runner owns a Vite server on an ephemeral loopback port and fresh Chromium
contexts. Browser requests to the passkey origin `http://localhost:5173` are routed
to that private server; they never contact or alter an existing demo on that port.
All service requests are intercepted. Unexpected network access fails the test.

The actual DOM/actions, development mock credential API, ceremony hooks, handoff
validation and public proof-plan APIs run. Account orchestration, chain enforcement,
funding, grant settlement and wallet balances are explicitly synthetic. Both selected
owner arms run the same journeys; this does not qualify either real proof arm.
Every authenticated action is declined first and checked for no driver/credential
effect, then exercised through its declared positive/refusal scenario.

The fresh JSON receipt under ignored `review/` records completed cases, runtime
fingerprint, source, duration, evidence tier and owned cleanup. A failed run remains
failed with its completed prefix. Set `PASSPORT_DEMO_JOURNEY_OUTPUT` to a fresh
path to retain a specific receipt, or `PASSPORT_DEMO_JOURNEY_SCREENSHOTS` for initial
desktop/mobile screenshots. No mock key or storage dump is exported.

PR CI runs this lane in a separate job alongside package/app/type checks. It uses
the existing locked dependencies and runner Chrome; no browser download, large key
generation or native proof is added. The warm-job target still needs
hosted timing evidence. Native proof/restart and actual provider qualification
remain independent slower lanes; follow the [qualification guide]({{ '/qualification/' | relative_url }}).

### Select one diagnostic group

Local default runs both complete arms. `PASSPORT_DEMO_JOURNEY_ARM=p256` or
`jubjub` selects one whole profile. An explicit group additionally requires one
explicit arm; invalid selectors refuse before starting resources:

```sh
nix develop -c env PASSPORT_DEMO_JOURNEY_ARM=p256 \
  PASSPORT_DEMO_JOURNEY_GROUP=account-actions \
  pnpm test:demo-browser
```

Groups are `presentation`, `account-actions`, `scoped-sessions` and `owner-safety`.
Each standalone group prepares its own required state through real demo controls:
signed-out page, reviewed create/wallet/funding/session draft, or reviewed joiner
handoff/wallet. Bootstrap time is recorded separately; bootstrap actions do not
receive credit as canonical cases. Presentation exercises no successful credential
access; the other groups retain their required purpose observations. Default full
runs reuse their original preceding flow, without these extra bootstrap operations.

CI runs all eight arm/group cells. Its separate inventory aggregate requires
matching source/runtime/catalog identities, exact ordered case sets, purpose and
cleanup evidence, and consistent monotonic timing. Missing, duplicated, stale,
failed or skipped cells cannot pass. **Lint, format, build, and test** retains its
required name and waits for both matrix and inventory checks. Local default and
standalone receipts are separate evidence; neither proves hosted performance,
native proofs, real-provider support or release readiness by itself.

For local artifact aggregation, arrange each fresh receipt at
`<root>/journey-<arm>-<group>/demo-journeys.json`, then run:

```sh
nix develop -c node scripts/qualification/demo-journey-receipts.mjs \
  --input /absolute/path/to/eight-cell-artifacts --source FULL_COMMITTED_SOURCE_SHA
```

The CLI expects a clean source and a closed directory inventory. `--allow-dirty`
is only for explicitly labelled local diagnostics and refuses in CI. The aggregate
checks receipt structure and matching evidence; it does not launch tests or certify
that a synthetic JSON fixture came from a browser. Keep the original runner logs,
commands and source signatures alongside the receipts.

## Quantitative package coverage

```sh
nix develop -c pnpm test:coverage
# Optional fresh output directory after the build:
nix develop -c node scripts/test-coverage.mjs /private/new-coverage-directory
```

The local-source quality increment uses pinned c8/V8 coverage with compiler source
maps and **all executable authored sources in the nine public packages**, including
unimported files. It produces `tests.tap`, `lcov.info`, raw `coverage-summary.json`
and an inventory/threshold receipt in `summary.json` under a fresh ignored review
directory. It enforces 80% lines, functions and branches globally and per package,
and refuses missing source records. Generated metadata, type-only stubs, testing
helpers and private retired scaffolds are explicit exclusions. Release verification
runs it; it stays outside the short required PR critical path. This is not UI,
contract-constraint, native-proof or provider coverage. See [quality strategy](../quality/).

The following earlier measurements used a **loaded-only JavaScript denominator**
and are retained as historical evidence, not directly comparable current results.

The initial 5 November development measurement covered 133 loaded files:
95.47% lines, 94.14% functions and 84.50% branches (958 passed, five skips).
It was measured on a dirty candidate tree and is a diagnostic baseline, not a
signed release acceptance receipt. Use the final review/release record for the
exact shipped source. The broader full gate also runs app tests, so its test count
is different from this package-only measurement.

A later clean signed-source package measurement (`4d985f5`) covered the same 133
files: **95.47% lines, 94.14% functions, 84.56% branches**, with 959 passed and five
skips. Subsequent UI/test/workflow/documentation fixes do not widen that measurement
scope. The RC7 full package/application gate passes 1,232 tests with seven existing
skips; neither figure establishes exhaustive case or provider coverage.

## Explicit remaining work

[#279](https://github.com/input-output-hk/midnight-passport-sdk/issues/279) and
[#280](https://github.com/input-output-hk/midnight-passport-sdk/issues/280) track this
RC7 browser/demo/docs slice; [#246](https://github.com/input-output-hk/midnight-passport-sdk/issues/246)
tracks broader host consent. Real provider/two-browser acceptance (#232), stronger
cross-operation session isolation (#245), total-loss recovery (#240), partial
shielded change (#201), general connection (#242) and additional networks (#243)
retain their own requirements. [RC7 tracker #282](https://github.com/input-output-hk/midnight-passport-sdk/issues/282)
requires actual package/image/Pages verification before publication is reported.

## Local source session increment after RC7

The extended Chromium journey runs the session controls for both owner-arm
selections: initial/exact-scope refusal, PRF child derivation, expiring grant
authorization, no-credential matching withdrawal, fresh-passkey critical rotation,
local lock, owner revocation, reload, absolute expiry, and lost acknowledgement
with no automatic retry or owner fallback across reload. The controller and
generated JubJub signature/holder guards are real; owner/chain/wallet drivers
remain synthetic. Portable tests additionally cover concurrency, clock rollback,
scope/cap/context mismatch, key disposal and checkpoint guards.

The immutable RC7 release evidence above is unchanged. These source tests are not
native proof acceptance, provider synchronization/restoration or full Lace
compatibility. See [session scope and safety]({{ '/jubjub-sessions/' | relative_url }}).

## Native source session qualification after RC7

A separate isolated run uses the actual controller, session key helper and holder
against native proofs: both software owner arms, fixed-recipient withdrawal and
recipient credit, copied-key revocation, distinct-child renewal, real ten-minute
expiry and expired-slot reclamation. The [session guide]({{ '/jubjub-sessions/' | relative_url }})
and its linked receipt pin the executed source, all originals, used key hashes and
cleanup. Browser consent/HTTP behavior is still a separate synthetic-chain lane.
These SDK refusals before proving do not establish malicious-proof node rejection.

The run confirms an original transfer before reconnecting a stale wallet observer.
A stale display is not permission to resend. Refresh, then use the normal consented
wallet reconnect flow and original-hash inspection. Source qualification does not
add this feature to published RC7, qualify a real PRF provider or prove full Lace.


### Source preview after RC7: explicit approval per credential request

The Chromium lane now checks independent approval before every observed mock
credential access, including creation, new-credential verification, identification,
PRF unlock and P-256 signatures. One click cannot approve a later request. It also
checks Escape before credential creation, refusal of the second initial request,
PRF refusal, separate post-deployment setup publications and cancellation of a
synthetically injected recognized browser-format retry. The synthetic setup
publications demonstrate consent boundaries, not native activation acceptance.
The live proof receipts for the previous native slice remain pinned to their
original source; they do not establish a real provider or combined browser/native
pass for this UI change.


## Current source: credential policy and audit map

The latest policy supersedes earlier prompt-free **full-owner administration**.
Verified login can warm an explicitly reviewed 10/15/30-minute routine lease;
critical operations require fresh passkey approval even under an authenticated
JubJub owner. A full owner retains full on-chain power. A bounded grant transfer
remains separate and needs no credential request only inside its approved scope.

The source review maps creation, both owner-arm logins, cold address-first P-256
recovery, optional routine-key handoff, durable wrapper forwarding, independent
wallet/holder identities and critical approval. See the
[credential-path audit](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/review/credential-policy/README.md).
This is an inventory with focused regressions, not proof of every credential path,
circuit, interleaving or provider.

| Regression layer | Actual code exercised | Boundary |
| --- | --- | --- |
| `tests/p256-credential-scope.test.mjs` | Browser WebAuthn adapter and real-core P-256 create/reopen, setup PRF reuse, cold address-first verification, cancellation/refusal | Software credential implementation and fake ledger, not native deployment/provider UI |
| `tests/login-key-handoff.test.mjs` | Verified account-open hook inside login scope; wallet-seed-only handoff, scope disposal, failure and overlap | No implicit host lease; software credentials and fake chain |
| `tests/durable-credential-session.test.mjs` | Prototype/receiver-bound optional login forwarding and legacy absence | Does not qualify every historical durable transcript |
| `apps/passport-dapp/test/login-routine-adoption.test.ts` | Real derivation/envelopes, context binding, stale adoption, disposal and absolute lifetime | Host memory policy, not provider synchronization or wallet sync |
| `apps/passport-dapp/test/critical-approval.test.ts` | Fresh owner/reader matching, refusal, lease loss, output disposal and unchanged expiry | Injected credential ports, not a real provider/native proof |
| `tests/authenticated-operation-hook.test.mjs` | Argument capture before async approval, route/lease checks, no fallback and retention of dispatched receipts | Core host facade; cannot constrain a copied owner key on-chain |
| Isolated Chromium journeys | Current demo review/operation UI and synthetic credential API calls, both selected owner arms | Account/chain/wallet drivers remain synthetic; final run receipts must pin the executed source |

Historical prompt-free owner receipts remain evidence for their original policy;
they do not establish today's fresh-approval behavior. Earlier native receipts,
published RC7 hashes and provider limitations retain their exact original source
identities. Real Google/iCloud restored-credential behavior, browser/native combined
acceptance and eliminating the pure-JubJub creation probe are deferred.


## Next-preview acceptance boundary — 2026-11-09

PR295 is merged. Source `ba33365` adds lease-pinned RP approval, the canonical
`account/authorisation` export (the earlier spelling is an identical alias), a
ten-minute routine/full-owner default and a warning about copied full-owner keys
in the existing review. Its 192-case synthetic run retains every original case and
now checks that default. Fresh nine-tarball local installation verifies 34 public
runtime imports and strict Node/DOM/Worker/docs consumers. Those are current-source
candidate results; published RC7 remains unchanged.

The durable mutation API, host jobs and grant-recovery helpers are implemented
opt-in seams. Default demo account buttons are not automatically durable; missing
host receipts remain unknown, and another enrolled device cannot necessarily open
the issuing reader's grant records. Local source-native lifecycle results retain
their own source identity and are not browser/provider runs.

The [acceptance index](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/local-backlog-acceptance.md)
separates implementation, observed evidence and remaining delivery. Older issues
still mentioning Overview, central progress or collapsible Settings do not override
the owner's later landing, Activity and nested-navigation decisions. New registry
installs, production image readiness, published Pages, real providers and pinned
full Lace runtime remain separate acceptance steps. The exact-value shielded guard
and no-full-Lace boundary remain.

## Source preview: repeat-deposit regression (after RC8)

The [funding recovery journeys](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-dapp/e2e/journeys/funding-recovery.ts)
add five scenarios for each owner arm: consecutive NIGHT deposits, consecutive
custom deposits with separate balances, exhausted availability checks and manual
recovery, a read outage with a preserved insufficient selection, and unknown-ID
preservation through availability recovery. The tests assert no extra POSTs or
credential requests and use the actual Deposit controls, including a mobile view.

The [reader unit contracts](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-dapp/test/funding-recovery.test.ts)
also check finite retry/deadline budgets, malformed/HTTP refusals, response-body
stall, supersession, same-address account replacement and stop/late completion.
The canonical catalog checks retain the historical W9 name hashes while explicitly
including these new source cases. Passing synthetic receipts remain separate from
native deposit, real wallet synchronization and provider acceptance.
