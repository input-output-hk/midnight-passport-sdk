# Read holdings and move assets

## Read the right balance

An ACC has its own asset holdings. A person's separate Midnight HD wallet has its own address and balance; refreshing one does not refresh the other. Public ACC state can be read through chain/indexer ports. Private holdings require a live reader, the ACC viewing secret, and verified chain outputs. Do not replace a failed or incomplete holdings source with an empty list before a key rotation or value action.

## Deposit into an ACC

A deposit moves assets from an asset-holding wallet to the deployed ACC. The caller needs the compatible contract binding, asset and amount, and a value-capable wallet path. The reference funding service can make an authenticated, allowlisted wallet-backed deposit. Its request ID and reservation survive an uncertain result; a retry must use the original ID after reconciliation. The fee sponsor is a different wallet and **does not deposit assets**. [Service responsibilities](/operations/services) explains both.

## Withdraw with a supported authority

An owner or matching bounded grant can authorize supported withdrawal circuits. Unshielded withdrawal needs an injected value-capable call port; a fee-only sponsor cannot supply the outgoing asset. Show exact amount, asset, destination, selected signer, and observed holding before approval. The grant path must match recipient, asset, caps, expiry, and caller binding. A host must retain transaction references even if local authorization expires after dispatch.

**Shielded withdrawal limit:** the released path accepts an exact-value coin. A partial shielded spend is refused; the SDK does not silently split or make change. This affects the specific withdrawal capability, even when deposits or unshielded withdrawals work. See the [RC9 release evidence](/operations/quality) before claiming production interoperability.

For contract integrations, the source candidate exposes
`deriveAccS3r1ShieldedWithdrawal` from
`@input-output-hk/mn-passport-contract/shielded-withdrawal`. It predicts the
recipient coin and optional ACC-owned change for the pinned `acc-s3r1.1` binding.
Keep the coin descriptions private. Settling change requires the original
finalized transaction, a matching commitment and Merkle index, and an
owner-authorized inbox append sealed to the current viewing public key.

The account package's `createShieldedWithdrawalJournal` stages a single original
dispatch in protected, crash-durable compare-and-swap storage. Keep the
request marker in a separate durable store so the original request remains
reserved if its protected record becomes unavailable. Its read-only
`recoverShieldedWithdrawal` checks the retained coin against a locally derived
commitment and compares the original transaction identity, call and effects
with the host's finalized observation. The host finality source must verify the
change's insertion index for that transaction. The recovery result contains a
private coin description for subsequent inbox settlement.

The source adapter has a checked dispatch path for an already authorized
and reserved partial withdrawal. It verifies the pinned midnight-js
`private.result` against the retained change description, then verifies the
embedded network, call commitment and shielded effects at each transaction
boundary. It preserves the serialized payout and change outputs, including the
encrypted payout note, through proving and balancing. It stages the exact finalized bytes' identity before handing them
to the value wallet's submitter. The response contains the submission ID and
transaction hash for observation. After an uncertain acknowledgement, use
the original request ID and read-only recovery.

### Opt-in partial owner withdrawal

In the source candidate, a host can supply `PassportPorts.partialShieldedWithdrawal`
to expose `account.withdrawShieldedPartial` for P-256 and JubJub owners. The
ordinary `account.withdrawShielded` method requires an exact-value coin.
Use `createMidnightPartialShieldedWithdrawalHost` from
`@input-output-hk/mn-passport-adapter-midnight-js` with the pinned
`acc-s3r1.1` predictor, finality source, holding indexer, value wallet and
protected journal. This adapter pays out to the configured wallet's shielded
coin public key. The host must review the exact recipient, asset, selected
inbox entry, amount and expected change before the owner signs.

Keep the original request UUID when calling `withdrawShieldedPartial`.
A reused UUID observes the original operation. Use the account package's
`reconcilePartialShieldedWithdrawal` for read-only status on both stages:

- `withdrawal-pending` means the original withdrawal is unconfirmed.
- `change-pending` includes the confirmed withdrawal hash. Change still
  needs its own confirmed inbox append.
- `change-published` includes both transaction hashes and the change's inbox
  index.

Use `settlePartialShieldedWithdrawal` with `kind: 'append'` for a new
owner-approved append or `kind: 'resume'` to resume a retained append.
Use the same withdrawal UUID for both. If the host reports an uncertain
outcome, reconcile before retrying. Treat change as available only once the
holdings reader qualifies the published entry. This source API requires
a host that can qualify both stages on its target network.

The holding reader includes committed shielded effects from partially successful
transactions. It verifies that every decoded event names the transaction being
read. A failed transaction contributes no holding effects, and an unreadable
transaction result fails the read. This check depends on the configured
indexer's account history.

The reference host observer checks the original transaction bytes, canonical
finalized block, and matching Zswap events. It requires independent evidence
for the change's insertion index. The reference host can replay the complete
finalized block from an authenticated parent snapshot. It checks the original
transaction hash and byte digest and finds the ACC change in the committed
Zswap events. Inbox recovery uses the account state immediately before and
after the original successful append, even if other calls share the block.

For the unspent check, the reference host requalifies the original change
and dry-runs its spend against full Zswap state at the node's best block.
It checks the block hash again before accepting. The reference host authenticates
complete Ledger 9 v18 snapshots against the configured node's full ledger root,
whether the node returns it inline or by reference.
Filtered indexer state cannot supply this check.

The replay host pins genesis and runtime spec `2001000`. Its block reader
uses independently pinned runtime metadata and bounded RPC reads for the
canonical block body, system event phases and timestamps. A phase shared by
an explicit ledger call and an implicit system event leaves recovery unconfirmed.
The replay can take serialized post-block ledger parameters from the indexer because it verifies the full
resulting state against the node before using any intermediate state.
The end root alone cannot prove transaction order. The default demo does not
wire this source or enable partial shielded withdrawals.

For a Node reference host, `createLedgerCheckpointProvider` supplies
`readLedgerSnapshot` to the transition and unspent observers. Create an owned
directory with mode `0700`, then configure the trusted node, the indexer, the
genesis hash and the independently recorded runtime metadata digest. Give one
provider exclusive write ownership of the directory. On a host-managed schedule,
call `advanceFinalized(signal)` until its height catches the reported finalized
height. Each call reauthenticates the retained cursor and commits only blocks
whose complete roots match. The provider runs replay and checkpoint I/O on
a Node worker thread. A busy worker declines new requests without queuing them.

The cache keeps 32 finalized snapshots by default. Set `retainedBlocks` from
2 to 128 for the recovery window you need. Each snapshot can use up to 16 MiB.
Changing the chain pin or retention selects a separate cache directory. Keep the
original intent journals separately. An older snapshot outside the retention
window leaves the original operation unconfirmed until it can be rebuilt. Use
a separate owned cache and call `advanceFinalized(signal, throughHeight)`
in bounded steps to rebuild through the required historical height. Serve the
reconstructed snapshot by its exact hash. Historical rebuild needs the node
and indexer to retain the block history. The live cursor continues independently.
A read of the current unfinalized best block replays only within
`blocksPerAdvance`, checks the best hash again, and keeps the result in memory.
The reader can replay an unindexed block with no ledger transactions by using
zero block fullness and verifying the complete node ledger root. The reader
uses indexed parameters when they are available. A block with ledger
transactions requires the indexer's exact parameters.

The account package provides `appendShieldedChange` and
`recoverShieldedBackfill` for a host that can verify the original withdrawal,
confirm that the change remains unspent, and observe the original finalized
append. The append seals change to the current viewing public key and reserves
one request per change commitment. Recovery checks the exact envelope at its
actual inbox index. Keep the encrypted journal and independent request marker
when an acknowledgement is lost.

The reference host can stage the original append's finalized bytes before
forwarding and recover the exact receipt after a restart. It checks the embedded
network when building, staging and recovering the append. A forwarding
acknowledgement counts only if it names an identifier of the retained
transaction. A missing or mismatched acknowledgement leaves the retained
receipt available for read-only recovery. The host checks the owner call
commitment and verifies the appended ciphertext and index against account
state immediately before and after that transaction. Live use requires a source
that authenticates this transaction-level state transition.

An isolated qualification run paired each owner withdrawal with a separate
shielded mint in the same finalized block. The P-256 withdrawal preceded its
mint. The JubJub withdrawal followed its mint. In both cases the observer
authenticated the original bytes and change index. It refused a nearby index
and the mint's identity. Separate processes recovered the original withdrawal
and append after lost acknowledgements. The reopened holding was then spent
at exact value. The append transactions ran in separate blocks.

The ordinary account entry points still require exact-value withdrawals.
A missing dispatch or finality observation is inconclusive. Keep the original
request and fence until the host can establish its outcome.

The source journal returned by `createShieldedWithdrawalJournal` can
explicitly cancel a newly reserved original with
`cancelBeforeDispatch({ requestId, networkId, bindingId, account })`.
Use this only when the host intends to abandon that exact request. A
`true` result means cancellation won the same durable fence that admits
submission. The original can never be submitted through that journal.
After a lost cancellation reply, ask again with the same scope.

A `false` result or storage error is inconclusive. In particular, an
original that has entered dispatch admission can require reconciliation
even if its protected transaction record is missing. Older reservations
cannot prove cancellation through this operation. Use independent,
crash-durable stores, and keep both on their current history. Restoring
both stores to a snapshot from before dispatch can erase its evidence.

Cancellation applies to the original withdrawal. To continue a pending inbox
append, use the source `resumeShieldedBackfill` operation with the original
withdrawal ID and a host that uses the same durable append receipt store for
initial and resumed dispatch. The protected account journal retains the
original signed arguments. Its `read` method continues to expose the append
identity without the signed arguments. Restrict `readContinuation` to the
host that is authorized to resume the retained request.

Resume first observes the original, then asks for explicit approval of the
network, binding, account, asset and amount if it remains unresolved. It rechecks the unspent change, current viewing key, inbox
count, device epoch, authorization nonce and owner entry before forwarding the
same append ID and signed arguments. The host checks its receipt before
building and can stage that ID only once. Recovery of an already finalized
append needs only read access. Older records can still be recovered by
observation. A changed account state or missing continuation leaves the
original unresolved. Keep the original IDs and journals for reconciliation.

Application contracts may call **into a deployed ACC** under the supported caller-bound design. That does not establish arbitrary ACC → other-contract calls. [See the implementation boundary](/architecture/standards).

## Repeated deposits and uncertain results

In the source candidate, each completed known deposit releases the demo's busy
state, so the asset selector can be used for another approved deposit. Available
funding inventory is a separate observation. A temporary inventory/read failure
must not be mistaken for proof that the preceding transfer failed or that all
assets were permanently disabled.

If the outcome is unknown, keep the original request and transaction references
and reconcile that operation in Audit/operator tooling. Do not generate a new ID
to bypass an unresolved send. A later known completed deposit and a same-ID
continuation are different actions. The [candidate release scope](/operations/rc9-preview)
records the new behavior and the exact-version acceptance still required.
