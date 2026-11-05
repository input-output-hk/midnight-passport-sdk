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
a second independent review of the complete corrected worker found one remaining
coverage gap: the wrong-caller check also needs the wrong merchant's state. The
follow-up snapshots full serialized state for the ACC and both merchants. Final review of that correction and the endpoint guard at
`5b68dd8bf9ab9e7a8d8635ac5a30d2e0e61fb227` found no actionable regression;
the targeted guard suite passed 13 cases. The final full local gate passed
**1,123 TAP tests / seven existing skips / zero failures**, plus the other required
script/type gates. [Verification](native-verification.json) preserves the measured source.

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
occupied the same host port. The owner chose to leave that archived indexer running
and finish local preparation. Its container and database remain untouched; native
execution is deferred and the prepared third attempt must not start automatically.

Readiness must establish both **the actual owned container endpoint** and current
canonical finalized chain data. Saved `HostConfig.PortBindings`, HTTP 200, a running
process or a wallet's `isSynced` flag alone establish neither. Never use the archived
indexer as a substitute, reset the chain or remove a database to get a green result.

Native payment/recipient credit, expiry, replay/revocation, module substitution and
post-call failure remain unqualified until a fresh source-bound run succeeds. A
construction refusal is not a node rejection or evidence that a malicious proof was
submitted. Public packages, images, Pages and RC6 remain unchanged.

## Local preparation finished — 2026-11-04

The owner decision resolves the resource question: leave the archived indexer
running. The local implementation, independent review corrections, caller artifacts,
installed consumer, source/input pins and retained failure receipts are prepared.
All commits carry verified GPG signatures, DCO sign-off and the assistance trailer.
The Obsidian checkpoint identifies the private prepared run and recovery bundle.

No qualification wallet, proof or transaction started in either failed preflight.
All three run-owned containers stopped, the stable lease was released and owned
review worktrees were removed. All state volumes and failed/unknown fixtures remain.
The third attempt is prepared only. Before future live qualification, resolve the
port conflict under an explicit operator decision, then revalidate the current
signed source, input hashes, resource ownership, canonical readiness and capacity.
A new source identity must be recorded if the checkout changes. Do not reuse an old
run output, reset the chain or replay an uncertain intent.

Local preparation is finished; #275's native acceptance and the broader goal remain
incomplete. There is no new release, package publication, image or published Pages
update from this work.


## Owner resumed execution — 2026-11-05

The owner superseded the shared-stack reservation and authorized proceeding. A new
consumer at signed sourcea6f4df6audited4candidate packages/304files, replayed its
lock offline and pinned21,852inputs. The first new preflight safely refused a
detached canonical indexer; only that stopped owned endpoint was reattached, with
container/image/volume identities preserved. Epoch catch-up reached zero and three
capacity blocks passed before wallets started.

The next attempt deployed/activated the full ACC, then timed out waiting for its
live wallet to expose an exact12-unit NIGHT self-transfer. Wallets and owned
containers stopped cleanly. Original transaction
`df2af397821615276fb196d9c447c1cad0b466672552e3f7c6078f4cded825c3`
was independently found SUCCESS in canonical finalized block22580; a fresh read-only
wallet view found its12-unit output available. No second transfer was submitted.
This establishes funding reconciliation, not merchant payment acceptance.

The revised fixture pins that original transfer, confirms canonical success and
matches its exact output in a fresh wallet before any new deployment. It does not
resplit, replay a send, clear an uncertain pending record or substitute another
coin. All earlier failed/prepared roots stay immutable. Final native acceptance
and exact reviewed source will be recorded separately after the full run succeeds.
