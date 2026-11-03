# Review map: reusable application-to-ACC integration

Parent #257; implementation/remaining acceptance #275. Local only, not in RC6.

1. `packages/contract/bin/export-acc-compact.mjs`: pin the compiler manifest before
   parsing its file requirements; check four generated files and all 52circuits;
   no generated import/key generation; exclusive new output and checked compiler
   dependency publication. CLI receipt is identity, not publisher provenance.
2. `tests/contract-compact-export.test.mjs`: unchanged baseline, substituted modules
   and unused verifier/manifest/file-set controls, existing/symlink output refusal.
3. `examples/application-acc/contracts/merchant.compact`: one trusted configured ACC,
   fixed merchant policy and capacity; no arbitrary callee substitution or signing
   secret; nested authorization remains in the ACC. Counter/limit is not generic
   authentication or a fulfillment protocol.
4. `prepare-payment.mjs` and `tests/application-payment.test.mjs`: live scope/object/
   spent/caller checks before signing, explicit review and fresh context, selected
   key check and no submit API. Outer key scope is not a provider prompt count.
5. `qualify-offline.mjs`: real compiled modules and operation keys, actual generated
   ACC/grant signatures and refusal cases. Local candidate state commit is not
   node admission. Output identifies zero proof/node/provider work.
6. `docs/site/partner-integration.md`, compatibility/package/use-case guides and
   `docs/partner-adoption-plan.md`: layered adoption, both call directions,
   authority versus bundle distribution, exact installed versions and unqualified
   native/provider boundaries.

Keep expensive compiler/installed-consumer/native work out of required 30–45s jobs.
Candidate receipts and independent review are recorded after execution; a test
definition is not acceptance evidence. Retain failed fresh consumers. No existing
binding, released tarball, image, native fixture or unknown transaction is replaced.
