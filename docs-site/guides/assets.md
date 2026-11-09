# Read holdings and move assets

## Read the right balance

An ACC has its own asset holdings. A person's separate Midnight HD wallet has its own address and balance; refreshing one does not refresh the other. Public ACC state can be read through chain/indexer ports. Private holdings require a live reader, the ACC viewing secret, and verified chain outputs. Do not replace a failed or incomplete holdings source with an empty list before a key rotation or value action.

## Deposit into an ACC

A deposit moves assets from an asset-holding wallet to the deployed ACC. The caller needs the compatible contract binding, asset and amount, and a value-capable wallet path. The reference funding service can make an authenticated, allowlisted wallet-backed deposit. Its request ID and reservation survive an uncertain result; a retry must use the original ID after reconciliation. The fee sponsor is a different wallet and **does not deposit assets**. [Service responsibilities](/operations/services) explains both.

## Withdraw with a supported authority

An owner or matching bounded grant can authorize supported withdrawal circuits. Unshielded withdrawal needs an injected value-capable call port; a fee-only sponsor cannot supply the outgoing asset. Show exact amount, asset, destination, selected signer, and observed holding before approval. The grant path must match recipient, asset, caps, expiry, and caller binding. A host must retain transaction references even if local authorization expires after dispatch.

**Shielded withdrawal limit:** the released path accepts an exact-value coin. A partial shielded spend is refused; the SDK does not silently split or make change. This affects the specific withdrawal capability, even when deposits or unshielded withdrawals work. See the [RC8 release evidence](/operations/quality) before claiming production interoperability.

Application contracts may call **into a deployed ACC** under the supported caller-bound design. That does not establish arbitrary ACC → other-contract calls. [See the implementation boundary](/architecture/standards).
