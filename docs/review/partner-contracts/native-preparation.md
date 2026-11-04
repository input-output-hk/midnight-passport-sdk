# Native merchant qualification: preparation and restart incident

This records local preparation for #275, not a native acceptance result or release.

The unchanged merchant compiled with Compact 0.35.0/runtime 0.20.0, default ZKIR v2.
Its single `pay` circuit produced a 552,574-byte prover key and 1,351-byte verifier.
The caller compiler manifest SHA-256 is
`de7dcb99a015a71219dfa404fb07c0769192f8d4bd72a521543174af00d502bd`.
The ACC remains the immutable v3 binding; five required existing proving keys were
matched against its pinned manifest. No ACC key was regenerated.

The external consumer uses the four `0.1.0-dev.20261103` candidate core packages,
with matched explicit Midnight.js/wallet dependencies and separately pinned public
reference wallet/wave helpers. All 21,661 consumer input files are privately pinned.
The reference helpers are qualification infrastructure, not new package APIs.

## Review and interruption

The first signed worker commit `cdc363b4db5cad8390200465dc8015139b754afb`
passed the full local gate. Independent Codex CLI review identified missing current
time/active grant roster, a boot salt retained only in memory, and a fixed funding
delay. The attempt was interrupted before any wallet started. Signed fix
`a880456bcd731a441eb3bf1a3bd33052e28bfe9e` supplies live roster/time, retains
constructor and grant-opening material before effects, and waits for a spendable
exact-value NIGHT UTXO. It also checks all 52 deployed verifier keys and retired
maintenance authority. Installed declaration checking and the full local gate pass;
independent review of the complete corrected worker is pending.

The first attempt retains an explicit interrupted failure, unchanged source/runtime
fingerprints and confirmed cleanup. It is not a successful run. The second attempt
failed starting the canonical indexer because port 18098 was already allocated.
It also stopped all three owned containers and released its lease. Both attempts
preserve their original private roots and every pre-existing chain/key volume.
Neither reached wallet setup, proving or a transaction submission.

## Docker boundary

After disk capacity was restored, the Docker engine still timed out. Normal Desktop
restart failed; the previously authorized exact-process recovery restored it. A
canonical indexer container then reported running with saved port declarations but
no actual network attachment/published endpoint. Canonical indexer readiness blocked
wallet setup. Reattaching the owned endpoint restored connectivity, but Desktop had
also automatically restarted the historical archived indexer, which subsequently
occupied the same host port. Stopping that pre-existing process requires owner
approval under the workspace resource rules; its container and database must remain.

Readiness must establish both **the actual owned container endpoint** and current
canonical finalized chain data. Saved `HostConfig.PortBindings`, HTTP 200, a running
process or a wallet's `isSynced` flag alone establish neither. Never use the archived
indexer as a substitute, reset the chain or remove a database to get a green result.

Native payment/recipient credit, expiry, replay/revocation, module substitution and
post-call failure remain unqualified until a fresh source-bound run succeeds. A
construction refusal is not a node rejection or evidence that a malicious proof was
submitted. Public packages, images, Pages and RC6 remain unchanged.
