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
