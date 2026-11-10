# Authenticate, obtain consent, and sign

These are three separate decisions:

1. **Authentication** establishes that the host can use an enrolled passkey or reader path for this account.
2. **Consent** is the person's approval of the actual operation, including exact amount, asset, destination, authority route, and credential purpose when relevant.
3. **On-chain authority** is what the ACC accepts: an enrolled P-256 or full-owner JubJub key, or a live grant with matching scope.

A passkey's **P-256 signature** is an assertion the ACC can verify for the supported owner path. Its **pseudorandom function (PRF) output** is secret derivation input for a separate JubJub owner, reader, or wallet-seed recipe. A successful PRF request is not a P-256 signature or spending consent. The provider and RP/origin policy affect which path is available.

The RC9 `account/authorisation` contracts and `passkey.beforeCeremony` hook let a host review each actual credential call. Capture immutable intent, show it before the call, and recheck it before dispatch. A recognized retry is another credential request and needs a fresh decision. For owner withdrawal and sensitive opening export, use fresh credential-pinned approval. The demo's combined review and bounded memory lease are [demo policy](/demo/signing-activity), not an automatic SDK session.

An enrolled **full-owner JubJub key** has durable on-chain owner authority. A **bounded grant signer** is a different child key constrained by the issued grant. Locking or expiring a local session only removes local use of a key; it does not revoke a chain owner or grant. Revocation must be confirmed on-chain. Unknown or stale grant scope must not silently fall back to an owner send.

For methods and errors, use the [public API map](/packages/api). For key custody, use [Keys and wallets](/architecture/keys-wallets).
