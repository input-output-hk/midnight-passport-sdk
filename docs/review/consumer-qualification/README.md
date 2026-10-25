# Consumer qualification slice — #79 / #81

Date: 2026/10/20. Local work on the current branch; nothing published or pushed.
Read the [engineer guide](../../site/consumer-integration.md) first. The
[historical consumer report](../../lace-consumer-report.md) retains its original pins.
Private current-source pins, receipts and addresses remain in the authorised Obsidian checkpoint.

## Review order

1. `scripts/consumer-inputs.mjs` and `tests/consumer-inputs.test.mjs`: pre-install
   tarball SHA-256, exact source revision, tracked/staged/untracked/ignored source refusal,
   path containment and duplicate-package refusal. These are local manifest checks, not signatures.
2. `scripts/smoke-lace-source-consumer.mjs`: explicit source override, independently
   matching generated ACC bytes, actual seam declarations and physical runtime identity.
3. `tests/fixtures/lace-published-consumer.ts` and
   `scripts/smoke-lace-published-consumer.mjs`: installed public declaration bundles,
   same-entry composition, deliberately rejected reverse-brand/prover/record/cross-entry
   assignments, ESM/CJS loads and a real WASM browser build.
4. `scripts/run-lace-consumer-flows.mjs` and `experiments/lace-consumer/`: synthetic
   key/consent, HTTP loader and localnet diagnostics in an authorised disposable checkout.
   Uses bounded process groups, explicit localnet opt-in, exclusive fixture/output creation,
   exact source checks and no Nx result cache. Source and signer scopes are unchanged.
5. `apps/passport-key-service/src/server.mjs` and its HTTP regressions: the concrete
   fix in this slice. Reduced profiles restrict prover/ZKIR availability; all small pinned
   verifier keys stay available for deployment. `/v1/profile` reports both sets.
6. [Sanitized assessment](assessment.json), [compatibility matrix](../../compatibility.md)
   and updated installation/host documentation. Full detailed private receipts are not public assets.

## Accepted local evidence

- Fresh installation of all nine private RC5 packages alongside the actual published host
  canary, plus nine hash-checked local `0.1.0-consumer.1` tarballs in a separate consumer.
- Registry SRI agrees with the RC5 publication receipt and installed lock; all nine packages
  still have private visibility. The local candidate is not a published version.
- Actual public entry declaration tests, physical current Compact/ledger identities,
  ESM/CJS entry loads and browser builds pass. The canary's combined peer metadata warning
  is recorded; no ordinary-wallet operation compatibility follows.
- Current authorised source uses the retained ACC bytes and matches seven direct Midnight
  dependency versions. Key/consent diagnostics pass 36 tests with no skips.
- Actual host HTTP loaders read 52 pinned verifiers and ten owner proving bundles from
  the reduced profile; wrong hashes are refused, and CORS/range behavior passes.
- SDK-created ACC → unmodified hosted sign-in; hosted authorising-only device addition
  → live membership and later sign-in; native hosted-created ACC → SDK address opening.
  Native creation also passes through the corrected reduced key endpoint.

All chain evidence is on `undeployed`, uses synthetic credentials and simulated windows,
keeps the immutable `acc-s3r1.1` binding and preserves the shielded exact-value guard.

## Limitations retained

No real hosted page/provider, full reader enrollment, total-loss recovery, full compromised-key
revocation, partial shielded spending, value-bearing grantee flow, ordinary-wallet/Passport
runtime mixing or blanket Lace compatibility claim. Generic hosted SDK creation still needs
operations outside the original creation consent; native orchestration is the qualified route.
The historical-reader port was withdrawn; unanchored earlier envelopes do not authenticate removal targets.

The local #79/#81 supported-subset evidence is ready for owner review. No GitHub issue was
closed. The broader provider/value/capability work stays with #232, #202 and #237; durable
mutation/interruption work #230/#239 is the next implementation slice. The RC5 reduced-profile
image still needs `all` until a new image with the verifier correction is published.
