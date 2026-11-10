# Signing choices, Activity, and Audit

The demo distinguishes three local experiences. **Verified login** can warm derived reader and wallet-seed material in page memory for a reviewed routine lifetime. **Full-owner unlock** uses a deterministic enrolled JubJub owner, but the demo still asks for fresh approval of critical operations. **Bounded transfer permission** uses a separate grant signer within an on-chain exact scope. Local expiry limits the demo's memory access; it does not change ACC ownership or revoke a grant.

Before an actual credential request, the demo combines operation purpose and key purpose in one review. Provider sheets may follow. Retries and later credential calls need a fresh review. For a critical owner transfer or sensitive export, the review shows exact intent and the demo rechecks it before dispatch/display. These are host UI policies composed with SDK hooks, not generic behavior of `PassportConnectorAPI`.

**Activity** shows progress and results. **Audit** retains public operation evidence, including cancelled or unknown outcomes. Keep original transaction and request IDs; do not equate a vanished spinner or local lock with a failed chain send. [The demo composition at the release tag](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc9/docs/site/demo-guide.md) records exact UI behavior, while [durability](/guides/durability) states the reusable host contract.

The reference application uses Lace-inspired PRF recipes and may display a Lace wallet path. Lace is a separate wallet/host; this demo does not claim complete Lace interoperability. [Host integration](/guides/hosts) explains the bridge boundary.

## Compare the source demo signing modes

The RC9 demo accepts `VITE_PASSPORT_SIGNING_MODE=passkey|jubjub` or
an explicit `?signing=passkey|jubjub` page choice. The default remains direct
P-256. Conflicting build settings refuse, and changing a page mode does not
migrate an existing account or silently select another signer.

For a new JubJub account, the same credential creation scope derives and registers
the initial PRF-derived owner. A compatible provider returning both PRF outputs
can complete that source flow with one credential API create; otherwise a
credential-pinned PRF get is additionally needed. These are software/test API-call
counts, not promises about Google/iCloud sheets or touches. P-256 retains its
required setup signatures. Later critical actions still need fresh approval.

Verified creation may warm only the explicitly reviewed routine reader/wallet
material; it does not persist a raw PRF/owner key or automatically connect a
wallet. [RC9 candidate scope](/operations/rc9-preview) distinguishes this source
increment from the current published installation.
