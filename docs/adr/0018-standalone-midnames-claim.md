# ADR 0018: Standalone Midnames claim ownership and sponsorship

Status: proposed for #316. Applies to the standalone `undeployed` registry
profile `standalone-0.35`, Midnames SDK 2.1.0, and ACC binding `acc-s3r1.1`.

## Context

The demo can retain and reconcile a sponsor fixture's original registration.
The account name port resolves an operation-specific target. A claim belongs
to host composition because it also needs owner custody, proof generation,
sponsor payment policy, and durable transaction admission.

In the pinned registry, `create_domain` uses the `domainSecretKey` witness to
derive the published `midnight.domains` commitment. The local fixture uses a
synthetic witness in its controlled proof environment. The proof requires the
witness and the public registry state. Passing the witness or its unproved
transcript to a separate sponsor would give that service
material used to control the name.

## Proposed boundary

1. The browser opens or activates the existing ACC. It reads the configured
   registry and the intended contract target, and displays the name, network,
   registry, ACC, sponsor and quoted registry price before authorization.
2. The owner environment holds a distinct naming secret and proves the exact
   registry call. Evaluate a host-controlled local prover first. The host must
   document how the naming secret is recovered and rotated independently of the
   ACC's viewing secret and any built-in wallet seed. A public commitment,
   finalized proof and public receipt may cross the owner boundary.
3. The sponsor verifies the proved call and applies a bounded policy for both
   the registry payment and fees. The browser explicitly authorizes the
   sponsor route. The service must refuse changes to the name, owner, registry,
   target, network, or price. Sponsor failure leaves the reviewed request
   unresolved or refused according to its known admission state.
4. The sponsor prepares without broadcasting. The browser retains the exact
   public receipt before authorizing dispatch. A durable server-side fence
   identifies the same original transaction across tabs, retries and restarts.
   A lost response reconciles by original identifiers. An empty registry or
   indexer read cannot clear an uncertain dispatch. Only successful original
   transaction evidence plus the matching current record yields registered
   status.

The SDK name port stays read-only. The standalone browser preflight accepts
ASCII single-label `.night` names and uses a verifier-checked snapshot.
Labels remain available to other claimants until registration, and a retained
receipt takes precedence over a fresh availability check.

## Proof and acceptance before enabling submission

- Establish that an owner-proved Ledger 9 call can be balanced and sponsored
  under this profile without disclosing the witness or altering the reviewed
  call. Independently check the owner commitment and ACC target in the final
  bytes. Qualify the positive-price path and its two-DUST admission behavior.
- Exercise a lost response at every write boundary, a conflicting claim from
  another tab or credential, registry repointing, unavailable or depleted
  sponsorship, and restart after the original submission. Verify one dispatch
  and no replacement while the original outcome is uncertain.
- Verify how a surviving key origin restores the same naming authority.
  Total-loss continuity remains a distinct recovery requirement under #240.
- Qualify other networks and public namespace ownership under #315 and #247.

## Local preparation fixture

The separate-process native preparation passed on local commit `72c9fbb`.
It balanced a one-DUST claim and retained the exact receipt with zero claim
broadcasts. Earlier native receipts cover the paid claim and browser recovery
using the previous sponsor fixture.

The standalone fixture passes serialized Ledger 9 proof bytes to the wallet
balancing adapter. Admission checks the exact registry, root name, owner
commitment, ACC target and NIGHT charge to the live parent registry recipient.
After balancing, the fixture compares the original proof and communication
commitment with the finalized call, then retains public receipt identifiers
and the hash of the finalized bytes. The owner process generates the naming
witness and uses the isolated local prover. It returns only the public owner
commitment and proved bytes. The quoted NIGHT output accompanies the call in
the owner-proved offer. Its segment must match the execution phase of the
registry transcript, and that phase stays pinned during balancing. The sponsor
supplies the wallet inputs and fees.
The reference Node journal stores the finalized bytes and public receipt
together. The sponsor must verify current policy and exact transaction
identifiers, then durably create the dispatch fence before calling the node.
Concurrent dispatch requests compete for the same fence. Once the fence
exists, the original receipt stays pending until chain reconciliation, even
if the submit response is lost. An opt-in loopback handler accepts an explicit
browser acknowledgement for its one prepared receipt. Fee ceilings, two-DUST
native admission, and browser proof preparation remain qualification work.
