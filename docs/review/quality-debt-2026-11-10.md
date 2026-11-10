# P-256, reference demo and native bridge decomposition

Baseline: `0cea564f2d7b752b513499e311f36fbdb01a2e9b`, following the
[initial quality audit](pre-rc-quality-2026-11-10.md). This follow-up delivers
the three remaining implementation areas requested before the next RC. It does
not change the account binding, key recipes, signing/consent policy or package count.

## Scope and acceptance

| ID | Deliverable | Acceptance |
| --- | --- | --- |
| QA7 | Focused P-256 operations and composition | Root and new modules meet default file/function/complexity/non-null budgets; public API, live optional-port lookups, captured network and original flow/session boundaries remain |
| QA8 | Reference app controllers and presentation | Explicit typed state and host wiring; no new actions or UI policy; both-arm browser journeys cover consent, stale completions, unknown IDs, funding, sessions, navigation and Audit |
| QA9 | Typed native reference boundary | No explicit `any` in the bridge; actual v9 marker/key/update types; checked persisted contexts and module capabilities; no replacement planning or key generation on resume |

All three require the complete local gate, nine-package coverage floors,
public-export consumer checks, updated docs and exact committed-head independent
review. Source, offline ledger, synthetic browser/worker, native proof, provider,
installed consumer and release-image evidence remain distinct. A new native/image
release claim needs its matching source-bound acceptance; earlier receipts are not relabeled.

## P-256 review map

`connector.ts` owns public factory selection and wiring. `p256-observation.ts`
owns live account/counter observation. `p256-composition.ts` wires enrollment,
rotation and revocation. The public account facade selects explicit methods from
`p256-withdrawals.ts`, `p256-private-access.ts` and `p256-grant-methods.ts`;
it never spreads an operation object's private context or record into the API.

`p256-account-context.ts` describes captured factory references and original live
ports. Optional methods are resolved at their original use points and invoked
with their receiver. Inbox/holding guards replace non-null assertions. Preserve
exact-value shielded spends, original counters, strict P-256 signatures, pending
hints and directory retries. No helper starts an extra Flow, credential session,
transaction or fallback route.

## Demo review map

`app-model.ts` describes the reference host's state and controller dependencies.
The entry, device, grant, transfer and wallet controllers own action handlers;
`app.ts` composes them with consent, receipts, routine access and lifecycle wiring.
Each handler still captures its account/intent at the same execution point.
Late optional-method checks do not move ahead of awaits. Wallet startup remains
lazy and keeps its worker composition, checked lease and seed cleanup.

`ui-state.ts` owns public presentation state for one UI instance. `ui-controls.ts`
owns button/form availability; `ui-activity.ts` owns progress, incremental Audit
rows and evidence; `ui-cards.ts` owns account/holding/roster/wallet facts.
`ui.ts` exposes the existing bound presentation methods. State and operation
objects are not shared across independently created hosts. Rendering uses safe
DOM setters and retains the existing mounted controls, callbacks and action order.

These modules are reference application wiring. The SDK's framework-neutral ports,
authorization, background and interaction APIs remain the reusable integration
surfaces. A React host can arrange those surfaces without importing this DOM UI.

## Native boundary review map

`reference-runtime.ts` uses the pinned ledger's actual transaction-marker,
SigningKey and proving interfaces. Runtime modules still resolve from the
reference tree; a type-only import never replaces the constructor instance used
by the wallet or `instanceof`. The direct development dependency introduces no
new version and is not a runtime ledger source.

The deploy-builder seam deliberately reflects the current runtime input and
typed output. Its upstream options declaration requires a signing key while the
existing constructor path creates and returns that key. Do not generate a new
key or cast the entire options object to satisfy that declaration.

`reference-modules.ts` checks function/static exports and network configuration;
`reference-backend.ts` composes proof, sponsorship and deployment services.
`host-preparation.ts` separates owner-call admission, deployment construction,
verifier/authority checks and wave validation. `host-driver.ts` continues a retained
plan through prepare/submit/lookup/check. `host-context.ts` decodes the existing
encrypted JSON context, preserving driver labels, serialized state/deploy bytes,
signing key, waves and retirement choice; it does not rewrite the stored document.

Sponsor inspection accepts instance-matchable native classes, including private
constructors. The existing exported `ActionClasses` constructor contract remains
available; the inspection functions require only `Symbol.hasInstance`. This is a
type-level admission correction, with unchanged sponsorship rules.

## Regression and qualification map

- Existing P-256 readiness, durable recovery, creation/open, transfer, grant and
  rotation tests exercise the unchanged public facade and generated circuits.
- Browser journeys exercise both owner arms, repeated funding, retained receipts,
  critical consent, scoped grants, routine access, keyboard/mobile and Audit.
- Native driver tests use actual ledger deployment/maintenance serialization,
  both arms and retirement choices, verifier/authority frontiers, signatures and
  TTL refusal. Resume tests prohibit new constructor/planner/birth-key calls.
- Context tests cover round-trip ownership, corrupt keys/bytes, missing plans,
  wrong driver/kind and mismatched step/wave metadata without native effects.
- Loader tests check missing/nonfunction exports, missing static capabilities and
  preserved constructor identity. Type/runtime tests cover private action classes
  and existing constructor inputs at the sponsorship boundary.

Existing primitive platform-global casts in the portable connector and browser
entry remain separately measured. The file/function and native dynamic-any
exceptions are removed or reduced; no new module receives a debt exception.
Semantic floating-promise analysis, production secret custody and wider real
provider/Lace acceptance remain outside this decomposition.
