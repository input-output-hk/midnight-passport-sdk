# Original shielded deposit recovery — review map

Tracking [#261](https://github.com/input-output-hk/midnight-passport-sdk/issues/261), under #257/#262.
Additive ports preserve the one-shot API. The [engineer contract](../../site/shielded-deposit-recovery.md)
defines journal ownership, privacy, canonical evidence and retained-unknown behaviour.

Review in this order:

1. `shielded-deposit-recovery.ts`: immutable bounded identity/codec; exact original inbox prefix,
   atomic preparation/dispatch admission, read-only unknown lookup and canonical transaction
   confirmation. No automatic re-send or re-seal; same historical confirmed receipt.
2. Shared input validation and the additive `ports.recovery` dispatch in `shielded-deposit.ts`.
   `resumeShieldedDeposit` requires the original state; unmanaged legacy calls are one-shot only.
3. `keys/shielded-deposit-journal.ts`: dedicated key domain and authenticated ID/revision/context,
   snapshotted writes, immutable intent/transaction and monotonic phase transitions. Existing
   service file byte store supplies atomic crash-durable private filesystem publication.
4. `tests/shielded-deposit-recovery.test.mjs` and its synthetic world/child: actual randomised seal,
   encrypted disk and fresh process exits; one sender effect across loss boundaries. Conflict,
   concurrency, exact-entry/prefix/finality, rotation, mutation, clock and corruption refusals. Real exits include the dispatch-fence unknown and the durably saved submitted state.
5. API/engineer/prototype/app docs: no native adapter, HTTP shielded faucet, demo funding change,
   real-provider acceptance, broad wallet lock or published RC6 export claim.

[Local gate](local-gate.json) records exact test counts against the stated base. It is not a
native proof or installed-registry receipt. Tests own and delete only their synthetic temporary
roots; they never touch retained localnet accounts, wallets or unknown mutation histories.

The dispatch fence intentionally has an unknown window before wallet invocation. Missing sender
proof cannot authorise a replay. Restoring an earlier journal revision or creating a new journal
for a legacy request is unsupported. The host must retain the actual sender's records and use
real canonical evidence with I/O deadlines; a matching inbox or truthy object cannot suffice.
