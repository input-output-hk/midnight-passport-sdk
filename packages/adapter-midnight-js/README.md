# Midnight adapter

`createMidnightChain` implements the account package's `Chain` port with midnight-js 5. It accepts
an account binding, a pinned `NetworkConfig`, and separate transaction-level `Prover`, `FeeSponsor`
and `Submitter` ports. Hosts may provide their own implementations or use the HTTP clients in
`adapter-service`. The sponsor's public coin and encryption keys are required because midnight-js
asks its wallet provider for them while assembling a call.

Load this package after the lightweight account core:

```ts
const { createMidnightChain } = await import('@midnight-ntwrk/mn-passport-adapter-midnight-js');
const chain = createMidnightChain({
  network, // build-time pinned manifest SHA-256 and network URLs
  binding, // generated ACC module, loaded separately
  prover,
  sponsor,
  sponsorKeys,
  submitter,
});
```

The adapter sets midnight-js's network id before each ledger read and call. A host that operates
multiple Midnight networks in one JavaScript process must serialize operations across networks,
because the underlying midnight-js setting is process-wide.

The browser adapter keeps `createServiceChain` and `delegatedProvingProvider` for the prototype demo
until its composition root switches to this chain. New hosts should use the port-based chain. The
service's `/prove-tx` endpoint is represented by `remoteProver`; the older per-circuit `/prove` and
`/check` endpoints are not part of the new chain API.
