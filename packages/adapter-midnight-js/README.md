# Midnight adapter

`createMidnightChain` implements the account package's `Chain` port with midnight-js 5. It accepts
an account binding, a pinned `NetworkConfig`, and separate transaction-level `Prover`, `FeeSponsor`
and `Submitter` ports. Hosts may provide their own implementations or use the HTTP clients in
`adapter-service`. The sponsor's public coin and encryption keys are required because midnight-js
asks its wallet provider for them while assembling a call.

The Passport service's remote sponsor is fee-only. Its policy rejects shielded offers, including
an ACC withdrawal that sends a shielded coin to a user. For `withdrawShielded`, supply a
value-capable wallet implementation of `FeeSponsor.balanceAndSign` and `Submitter.submit`, with
that wallet's public coin and encryption keys. The same `createMidnightChain` adapter and remote
prover can be used; the wallet must balance and submit the resulting transaction. The
`experiments/acc-0.35/sdk-p256-shielded-withdraw-node.mjs` localnet probe shows this composition.

Load this package after the lightweight account core:

```ts
const { createMidnightChain } = await import('@input-output-hk/mn-passport-adapter-midnight-js');
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
