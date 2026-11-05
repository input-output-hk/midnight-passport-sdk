# One approved journal operation (local candidate)

`approved-deposit.ts` is a strict public-package host composition. The candidate
recovery APIs are absent from published RC6. This adds no package or native sender.

Supply a protected `PrfKeySource`, a dedicated durable atomic `MutationByteStore`,
checked network/binding/manifest pins, a value-bearing sender wallet with original-ID
records, and read-only reconciliation/finality adapters. On Node, the service
package's `fileMutationByteStore(privateDirectory)` supplies the byte store. Browser
hosts must supply their own reviewed crash-durable encrypted-state storage policy.

Obtain host consent **before every call** for the original account/network/intent.
Call `deposit(originalRequest)` once; after uncertainty, retain the same request,
protected state/key origin and sender records, then use `resume(originalRequest)`.
A `dispatching` outcome without sender evidence remains unknown and never resends.
Never call `deposit` with a new ID to evade missing evidence or a dispatch fence.

The same source instance constructs the encrypted journal and wraps the complete
invocation. Nested journal accesses share it. A cold wrapped path uses one PRF
credential assertion with the test software authenticator; create-time outputs may
avoid that assertion. This is an API-call measurement, not a visible-prompt or real
Google/iCloud guarantee. Account discovery/creation and wallet signing are separate.

Temporary PRF material remains live across injected wallet/proof/confirmation waits
until the last session user exits. Bound those waits. Do not run unrelated requests
concurrently through one WebAuthn source or treat overlapping sessions as isolated
approval scopes. This example does not add cancellation/timeouts to the deposit API,
a lock, a longer-lived unlock cache or remote signer scope negotiation. A later
independent invocation must unlock again. The actual adapter/journal regressions
cover cleanup after success, callback failure, unknown sender and PRF refusal.

See `docs/site/shielded-deposit-recovery.md` and the candidate review map for measured
baseline counts, limits and provenance. Exact-value withdrawal rules are unchanged.
