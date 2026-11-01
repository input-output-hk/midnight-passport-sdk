# Public-host native orchestration — 2026/11/01

Refs #81 / #231. Local follow-up to merged PR #256; RC6 package/image bytes are unchanged.

## Measured baseline

Clean GPG/DCO/Assisted-by source `dd5034eafac8ef3103059b7b436bf66cd73a8386` passed
all **14 cases** in **486,575 ms** (outer suite 488,535 ms). The actual public
`@laceio/sdk@0.1.2-canary.2` module created and activated an ACC, deposited seven
smallest NIGHT units, issued a bounded JubJub read grant, rotated/sealed its viewing
key, reconnected, and revoked the grant. Actual installed SDK `0.1.0-rc6` reopened
that account, verified the same holding/grant, opened the grantee capability and
recovered original-reader bookkeeping. Revocation preserved the holding and refused
the historical seal against the fresh key. An unrelated reader was refused.

Sixteen proof responses, eighteen fee sponsorships plus the helper's deposit, and
**nineteen successful contract transactions** were observed. Independent GraphQL
status/segment/ACC checks and node block hashes bind all nineteen transactions to
canonical finalized blocks. The source fingerprints matched before/after, all
installed consumer bytes and compiled fixture bytes matched, and all three owned
containers stopped; volumes and failed runs remain intact.

| Evidence | Purpose |
| --- | --- |
| [qualification-summary.json](qualification-summary.json) | Exact signed source, native source-file and receipt SHA-256 hashes |
| [suite-receipt.json](suite-receipt.json) | Outer signed-source qualification result and captured-output digest |
| [parent-receipt.json](parent-receipt.json) | Fourteen cases, runtime/binding/consumer pins, proof metadata, canonical finality and cleanup |
| [node-capacity.json](node-capacity.json) | Three distinct blocks with user-transaction weight headroom before wallet startup |
| [balanced-transaction-manifest.json](balanced-transaction-manifest.json) | Public hashes/IDs/TTLs/node costs of eighteen retained fee-balanced transactions; no bodies |

The immutable RC6 artifacts came from source `7848d3029de753727bb376e8dd90ca05cd132b55`.
Binding is `acc-s3r1.1`, compiler manifest SHA-256
`77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f`.
The public host archive SHA-256 is
`97a8ddeef426e0245093e8be615ec523db9c8a5693a94d7e34fb61f9f29e4cb5`.
The external retained consumer config pin is in the receipt; its private root/lock
and authenticated package access stay with the operator. No private Lace source
implementation was imported or patched.

## Review map

- `scripts/qualify-published-native-host.mjs`: opt-in/fresh-output/owned-stack guards,
  pinned consumer compilation, bounded child process control, source/byte checks,
  independent canonical transaction finality, receipt and exact-ID cleanup.
- `tests/fixtures/published-native-host-bootstrap.js`: synthetic PRF identity,
  verified key HTTP service, sealed private record history, three-block capacity
  readiness, pre-submit private transaction retention and live weight checks.
- `tests/fixtures/published-native-host.ts`: public module actions and the fourteen
  native cases. SDK transaction ports refuse every mutation; the public host owns
  the transactions. `docs/examples/jubjub-grant-scope.ts` checks modern grant records.
- `tests/published-native-host.test.mjs`: resource/input/result/finality refusals and
  real process/filesystem lease regressions, without native proofs or wallets.
- `scripts/qualification/native-lease.mjs`: stable private user lease directory.
  Nix changes `TMPDIR` per shell; a temporary-directory lease would not serialize
  two shells. The follow-up fixes this and verifies exclusive acquisition by two
  actual Node processes with different `TMPDIR`s, plus unsafe-directory refusals.

The measured native baseline predates this lease follow-up. The native core and
bootstrap bytes remain exactly those in the source-file map. The final parent lease
change has separate fast/process evidence; it is not relabelled as another full
native execution at the final documentation commit.

## Findings and retained failures

Earlier fresh attempts remain failed and private. Harness fixes supplied the public
feature provider, observed asynchronous action acceptance, used the actual ledger
runtime for transaction capture, distinguished 33-byte intent IDs from 32-byte
transaction hashes, and supplied the read grant's explicit RP ID.

A retained node can be canonical and freshly indexed while mandatory session work
exhausts block capacity after downtime. A deployment was admitted promptly but
excluded until TTL expiry. Read-only observation showed mandatory weight
2,022,693,531,255 against max block 2,000,000,000,000. Waiting for real capacity
recovery resolved it; TTL was not extended. The node's
[pinned dispatch weight implementation](https://github.com/midnightntwrk/midnight-node/blob/1b2b31c714f8986a082b8690f15e805981c771dd/pallets/midnight/src/lib.rs#L635)
adds the configured overhead to runtime transaction cost.

One failed suite stopped after a successful deposit because of the ID-width guard.
Read-only reconciliation confirmed its eight canonical transactions and one
contract-owned output; its deposit was never retried. Missing application records
or a failed suite do not prove no send. Raw logs, synthetic secrets, transaction
bodies and sealed records remain private; the Vault retains sanitized failure
receipts and reconciliation evidence without reclassifying them as passes.

## Limits and reproduction

See [the consumer guide](../../site/consumer-integration.md#public-package-native-orchestration-lane)
and `pnpm qualify plan consumer-host-native`. Use verified installed RC6/host inputs,
a fresh private native root, existing checked keys and the stopped dedicated stack.
Never reset the ledger, replay failed outputs, share the genesis wallet or clear a
stale lease without inspecting its owner. There was no key regeneration.

This qualifies the measured public-host/SDK read interoperability subset with
synthetic PRF credentials on the retained localnet. It does not qualify hosted SDK
mutations, a signer page or real provider, ordinary-wallet/module mixing, P-256 or
secp256k1 grantee flows in this lane, production images, partial shielded spends,
compromised-identity recovery, total-loss recovery or full Lace compatibility.
Existing consent and exact-value guards remain. No new release or issue closure.
