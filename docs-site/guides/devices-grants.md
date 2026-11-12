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
JubJub grantees. Use `issueP256GranteeGrant` with a reviewed P-256 or JubJub owner
session and a separate P-256 grantee credential. The owner path rechecks
its live device entry and the grant roster, then durably reserves the
original opening before sending. In a Node host, combine
`createP256GranteeIssueJournal` with `protectedMutationByteStore` and a
dedicated host key.
Use `createP256GranteeIssueFence` with a separate crash-durable store.
It retains the request ID even if the encrypted opening or its key is
unavailable. Keep both stores and restore their original contents after
an outage. After an uncertain response, use
`recoverIssuedP256Grant` to verify the original opening against the live
grant. A repeat request keeps the original ID and stays fenced.

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

Source qualification includes owner issuance and receipt-loss recovery
against the generated Compact contract. Holder qualification used software
signatures and a separate Chromium virtual authenticator. Native proving,
real passkey providers and demo wiring remain to be qualified.

### Verify a browser grant request in the SDK source

The WebAuthn adapter exports `browserGrantRequestDigest` and
`verifyBrowserP256GrantRequest` for the direct P-256 request in the [pinned
Passport scoped-grants draft](https://github.com/midnightntwrk/passport/blob/e0e4e0e6272399d71dfaaa7cae0689ab4e2363f3/docs/mps-mip/mips/mip-xxxx-scoped-grants.md).
The dApp hashes the exact base64url request string, uses that digest as
its WebAuthn challenge, and sends the original request and proof in the
authoriser URL fragment. The verifier accepts one fixed-recipient
unshielded withdrawal permission with a finite expiry and an HTTPS
`wa-json134` origin. It checks the assertion's key, origin, full-host RP
hash and user verification, then maps the signed bounds to the account
SDK scope. Unsupported scopes, read-key delivery, caller pins and
non-browser proofs are refused by this route.

A host can compose the request verifier and existing owner issue flow through
`authoriseBrowserP256Grant` from `mn-passport-adapter-browser`.

1. Require top-level navigation and remove the fragment from browser history.
   Call the adapter with the original fragment, the configured issuer and a
   signed-in owner session pinned to the account and network.
2. Provide `createBrowserGrantNonceStore` from `mn-passport-account` with a
   durable, atomic store shared by the issuer's replicas and a secure UUID
   generator such as `() => crypto.randomUUID()`. Keep this store
   independent of the protected opening journal and the issuance fence.
   Keep the fragment, callback state and openings out of logs.
3. Implement the owner review and fresh signing ceremony in the issue ports.
   The adapter admits one issuance per nonce, preserves the signed slot and
   rechecks the signed deadline before signing and dispatch. Repeats only
   inspect the original issue and can recover after the request window closes
   while the matching grant remains active and unexpired.
4. Build the return URL with `browserP256GrantCallbackUrl` and deliver it to
   the exact validated callback. Use a canonical browser URL as the requested
   redirect, including a trailing slash when it has no path. Keep the private
   opening in the fragment.
5. On the holder, retain the signed request in the initiating browser session.
   Capture the callback URL and remove its fragment from history. Call
   `verifyBrowserP256GrantCallback` with the saved request, expected issuer
   and a network-pinned grant reader. It checks the exact callback URL,
   session state, slot and requested scope. It then recomputes the grant ID
   and verifies the current grant, epoch, generation, expiry and commitments
   before returning an opening. Promote the holder credential only on success.
   On a mismatched opening, show that the grant was refused and offer owner
   revocation from another trusted device.

An `unresolved` result carries the original issuance ID. Keep the original
request available to reconcile that ID. Missing evidence leaves the outcome
unresolved. A new nonce represents a new request and requires its own review.
A denied, interrupted or expired admission never automatically starts another
issuance from that nonce.

The opt-in demo covers separate holder and issuer pages for the exact
requested scope. See the [host guide](./hosts#authenticated-browser-grant-relay)
for the isolated issuance and original-receipt check, and the remaining live
holder verification and export. Attenuated grants remain open.

### Verify a non-browser agent request

The source-preview `verifyAgentJubjubGrantRequest` export in
`mn-passport-account` accepts separate `request` and `proof` strings over an
explicit non-browser channel. The host supplies its exact HTTPS authoriser
origin, network, selected ACC and current time. The verifier checks a
key-prefixed JubJub Schnorr proof over the original transmitted request,
using the pinned ACC generator. This path supports a single unshielded
withdrawal permission with a fixed recipient, caps and a finite expiry.

Show `rdns:` and `mais:` labels as operator-asserted and `self:` labels as
owner-chosen. A valid signature proves possession of the grant key. A
trusted channel and owner review establish whether the requested permission
is appropriate. Use `accountSource` to tell the owner whether the agent
signed the ACC address or the owner selected it. Requests carrying a
redirect, browser state, WebAuthn proof
or unsupported scope are refused.

### Issue and recover the original agent grant

Call `issueAgentJubjubGrant` with the original wire packet and an active
JubJub owner route. The host supplies fresh owner approval, a pinned grant
source and a deadline-fenced chain. On standalone, use
`createDeadlineFencedGrantIssueChain` from `mn-passport-adapter-midnight-js`
with the private grant sponsor. A custom dispatcher must enforce the deadline
through final broadcast. Supply two durable stores:

| Store | Retain |
| --- | --- |
| `createAgentGrantNonceStore` | Atomic nonce admission, bound to the exact request and owner route. |
| `createAgentGrantIssueJournal` | The protected scope salt and expected ledger identity. Use authenticated encryption and keep this separate from the nonce store. |

The SDK stages the owner bookkeeping and protected record before dispatch.
It passes the original UUID, intent digest and earliest allowed submission
deadline to the host chain. The standalone sponsor checks that deadline after
reading the account and again immediately before broadcast. The `granted` response contains the confirmed grant ID, account, chain,
scope salt and encoded approved scope. Deliver it only over the trusted
request channel. The holder must verify the commitments against the chain
before spending. Keep the opening out of logs and URLs.

If the outcome is uncertain, preserve the original UUID and wire packet.
With fresh credential-pinned owner approval,
`recoverAgentJubjubGrant(requestId, input, ports)` reads the chain and checks
the original issuance nonce, owner epoch, grant generation and scope.
It can recover a lost response after the request deadline while the grant
is still live. A second request with the same nonce cannot submit again.

Generated ACC tests cover issuance, a concurrent replay, response loss and
recovery, and refusal after expiry. A synthetic ledger observation checks
that a different issuance nonce cannot recover the old opening. This source preview
stages owner bookkeeping for later publication. Native agent spending,
P-256 owner composition and vault or OWS integration still need
qualification or implementation.


### Verify and use the grant as the agent

Retain the original signed request and its send time. If the request omitted
the account, pin the chosen ACC through the trusted channel before processing
the response. Give those pins, the original packet and the structured response
to `verifyAgentJubjubGrantResponse`. The SDK checks the exact requested scope,
grant ID and salted commitments against one live ACC read. Keep the returned
`issuance`, including its bigint fields, in the agent's protected store.

Pass the same request, response and retained issuance to
`spendWithAgentJubjubGrant` with the amount and previous spent total in
smallest units. Inject the agent's JubJub key provider as the `grantee` and a
value-capable pinned chain. The provider handles the private key and signs the
ACC challenge. The owner can be offline. The SDK reviews the exact payment and
rechecks the live grant, retained issuance, nonce and spent commitment before
dispatch. This preview accepts the exact requested scope.

If dispatch is uncertain, `AgentGrantSpendUnsettled` preserves the grant ID,
previous grant nonce and any acknowledged transaction hash. Reconcile those
with the original spend and the live grant before considering another payment.
The holder flow has no crash-durable dispatch journal. Generated ACC tests
cover a funded spend, per-call and total caps, revocation, wrong-key refusal
and lost responses. Native proof and vault integration remain separate.
