# ADR 0010: Preserve Lace hosted signer flow boundaries

Status: proposed; integration choice pending. Date: 2026-10-17.

## Problem

At Lace `502b0794cc7bcfc76342230193fef4ebb63cae1c`, structural compatibility does not
imply flow compatibility. The SDK's generic JubJub creation validates a sealed device
registration before activation and validates the settled keyring afterward. Lace's creation
session draws the keys, deploys, activates and publishes its own entries, but does not admit
`open-inbox`. Its non-rotating enrollment admits sealing to the approved joining reader but
not opening the roster. Sign-in admits inbox opening but filters device registrations.

These are deliberate signer boundaries. The four executable checks in
`experiments/lace-consumer/signer-consent.diagnostic.test.ts` reproduce them against
unmodified source. See [the consumer report](../lace-consumer-report.md) for results and pins.

## Recommended integration

Let the Lace host retain its own creation, enrollment and consent orchestration. Consume SDK
packages through the existing infrastructure seams: the pinned contract/artifact package,
key formats, prover, sponsor, key HTTP service and transaction adapter. Use the SDK account
flows where the host actually supports their operations and guarantees. A typed port must
not promise raw roster access when the signer deliberately returns filtered data.

This requires no upstream implementation changes. It also does not satisfy #81 merely by
compiling: the package-backed Lace creation and hosted device/grant operation still need real
localnet evidence, followed by both cross-product recognition directions required by #79.

### Infrastructure mapping to verify

| Lace seam | SDK fit | Required adaptation |
| --- | --- | --- |
| `FeeSponsor.balanceAndSign(bytes)` | Direct byte-level structural fit with SDK sponsor ports. | The SDK remote sponsor permits calls only to registered ACCs; Lace's direct deployment/maintenance waves need an explicitly authorised deployment sponsor. Do not weaken the fee-only endpoint to accept arbitrary deployment. |
| `PassportProver.prove/check(preimage, keyLocation, overwriteBindingInput?)` | Circuit-level; not the SDK account `Prover.proveTx` interface. | Use Lace's circuit HTTP prover with the SDK artifact HTTP service, or implement an explicit circuit-level adapter preserving `overwriteBindingInput`. A transaction prover cannot be passed here unchanged. |
| `PassportNetworkConfig.artefactUrl` | Can point at the pinned SDK key/artifact HTTP layout. | Verify Lace's manifest against SDK compiler/key hashes and test its actual loader URLs and CORS policy. Matching contract source alone is insufficient. |
| Contract generated module | Same ACC source and binding are already checked. | Keep one physical current Compact/runtime/ledger copy, and verify key manifests before deployment. |
| Account records | Lace's public observable store has a promise adapter. | Supply `toAccountRecords(store)` to flow context; a raw store returns observables where `await` expects records. Preserve pending deployment, grant bookkeeping and origin restrictions. |

This mapping exposes an additional integration task: the SDK's transaction-level remote proving
service and restricted call sponsor are not drop-in replacements for Lace's circuit proving
and wave deployment providers. The existing source check correctly proves structural sponsor
compatibility, but does not prove that deployment policy authorises Lace's transactions.

## Alternatives requiring additional design

1. **Phase SDK creation across consent sessions.** Generate and publish within creation, then
   validate the live envelope in sign-in. Keep the directory pending until validation succeeds;
   pin account, network, binding, device key and encryption key across sessions. Resume must
   retain the original lock choice and never draw replacement account keys. Registration
   validation still needs a trusted key-origin guarantee because sign-in hides registrations.
   Moving only the existing `openInbox` call is insufficient.
2. **Add an explicit key-origin validation operation.** Return a narrowly scoped success result
   bound to account, network, encryption key and local device, without exposing the viewing
   secret or the full roster. This needs Lace owner review and an upstream implementation.
   The SDK cannot synthesize that guarantee from a filtered `null` response.

## Invariants

- Never map one consent kind to a different kind to obtain more permissions.
- Never add `devices` to a non-rotating enrollment merely to obtain rotation permissions:
  Lace binds that descriptor to a real rotation before sealing the joining device's key.
- Never treat `openInbox(..., [])` as evidence of key possession. The remote transport can
  complete it without contacting the signer. The SDK now requests a real sealed entry.
- Validate live membership, binding/network pins and envelope/key consistency before returning
  a usable SDK account. Preserve a recoverable pending record after interrupted publication.
- Keep raw PRF outputs, reader secrets and viewing secrets inside their key origin.
- An integration failure must not be fixed by relaxing the exact-value shielded-spend guard.

## Acceptance plan

| Requirement | Required evidence |
| --- | --- |
| Package-backed Lace creation | Unmodified Lace flows and hosted signer; hash-verified installed SDK tarballs; deployed ACC and activation/publication transactions on `undeployed`. |
| SDK account recognised by Lace | SDK-created JubJub ACC and completed `signIn` using Lace's promise account-record adapter, not its observable store directly; same credential, network and binding. |
| Lace account recognised by SDK | Lace-created JubJub ACC; SDK `openAccount` through a compatible local/key-origin port; live entry and envelope validation. Address-only opening has a stronger registration requirement and needs its own evidence. |
| Hosted mutation | One device or grant flow under its exact consent descriptor using unmodified signer handlers; confirmed transaction and subsequent ledger read. |
| Installation | Nine tarballs; expected physical Compact/ledger identities; entrypoint/type/browser build checks and artifact hash verification. |

A simulated window transport and synthetic PRF are acceptable protocol-test inputs only when
explicitly labelled. They do not prove a deployed signer page or real-provider browser ceremony.
No patched-signer experiment counts as unmodified hosted acceptance.
