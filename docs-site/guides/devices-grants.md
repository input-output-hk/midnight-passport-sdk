# Manage devices and bounded permissions

## Enroll and remove a device

Device operations change which credentials can read sealed account material and which keys the ACC accepts. The supported P-256 and JubJub arms can enroll, rotate, and remove through account flows when the host supplies complete live device and grant rosters, verified holdings, reader mappings, and proof/settlement ports. A registration record alone does not prove a device is live. Removal must exclude the lost reader from newly sealed material and reconcile any grant that still needs access.

`openAccountAt(address)` with an already enrolled passkey helps a second device open a **known** ACC. It is not discovery or lost-credential recovery. If the host lacks a complete chain-backed roster, refuse the administrative action. [Account lifecycle](/guides/account-lifecycle) describes the recovery boundary.

## Issue a grant with exact scope

The account owner can issue a bounded permission to a separate signer. The supported grant path commits recipient, asset, per-use/total caps, expiry, and caller constraints where selected. A grant holder can use only matching supported withdrawal paths. The full-owner JubJub key has a different authority level and must never be described as a bounded session key.

The host owns consent, the private grant opening, durable publication/recovery journal, and exact result display. Grant issuance may have a pending intermediate result; preserve its original ID, salt, scope, and sealed opening. Revoke or revoke-all changes on-chain authority after confirmation. Local expiry or clearing a key does not revoke a grant. [Durability](/guides/durability) covers uncertain changes.

The [upstream scoped-grants draft](https://github.com/midnightntwrk/passport/blob/main/docs/mps-mip/mips/mip-xxxx-scoped-grants.md) is **not** a numbered canonical MIP. It helps explain the contract design; inspect the deployed binding and SDK release for the actual supported subset.

### P-256 grantee opening in the SDK source

`prepareP256UnshieldedGrant` from `mn-passport-account` prepares the
pinned `acc-s3r1.1` issue fields for one asset and a fixed unshielded Midnight
recipient. Supply the grantee's compressed P-256 public key, exact
`wa-json134` WebAuthn origin, and SHA-256 relying-party ID hash from a
verified credential. The origin is part of the grant ID. The relying-party
hash has its own salted commitment. The owner supplies the live active-ID
roster and reviews the recipient, caps and expiry before issuance.

Keep the returned opening in protected host storage and deliver it only to
the intended grantee. The helper prepares fields and commitments. Owner
authorization, durable issue and P-256 holder spending still need the
corresponding host flow. The existing `account.issueGrant` surface accepts
JubJub grantees.
