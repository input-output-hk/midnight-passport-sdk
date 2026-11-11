# Manage devices and bounded permissions

## Enroll and remove a device

Device operations change which credentials can read sealed account material and which keys the ACC accepts. The supported P-256 and JubJub arms can enroll, rotate, and remove through account flows when the host supplies complete live device and grant rosters, verified holdings, reader mappings, and proof/settlement ports. A registration record alone does not prove a device is live. Removal must exclude the lost reader from newly sealed material and reconcile any grant that still needs access.

`openAccountAt(address)` with an already enrolled passkey helps a second device open a **known** ACC. It is not discovery or lost-credential recovery. If the host lacks a complete chain-backed roster, refuse the administrative action. [Account lifecycle](/guides/account-lifecycle) describes the recovery boundary.

## Issue a grant with exact scope

The account owner can issue a bounded permission to a separate signer. The supported grant path commits recipient, asset, per-use/total caps, expiry, and caller constraints where selected. A grant holder can use only matching supported withdrawal paths. The full-owner JubJub key has a different authority level and must never be described as a bounded session key.

The host owns consent, the private grant opening, durable publication/recovery journal, and exact result display. Grant issuance may have a pending intermediate result; preserve its original ID, salt, scope, and sealed opening. Revoke or revoke-all changes on-chain authority after confirmation. Local expiry or clearing a key does not revoke a grant. [Durability](/guides/durability) covers uncertain changes.

The [upstream scoped-grants draft](https://github.com/midnightntwrk/passport/blob/main/docs/mps-mip/mips/mip-xxxx-scoped-grants.md) is **not** a numbered canonical MIP. It helps explain the contract design; inspect the deployed binding and SDK release for the actual supported subset.

### P-256 grantee withdrawals in the SDK source

`prepareP256UnshieldedGrant` from `mn-passport-account` prepares the
pinned `acc-s3r1.1` issue fields for one asset and a fixed unshielded Midnight
recipient. Supply the grantee's compressed P-256 public key, exact
`wa-json134` WebAuthn origin, and SHA-256 relying-party ID hash from a
verified credential. The origin is part of the grant ID. The relying-party
hash has its own salted commitment. The owner supplies the live active-ID
roster. Decode the recipient's unshielded address against the pinned
network before passing its 32-byte value. The helper refuses an all-zero
recipient. The owner reviews the network, address, caps and expiry before
issuance.

Keep the returned opening in protected host storage and deliver it only to
the intended grantee. The existing `account.issueGrant` surface accepts
JubJub grantees. P-256 grantee issuance needs a host to authorize and retain
the prepared fields.

For an issued grant, call `spendUnshieldedWithP256Grant` with the original
opening, amount, prior spent total, and a stable request ID. Use
`createMidnightGrantSource` for the pinned ledger snapshot and a
credential-pinned WebAuthn signer. The SDK checks that the reader and chain
use the reviewed network and binding. The host reviews the exact transfer and
provides a value-capable chain port and a durable journal. Reserve the
request before dispatch and persist the returned transaction hash against
that reservation. Use `createP256GrantSpendJournal` with a dedicated durable compare-and-swap
store. Pass the journal as `p256GrantReceipts` to `createMidnightChain`.
The chain checks the signed arguments before proving, then checks the
call commitment and payout before recording the finalized transaction
hash, exact byte digest and identifiers and forwarding one send.
On `MutationUnsettled`, call `recoverP256GrantSpend` with the original
request ID and an observer for the same network. A matching successful
transaction must be in a canonical finalized block. Keep the opening and
passkey material out of audit logs.

Source qualification used the generated Compact contract with software
signatures and a separate Chromium virtual authenticator. Native proving,
real passkey providers and demo wiring remain to be qualified.
