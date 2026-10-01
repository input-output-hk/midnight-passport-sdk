# X5 — the caller-pin conformance scenario, from the packaged artefacts

2026/10/02. Localnet: [`infra/localnet`](../../../infra/localnet), fresh volumes.
Node `system_version` `2.1.0-1b2b31c7`, proof server `/version` `9.0.0-rc.8`,
indexer `4.4.0-rc.6`; image digests equal to the contract team's 0.35.0
verification (`sha256:9040c346…`, `sha256:2666c7bd…`, `sha256:ecfec6a2…`).

**Setup.** The contract team's on-node test `src/tests/grants-caller.ts` at
`a51e2c4`, unmodified, with its `contracts/managed/account` replaced by:

- the X4 package contents (module, types, contract info, compiler manifest,
  ZKIR, verifier keys) — exactly what an npm consumer receives; plus
- the X1 prover keys linked in as an overlay, standing in for a separate
  prover-key bundle verified by the same manifest.

Helper contracts (`control`, `faucet`, and the test-only forwarding contract
`probe-grant-caller`, the last on the default ZKIR encoding as the scenario
requires) were compiled with the same Nix toolchain.

**Verdict: PASS** — 542 s wall-clock. Evidence: [`x5-conformance.json`](./x5-conformance.json).

| Step | Outcome |
|---|---|
| Deploy in waves from the package's verifier keys | 7 waves (6, 6, 5, 6, 5, 6, 2 circuits; 5,778–14,742 verifier bytes each); the last wave retires the maintenance authority |
| Mint, deposit | accepted |
| Issue a grant pinned to contract B | accepted |
| Direct call to the pinned grant | refused locally: `grant requires a contract caller` |
| Call through the wrong contract A | refused locally: `grant caller mismatch` |
| B → account | accepted |
| A → B → account (the account observes B) | accepted |
| Replay through B | refused locally |
| Fabricated caller context with a real proof | refused at the node, RPC error 104 |
| Revoke, reissue unrestricted, direct call | all accepted |

**What this shows.** A consumer that has only the npm package plus a separate
prover-key bundle can deploy, activate, and operate the 0.35.0 ACC — including
the `kernel.caller()` grant pins — with midnight-js 5's manifest verification
on. The package boundary of FS-0.9 D-3/D-4 holds end to end.

**Not shown.** The shielded and k256 caller-pinned compositions (offline only
upstream too); browser loading; key regeneration instead of the bundle.
