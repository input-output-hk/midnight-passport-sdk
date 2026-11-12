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

The source adapter has internal checks for the next value-wallet integration.
It binds the signed arguments and qualified input before proving, then compares
the call commitment, shielded effects, and concrete Ledger 9 offers before
staging the serialized transaction. The account withdrawal entry points still
enforce the exact-value guard while host finality and inbox recovery are in development.

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
reconstructed snapshot by its exact hash. The live cursor continues independently.
A read of the current
unfinalized best block replays only within `blocksPerAdvance`, checks the best
hash again, and keeps the result in memory. Preserve the exact-value guard
while SDK dispatch and lost-response recovery are being qualified.

The account package provides `appendShieldedChange` and
`recoverShieldedBackfill` for a host that can verify the original withdrawal,
confirm that the change remains unspent, and observe the original finalized
append. The append seals change to the current viewing public key and reserves
one request per change commitment. Recovery checks the exact envelope at its
actual inbox index. Keep the encrypted journal and independent request marker
when an acknowledgement is lost.

The reference host can stage the original append's finalized bytes before
forwarding and recover the exact receipt after a restart. It checks the owner
call commitment and verifies the appended ciphertext and index against account
state immediately before and after that transaction. Live use requires a source
that authenticates this transaction-level state transition.

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
