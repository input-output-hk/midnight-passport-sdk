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

The reference host observer checks the original transaction bytes, canonical
finalized block, and matching Zswap events. It requires independent evidence
for the change's insertion index. The Ledger 9 replay helper checks that index
using authenticated state immediately before the transaction. Supplying this
state and wiring encrypted inbox recovery are still required for live use.

For the unspent check, the reference host requalifies the original change
and dry-runs its spend against full Zswap state at the node's best block.
It checks the block hash again before accepting. The host needs a state
source that authenticates the spent nullifier set for that block.

The account package provides `appendShieldedChange` and
`recoverShieldedBackfill` for a host that can verify the original withdrawal,
confirm that the change remains unspent, and observe the original finalized
append. The append seals change to the current viewing public key and reserves
one request per change commitment. Recovery checks the exact envelope at its
actual inbox index. Keep the encrypted journal and independent request marker
when an acknowledgement is lost.

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
