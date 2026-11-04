# Deposit consent and original-request status — local source candidate

Bounded #246 follow-up to PR268. Base is signed799afd7; no new package, public SDK export,
persisted format, contract binding or demo funding change. Broad #246 and #269 stay open.

Review in this order:

1. `examples/shielded-deposit-review/reviewed-deposit.ts`: captured request/coin/pins and methods,
   fresh typed private review before keys, one active invocation, bounded public status fields.
2. `reconcile()` admission: missing/prepared refusal on every protected read, no creation/dispatch
   transitions or sender calls. The SDK's general prepared-state resume remains unchanged.
3. Transaction-ID retention after a failed submitted write; original identity check before a
   retained transaction enters the panel; no reflection of private diagnostics.
4. `tests/fixtures/reviewed-deposit-cases.mjs`: emitted strict public-import example, actual
   AES-GCM/private filesystem revisions, synthetic chain/wallet/finality/approval,17cases.
5. `tests/partner-recipes.test.mjs`: compile/execute the example. Clear inherited Node test context
   for the child runner and require its positive test count and zero failures; no silent no-op.
6. Engineer example README and `docs/site/shielded-deposit-recovery.md`: host obligations,
   uncertainty copy, separate journal/wallet approval and historical receipt semantics.
7. `docs/research/upstream-passport-2026-11-04.md`: owner-requested read-only upstream sub-agent
   research, exact sources/status and proposed backlog mapping, not imported behavior/evidence.

Validation results and exact reviewed head are recorded in the final receipt after review. No
native/provider/installed-registry/image acceptance follows from source recipe execution. All
shared Midnight containers and original unknown/private state remain untouched. No push/release.
