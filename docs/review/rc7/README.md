# RC7 release preparation review map

Tracking: [release #282](https://github.com/input-output-hk/midnight-passport-sdk/issues/282),
[browser #279](https://github.com/input-output-hk/midnight-passport-sdk/issues/279),
[demo/docs #280](https://github.com/input-output-hk/midnight-passport-sdk/issues/280),
and existing consent/session/qualification #246/#245/#231/#236.
Published RC6 remains unchanged until the RC7 publication record exists.

## Review order

1. `packages/adapter-webauthn/src/ceremony.ts`, `passkey.ts`, `prf.ts`, `adapter.ts`:
   optional purpose hook immediately before actual credential access; no key material
   in metadata, create-time PRF reuse, direct signature and profile retry behavior.
   `adapter-browser/src/compose.ts` forwards this host option.
2. `apps/passport-dapp/src/consent.ts`, `ui.ts`, `app.ts` and key-source compositions:
   initial operation review before handler/key work, mandatory maintenance-retirement
   acknowledgement, accurate account-selection context, exact later review,
   cancellation/unknown boundaries and viewport-visible purpose notice.
3. `apps/passport-dapp/e2e/demo-journeys.e2e.ts` and its private Vite test fixtures:
   actual UI/mock credential API versus synthetic connector/chain/wallet. The
   browser-only observer checks matching purpose/attempt, visible viewport and two
   rendering frames at each credential call. Every profile must have no observer
   failures, including expected-negative scenarios.
4. `src/capabilities.ts` and the engineer consent/coverage/release guides:
   public proof planning without credentials or runtime readiness claims.
5. `scripts/test-coverage.mjs`, focused tests and PR workflow:
   loaded-package JavaScript measurement separate from the fast required browser
   job; no arbitrary percentage threshold or proof/provider relabelling.

## Independent review and controls

The initial GPG/DCO implementation `4d985f5` passed the full local gate (1,232
passed, seven existing skips), packed-package installation, browser build and key
restore. Independent review found two P2s: a single rAF can resume before paint,
and the browser test did not directly observe purpose at credential access.
Signed `543c5c4` adds the double-frame/visible notice and credential-call observer.
Its clean-source browser run passed all 26 grouped cases, with all five P-256
purpose kinds and the four applicable JubJub kinds observed. These are API accesses,
not measured real-provider prompts.

A second independent review found one test weakness: an expected `failed.` UI
status could mask an observer rejection. The current correction requires empty
observer failure lists on every outcome/profile and checks intended refusal
messages. Final independent review and hosted CI must confirm the candidate head.

Preserved synthetic controls demonstrate the assertions rather than just their
happy path:

| Control | Observed result | Interpretation |
| --- | --- | --- |
| Reduce rendering barrier to one frame | Browser receipt fails with `InsufficientRenderingFrames`; all owned resources close | The new observer detects the original rendering regression |
| Inject raw credential access in wrong-network rejection, old assertion policy | Control reports pass while recording `UnexplainedCredentialAccess` on both arms | Deliberate false-pass counterexample; **not qualification evidence** |
| Same injected access, corrected assertion policy | Receipt fails with `UnexplainedCredentialAccess`; all owned resources close | Expected UI failures can no longer hide a rejected credential access |

Control receipts explicitly identify synthetic effects; patches/hashes and private
logs stay with the retained engineering artifacts. No real provider, Docker, native
proof or transfer ran. Browser contexts, ephemeral servers and per-run caches are
owned and closed; no running demo or unrelated stack is stopped.

## Registry test transport observation

One later full-gate attempt failed the registry test's first fetch before obtaining
an HTTP response. The original log is preserved; it did not record the nested
connection cause, so no production HTTP defect is asserted. The test fixture now
binds/requests one explicit IPv4 loopback endpoint, awaits idempotent owned-server
shutdown and records redacted socket error codes without retrying. Eight fixed
fresh-process runs, four parallel workers, passed all 104 registry cases. The
complete gate must still pass after this test-only correction.

## Package, image and evidence boundaries

Nine local `0.1.0-rc7` tarballs passed the existing installed-consumer smoke,
physical runtime/type checks, Vite build, host-job checks and deterministic
`deposit_unshielded` key restoration. A separate frozen/offline installed consumer
checks the new public hook types and refusal before any credential container is
accessed. Two distinct clean builds produced matching SHA-256 values for all nine
tarballs. These are local preparation results, not actual-registry acceptance.

The native merchant receipt remains bound to executed `eb240f6`; browser changes
do not repin that proof, its seven construction refusals or the retained original
observation failure. Exact-value shielded guards remain intact. Full Lace/provider,
partial change, total-loss recovery and local expiring session grants are not added.

Before declaring publication: final GPG/DCO source/review, exact-head hosted CI,
signed SDK/three-image tags, existing private publisher, actual package visibility
and SHA/SRI/provenance, authenticated installation, immutable image digests/startup,
and published Pages must all be recorded. Release notes and the compatibility map
must link the actual final receipt. No preparation check substitutes for that gate.
