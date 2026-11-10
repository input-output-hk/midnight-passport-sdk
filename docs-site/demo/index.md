# Run the reference demo

The Passport DApp is a **reference application**, not an SDK prerequisite. It composes the browser SDK, a local Midnight chain/indexer, proof and fee-sponsor service, key distribution, and optional wallet-backed funding. Its screens, memory lease, review dialogs, Activity log, and wallet connection are choices made by this host.

The maintained [application setup](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc9/apps/README.md) gives the full configuration and exact service options. Use an owned evaluation environment. Installing SDK npm packages does not start that stack, create a passkey, deploy an ACC, or supply a wallet.

## Before starting

- Use Nix with flakes, Docker with at least **24 GiB memory**, about **15 GiB free disk**, and about **8 GiB RAM** for key generation. The first full 52-circuit key build can take tens of minutes.
- Provide a local checkout of the upstream Passport contract at the pinned revision `6458ed5`. Use Chrome or Safari with a passkey provider that supports the WebAuthn PRF extension; a Chrome profile-only credential is refused.
- Check that ports `19944`, `18088`, `16300`, `8787`, `8788`, and `5173` belong to the intended local stack. Preserve existing chain, key, wallet, passkey, and reservation state when resuming a run.
- Check the selected `undeployed` network, `acc-s3r1.1` binding and manifest, public service URL, RP ID, and `http://localhost:5173` origin against independently trusted configuration.

## Prepare and launch an owned local stack

From the SDK repository, run the preflight first; it checks toolchain, Docker resources, and ports without starting services:

```sh
nix develop -c pnpm demo check
```

For a fresh authorized local evaluation with the upstream contract checkout available:

```sh
PASSPORT_REPO=/path/to/passport nix develop -c pnpm demo up
```

The command exports the pinned ACC, compiles or verifies its artifacts, builds the SDK, and starts the localnet, Passport service, browser app, and key service. It reuses a verified key cache on later runs. Open `http://localhost:5173/`; check `http://127.0.0.1:8787/healthz` and `/v1/config` before the first account action. The key service listens on `127.0.0.1:8788`. `--arm jubjub` selects the PRF-derived owner route; the default is P-256. A development mock passkey is available via `--mock-passkey`, but it is not real-provider evidence.

## Optional asset funding

The fee sponsor and asset funding process are separate wallet owners. For a
concurrent browser demo, configure a **distinct, already-funded funding wallet**
using `PASSPORT_FUNDING_SEED_FILE`, plus the protected token and asset allowlist in
the [funding operations guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-funding-service/README.md).
The CLI forwards that configuration to `demo up --funding`. Funding then listens
on `127.0.0.1:8789`; its token stays server-side and deposits remain bounded.

Both processes otherwise default to the same public standalone genesis seed.
That default is for **one active wallet at a time**, as in sequential CLI
qualification. Do not co-start that shared default for this concurrent recipe.
Keep each wallet's persistent state separate; a token allowlist does not mint or
provision funds. A production ingress also needs its own authentication and limits.


The signed-out screen provides **Sign up** and **Log in**. After account access, use Passport account → Balances / Deposit / Withdraw; the separate Midnight wallet, Audit, and Settings workspaces have their own navigation. The demo shows **Powered by Lace** attribution for its Lace-inspired wallet and passkey experience. Lace remains a separate wallet/host with its own provider policy; this demo does not claim full Lace compatibility.

After the services are healthy, follow [guided scenarios](/demo/scenarios). [Signing and Activity](/demo/signing-activity) explains which behavior comes from the demo and how it records unknown outcomes. For reusable ports and exports, use [Packages and API](/packages/).
