# Prototype UX: local implementation and review map

Milestone [#3](https://github.com/input-output-hk/midnight-passport-sdk/milestone/3),
epic [#287](https://github.com/input-output-hk/midnight-passport-sdk/issues/287),
children #288–#294. Work stays on the current `codex/rc5-publication-record` branch.
This is a local source increment, not RC7 publication or full Lace acceptance.

## Review order

1. [Execution scope](../../prototype/ux-milestone.md),
   [ADR0014](../../adr/0014-portable-interaction-models.md),
   [engineer UI guide](../../site/demo-ui.md).
2. `packages/account/src/names.ts` and `ports.ts`: read-only replaceable name port.
   `apps/passport-dapp/src/mock-name-service.ts` stays app-owned and synthetic;
   no naming onboarding, recipient autofill or deployed name-service claim.
3. `packages/account/src/interaction.ts`: pure immutable operation/journey
   observations, explicit time, subscriptions and stale presentation-write check.
   No credential, transaction, DOM, Node, React or timer dependency.
4. `apps/passport-dapp/src/workspace.ts` and `activity-controls.ts`: move existing
   controls into five workspaces; central staged progress; operation-first Activity,
   independent white-label mounting, mobile sheet/focus, Settings and wide Audit.
5. `activity-observations.ts`, `event-log.ts`, `flows.ts`, `progress.ts`, `ui.ts`:
   match traces/intents to their own attempt, clamp mixed clocks only for display,
   retain raw evidence and project the same cancelled/unknown outcome everywhere.
   Validated accepted grant hashes survive error flattening. A pre-submit roster
   error and a post-submit unsettled spend must not be conflated.
6. [Optional React example](../../site/react-example.md): private app dev-only
   dependency, importable hook/renderers, separate synthetic entry and StrictMode.
   No new published package or foundation dependency.
7. `packages/adapter-browser/src/wallet.ts` and the
   [optional wallet guide](../../site/lace-wallet.md): explicit UUID candidate
   selection, reviewed metadata pin, stable4.0.x/4.1.x public read subset,
   network/address validation, immutable facade and local invalidation. App-owned
   `lace-wallet.ts` keeps it separate from the ACC and built-in HD wallet, with
   no transfer/signing/raw connected API or implicit ACC grant.
8. `e2e/demo-journeys.e2e.ts`, fixtures and unit tests. The browser harness owns
   its server/contexts/cache; origin interception stays until context close.
   It never sends fixture traffic to a running user demo or writes the real
   clipboard. Physical SDK/React runtime/source hashes are checked at both ends.

## Review corrections

Independent CLI review found and local signed fixes address:

- External naming-provider labels incorrectly claimed a mock response.
- Mixed service/browser clocks could throw in a progress subscriber after send.
- Declined exact grant/session reviews looked successful; lost acknowledgements
  looked like normal failures.
- Background session telemetry could relabel an already-ended operation or lend
  an unrelated intent. Trace bounds now close on attempt completion, while the
  full raw Audit trace is retained; session association requires its own begin.
- Audit/export presentation outcomes disagreed with Activity.
- Submitted grant errors lost their public transaction hash and could invite a
  mistaken retry. Validated submission metadata now means unknown; the same error
  code without acceptance evidence remains a distinct failed attempt.

The latest independent shell re-review at signed `b320ce1` found no actionable
regression. Its focused tests ran, but its sandbox could not access the Nix daemon
for full builds/browser journeys. Main Nix qualification supplies executable
coverage. The optional React/wallet tranche requires its own exact-head review.
Final receipts, findings/fixes and signature verification belong to the dated
Obsidian checkpoint/evidence packet; do not relabel earlier runs as a new head.

## Qualification and limits

Run the full gate in AGENTS.md before every signed commit, plus pinned actionlint
for workflow edits. `pnpm test:demo-browser` runs both owner arms by default;
`PASSPORT_DEMO_JOURNEY_ARM=p256|jubjub` selects an entire arm for CI. Invalid values
refuse. Required aggregation still depends on every component. No native proof,
key generation, registry install or new cache trust enters the fast browser lane.

Browser cases cover positive and refusal account/device/grant/session flows,
credential-by-credential consent, mobile keyboard layering, navigation during
pending/unknown effects, original-ID Audit, redacted export, two DOM hosts,
StrictMode remounting and synthetic extension lifecycle. Native proofs, real
passkey providers, real Lace extension, React Native, SSR and `lace-sdk` are not
qualified by this increment. Existing native/source receipts retain their scope.

The 30–45-second warm-job target remains unverified on hosted CI until an
explicitly authorized push. The expanded local P-256 draft took about51seconds;
sharding by owner arm does not establish the hosted target. Keep #271 open and
report final timings honestly; do not omit journeys or weaken assertions.

Preserve the exact-value shielded withdrawal guard, immutable binding and durable
unknown-intent fences. A separate wallet connection grants no ACC ownership,
viewing/spending permission or enrollment. User demo/resources, credentials,
journals and unrelated stacks remain untouched. No push, PR, merge, release or
Pages publication is part of this local goal.
