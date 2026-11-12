# ADR 0019 · Total-loss recovery admission and custody

Status: Proposed for [#240](https://github.com/input-output-hk/midnight-passport-sdk/issues/240).

## Binding decision

Keep the existing supported recovery routes for synced credentials and
enrolled survivors. Total-loss recovery needs a separately qualified binding.
The read-only preflight rejects `acc-s3r1.1`. Both supported initial device
arms can reactivate a dormant bootstrap after recovery on that binding.
The upstream correction passes those two cases in generated contract
execution. A new verifier roster, native proof, and migration acceptance
remain required before any production configuration can approve it.
[Binding audit](./0012-retain-binding-with-explicit-removal-and-recovery-limits.md)

## Reference flow

1. Identify the original account, network, and binding using a recovery kit
   or an independently verified resolver. Read the latest finalized recovery
   state and actual circuit-to-verifier assignments at that same block.
2. Check the host's trusted binding profile and public session metadata.
   The durable roster identifies guardian indices, contact methods and the
   threshold. Authenticate both endpoints before requesting a share. Bind
   each response to the account, network, original session and guardian
   index. Use a reviewed MIP-0022 profile for reconstruction.
3. Validate the reconstructed secret against the on-chain recovery
   commitment. Verify the unwrapped viewing key against the account's
   encryption key and secure it in the successor device's private storage.
   Prepare the successor signer and its new recovery commitment. Bind their
   exact public values to the live account, epoch, nonce and submission
   challenge. Discard the reconstructed secret before delegated proving.
4. Persist the original submission identity and exact public intent before
   any broadcast. Reconcile the original on a lost reply. While recovery
   is pending, surface its veto deadline and treat cancellation, replacement,
   or inconsistent finality as distinct outcomes. Observe chain time, then
   verify the original successor entry and commitment at finalisation.
5. Verify that the successor can authorize calls and read its verified
   holdings. Verify retirement of old entries and grants. Warn while the
   successor has no guardian backup. Publish a fresh full-roster session
   and viewing-key wrap as a separate approved operation.

The account address stays the same in this recovery flow. Verify name ownership
and reader continuity independently. A binding migration may change the
address and needs its own custody and name-control plan.
[MIP-0022](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/02fce36cfa44541305310dc25fd38f399dbe8d92/mips/mip-0022-account-recovery.md)
· [Upstream C14](https://github.com/midnightntwrk/passport/blob/8f635a10dde17d55d26bb72439a3a23e6e159295/docs/plans/components/C14-total-loss-recovery-flow.md)
· [Upstream C15](https://github.com/midnightntwrk/passport/blob/8f635a10dde17d55d26bb72439a3a23e6e159295/docs/plans/components/C15-helper-protocol.md)

## Implemented boundary

The source preview exports `reviewRecoverySession` from `account/recovery`.
It accepts a trusted profile and an injected finalized-state reader. The
reader is responsible for finality, account identity, and authenticating the
ledger and deployed verifier roster at one block. Use
`recoveryVerifierRosterDigest` over all circuit names and their exact
verifier-byte SHA-256 values. The code refuses mismatched profiles, recovery
versions, and configured limits. It reports the observed guardian-session
state or pending veto window. The elapsed phase includes the profile's
block-time tolerance and describes that one observation.

The review holds public metadata. Future ports will need authenticated helper
transport, on-device reconstruction and wrap handling, reviewed successor
authorization, and durable mutation settlement. Any effect must re-read the
current chain and bind to the original session, account and exact pending
record. There is no default supported profile or recovery transport in the
SDK today.

## Qualification to enable recovery

- Reject unauthenticated, stale, duplicate, or cross-session shares, and
  demonstrate failure below threshold. Exercise a lying guardian, ambiguous
  indices, and concurrent sessions with the reviewed reconstruction profile.
- Verify a correct successor, refusal of an invalid key or wrap, and consent
  before storage and submission. Exercise loss of a response, process restart,
  delay, cancellation, and replacement of a pending attempt.
- Run a disposable full-loss restore with no surviving authorizing device.
  Prove finality, successor access, old-device and grant refusal, verified
  shielded holdings, and a new recovery session. Obtain independent security
  review of the cryptography, transport and integration before enabling it.
