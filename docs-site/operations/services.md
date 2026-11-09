# Separate proof, fees, and asset funding

## Proving and submission

The Passport service accepts checked configuration, prepares/deploys supported ACC operations, runs proof jobs, and submits final transactions through injected backend ports. The proof service receives operation witness data. Protect ingress, job state, and credentials; use a trusted chain/indexer and pinned binding. A service job may outlive the browser request. Keep its original ID and reconcile its result after a timeout or restart.

## Fee sponsorship

The sponsor wallet adds **fee inputs** to eligible account transactions after policy checks. It is not the person's wallet and does not move the asset being withdrawn or deposited. The reference policy restricts eligible account calls and refuses offers or unbalanced value actions on its public route. A caller still needs the value-capable path for an asset withdrawal.

## Funding

The funding service owns a **different wallet** that sends allowed assets into an eligible deployed ACC. It requires authenticated backend access, allowlists, request/day limits, and a durable reservation keyed by the original request ID. Completed IDs can replay their result; pending/unknown IDs require reconciliation before another send. Keep its bearer token out of browser storage and bundles. The demo's local funding proxy is a bounded evaluation path, not a production authentication design.

For exact routes and configuration, use the [service source guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc8/docs/site/service.md) and [funding app guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc8/apps/passport-funding-service/README.md). [The release receipt](https://github.com/input-output-hk/midnight-passport-sdk/releases/download/sdk-v0.1.0-rc8/rc8-publication-receipt.json) identifies the published images. No SDK package installation provisions the node, proof server, fee wallet, or asset wallet.
