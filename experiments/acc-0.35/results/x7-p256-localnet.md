# X7 — P-256/WebAuthn proofs on the localnet (52-circuit ACC)

2026/10/02–03, Apple M2 Max, Docker Desktop VM raised to 48 GiB (12 CPUs).
Revision `45721e1`, artefacts from the X6 full build (byte-identical to the
contract team's). Localnet from `infra/localnet` (node 2.1.0-rc.4, proof server
9.0.0-rc.8, indexer rc.6).

    experiments/acc-0.35/run.sh <contract-dir> test:p256

The contract team's on-node P-256 conformance scenario, unmodified
(`src/tests/p256-conformance.ts`). Account calls are signed by a labelled
OpenSSL software authenticator under the `wa-json134` WebAuthn profile; the
verifier probes prove a captured real WebAuthn assertion.

**Verdict: PASS** — 1,227 s wall-clock, 21 transactions accepted. Evidence:
[`x7-p256-conformance-and-proving.json`](./x7-p256-conformance-and-proving.json).

| Step | Circuit proved | Proof time (first; repeats) |
|---|---|---|
| Deploy in 10 waves, retire the authority, activate a passkey-first account | `activate_initial_device_with_p256` | 2.9 s |
| Cross-arm enrolment: P-256 adds JubJub | `add_device_with_p256` | 49.9 s |
| JubJub adds k256 | `add_device_with_jubjub` | 4.2 s |
| k256 adds P-256 | `add_device_with_k256` | 22.4 s |
| The same operation under each arm | `rotate_enc_key_with_jubjub` | 4.4 s; 3.9, 4.2 s |
| | `rotate_enc_key_with_k256` | 18.1 s; 18.8, 15.1 s |
| | `rotate_enc_key_with_p256` | 37.4 s; 30.3, 30.8 s |
| Tampered policy, argument, signature, and a stale authorisation | — | all refused locally before proving |
| A valid call after the negative probes | `rotate_enc_key_with_p256` | 30.9 s |
| Passkey-authorised grant lifecycle | `issue_grant_with_p256` | 40.5 s |
| | `revoke_grant_with_p256` | 53.7 s |
| Native P-256 verifier probe (real high-S assertion) | `verify_ecdsa` | 20.0 s; 15.6, 16.3 s |
| Complete WebAuthn verifier probe (real assertion) | `verify_webauthn` | 24.6 s; 22.9, 22.4 s |

**Memory.** The proof server used **13.5 GiB** while proving the WebAuthn
probe (a `docker stats` point observation; the scenario's own peak sampling
recorded nothing here). That is why an 8 GiB VM cannot prove these circuits.
The first attempt at this run failed before the test started: the indexer's
SPO client exits on a chain still at genesis, so `run.sh` now starts the
indexer only after the node has produced two blocks.

**Timing context.** About 1.4× the contract team's M4 Max timings (their
`rotate_enc_key_with_p256` repeat mean is 22.1 s). Proof times include key
lookup and transfer to the proof server; they exclude signing and inclusion.
