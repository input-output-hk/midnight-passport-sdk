# Account discovery locator experiment

[Issue #20](https://github.com/input-output-hk/midnight-passport-sdk/issues/20)
tracks discovery when a user has their passkey and has lost the account address
and the credential directory. This experiment checks a candidate locator recipe
against generated Compact code using synthetic witness bytes.

## Candidate encoding

- The proposed WebAuthn PRF salt is SHA-256 of the ASCII label
  `midnight:passport:discovery:prf:v1`. The experiment checks the salt bytes
  and supplies a synthetic 32-byte value in place of the authenticator output.
- The network is a lowercase ASCII identifier with alphanumeric segments
  separated by single hyphens. The maximum length is 32 bytes. The constructor
  takes those bytes right-padded with zeros to 32 bytes. A client would have to
  pin the canonical namespace and registry deployment together. The namespace is a constructor input.
  This fixture does not authenticate a chain identifier.
- The locator hashes four consecutive 32-byte values with SHA-256. They are the
  right-zero-padded ASCII tag `midnight:passport:locator:v1`, the network
  namespace, the raw registry address bytes and the discovery PRF output.
  Compact computes the same hash from its immutable namespace,
  `kernel.self().bytes` and a private witness.
- The probe ledger stores the locator and account address. Anyone who learns a
  locator can query it, and an observer can correlate activity under a locator
  or a public account address. Treat the PRF output as secret. Its holder can
  produce the corresponding locator witness.

## Reproduce offline

From the repository root with workspace dependencies installed:

```sh
nix develop -c bash -euc '
  mkdir -p review
  output=$(mktemp -d review/locator-probe.XXXXXXXX)
  compactc --skip-zk experiments/account-discovery/LocatorProbe.compact "$output"
  node experiments/account-discovery/probe.mjs "$output/contract/index.js"
'
```

Compact 0.35.0 and runtime 0.20.0 are the workspace pins. The probe checks
known-answer vectors, validates malformed inputs, compares the ledger key
against the host digest, and tests duplicate registration, a wrong witness,
a copied public locator as witness, and replay under a different configured namespace or registry address.
This runs generated JavaScript with simulated ledger contexts.

The experiment accepts a supplied account address. A deployable registry needs
consensus-enforced admission for an approved ACC binding and a verified owner
authorization bound to the locator, target and current record state. Compact
circuit interface compatibility alone cannot establish the callee's behavior.
A complete implementation also needs browser PRF support and custody, native
proof and atomic settlement tests, and a recovery/update policy. Use this
fixture only with synthetic values.

## Registry admission and owner authorization

A separate three-contract fixture checks registration with a deployment issuer
and a witness-free owner circuit. The registry pins the issuer and the binding
manifest, verifies an attestation over the configured namespace, registry
address, target ACC address and manifest, and checks that the address being
attested matches the actual typed call target. Compact's host and circuit
encodings agree on that comparison for the tested compiler versions. The
registry also checks the private locator witness. The account verifies the
immediate registry caller, its own address, the exact locator, the current
owner nonce and the owner signature before advancing the nonce.

The issuer is trusted to inspect the finalized deployment, including the
complete verifier roster and irreversible retirement of maintenance
authority. The fixture uses synthetic signatures and never reads finalized
state. It deliberately demonstrates that an issuer who attests a counterfeit
deployment can bypass the account-side ownership check. The issuer's
operational policy, key custody and migration strategy need review before
production use. The fixture covers initial registration. Updates, retirement,
real passkey custody and recovery remain separate.

With workspace dependencies installed, reproduce the pinned 0.35.0 offline run:

```sh
nix develop -c bash -euc '
  pnpm run build
  mkdir -p review
  output=$(mktemp -d review/discovery-admission.XXXXXXXX)
  for fixture in AdmittedAccount CounterfeitAccount AdmissionRegistry; do
    compactc "experiments/account-discovery/$fixture.compact" "$output/$fixture"
  done
  node experiments/account-discovery/admission-probe.mjs "$output"
'
```

The same fixture compiled and passed offline with Compact 0.36.1 and runtime
0.21.0. To reproduce that run, use that compiler and provide runtime 0.21.0
under the artifact directory's `node_modules`, so the probe and all generated
modules resolve the same copy. Forwarding two field coordinates across the
call boundary and reconstructing the JubJub point in the account avoids a
0.36.1 ZKIR synthesis failure for a point-typed cross-contract argument.

The pinned 0.35.0 run is historical compatibility evidence. Native
qualification of the caller requires the cross-contract entry-point binding
fix, new verifier keys, and a matching callee runtime and keys. See the
[Compact 0.36.0 release notes](https://docs.midnight.network/relnotes/compact/toolchain-0.36.0#contracts-that-make-cross-contract-calls-must-be-recompiled-and-their-keys-replaced).
Neither fixture run submits a transaction or qualifies proof settlement.

## Issuer state policy

The Node experiment in `issuer-policy.mjs` signs only for the requested account
at the pinned genesis and a canonical finalized block. The trusted indexer must
return the same block hash and height, a Ledger 9 protocol version, and the
requested account and registry addresses. Both snapshots must have an empty
maintenance committee with threshold one. The host supplies independently
reviewed single-version verifier keys for both bindings and a policy check for
the pinned registry. The probe decodes the generated registry state and checks
its issuer, namespace and account roster commitment before signing.

The commitment is SHA-256 of the UTF-8 JSON array
`["passport:discovery:roster:v1", [[name, operationSha256], …]]`.
Entry names are sorted ASCII strings. Each digest covers the complete serialized
Ledger 9 operation built from a pinned key. Compare complete operations, since
the ledger's `verifierKey` getter exposes only the latest key. Changes to the
serialization or the allowed versions require a new reviewed profile.

Run the probe with the Compact 0.36.1 and 0.35.0 fixture output directories from
the previous section, in that order:

```sh
nix develop -c node experiments/account-discovery/issuer-probe.mjs \
  review/path-to-036-output review/path-to-035-output
```

The probe uses real Ledger 9 WASM state transitions to retire the maintenance
authority and build a dual-key deployment with both verifier versions. It also
checks the issued signature against the Compact registry challenge. The node
and indexer responses are simulated. The issuer trusts their configured
endpoints for finality and state, and the fixture uses synthetic signing keys.
Native settlement, independent state verification, and production issuer
custody remain unqualified for this offline issuer probe.

### Isolated Ledger 9 qualification (source preview)

On 13 November 2026, a separate synthetic localnet run used Compact 0.36.1
caller and callee artifacts, runtime 0.21.0, and the issuer's finalized node and
indexer checks. A registration finalized at block 56. The registry record count
and the account owner-authorization count each advanced from zero to one in the
same transaction. This establishes one native atomic registration for the tested
artifacts and deployment; it does not qualify an SDK discovery flow or a public
network.

The retained deployments also supported a negative proof test. With the
canonical registry `register` proof artifacts pinned, a caller module that used
an alternate account entry point produced an unproven transaction containing
`register` and `alternate_registration`. The canonical call proved, while the
substituted call failed the proof server's `/check` step with a public transcript
input mismatch. No transaction from that negative test was submitted. Across
later finalized blocks, both complete contract state hashes, the owner nonce,
and the registry record count were unchanged. This is proof-construction
rejection, not evidence of node-side rejection of a submitted transaction.

The fixture uses synthetic keys, a trusted pinned node and indexer, and private
retained localnet state. Browser discovery and custody, production issuer
custody, independent finalized-state verification, public-network use, and a
new release remain open. The earlier #275 caller evidence predates the Compact
entry-point binding fix and needs separate qualification with patched keys.
