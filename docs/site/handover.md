---
layout: default
title: Engineering handover
permalink: /handover/
---

## Scope and status

This handover describes the source branch that adds **localnet NIGHT funding** to the Passport ACC demo. It is an unreleased change on top of `passport-acc-prototype`; the published `0.1.0-rc4` SDK packages and `0.1.0-rc2` funding image do not contain this NIGHT preparation path. Do not infer production or Lace compatibility from the localnet run. The pinned ACC is `acc-s3r1.1`, exported from Passport revision `6458ed5`, with manifest SHA-256 `77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f`.

The person who opened an ACC in the demo has confirmed that the **Fund Passport account** button credits it. A node-backed local run also returned a preparation transaction, deposit transaction, and increased ACC NIGHT balance. Replaying its completed request ID returned the same transactions and balance without a second deposit. This is live localnet evidence in addition to the automated checks; it does not cover other networks or wallet versions.

## The value path

1. The browser on `http://localhost:5173` creates or opens an ACC with a passkey. The passkey controls ACC authorisation and the sealed viewing secret. The separately derived built-in HD wallet is read-only in this demo and does not supply the deposited NIGHT.
2. With `demo up --funding`, the page reads the offered assets and ACC unshielded balances through `GET /v1/demo/funding` on the Passport service (`127.0.0.1:8787`). It defaults to NIGHT when the policy offers it. Balances and fixed deposit amounts are displayed in **smallest units**.
3. Clicking **Fund Passport account** sends the ACC address, selected asset color and a browser-held UUID to `POST /v1/demo/funding`. This localnet-only proxy checks the demo origin and deployed-account log, then adds the private bearer token and fixed policy amount server-side. The browser never receives the funding seed or token.
4. The separate funding process (`127.0.0.1:8789`) checks the request pin, bearer token, deployed ACC, and asset limits. It durably reserves the request ID before touching its wallet. Its wallet backend checks ACC `spec_version = 3` and reads the pre-deposit balance.
5. For localnet NIGHT, the funding wallet makes an exact-value self-transfer to create an input without a change output. It then invokes the pinned ACC's `deposit_unshielded` with that value, submits the transaction, and polls the ACC ledger until the balance rises by at least the requested amount. The response includes the deposit transaction ID, optional preparation transaction ID, and confirmed ACC balance. The page refreshes NIGHT and test-token balances and records the public request/response timeline in **Operation trace**.

The preparation is needed because the pinned node rejected a NIGHT deposit with a wallet-generated change output under its fee budget. The funding process uses a separate wallet instance; on the standalone `undeployed` network its default seed is the **public genesis development seed** also used by the sponsor. Other networks require an explicitly provisioned dedicated funding seed, and NIGHT is refused there until separately qualified. The fee sponsor endpoint continues to reject value-bearing calls.

## Run and inspect

Follow [AGENTS.md](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/AGENTS.md) for Nix, Docker memory, the pinned contract export, and the localnet ports. Create a private bearer-token file and asset policy using the [funding service guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-funding-service/README.md). Then run:

```sh
export PASSPORT_FUNDING_TOKEN_FILE=$HOME/.midnight-passport/funding-token
export PASSPORT_FUNDING_ASSETS_FILE=$HOME/.midnight-passport/funding-assets.json
nix develop -c node scripts/demo.mjs up --funding
```

Open `http://localhost:5173/` (the passkey origin matters), create or reopen an ACC, and use the funding button. The `8789` root path is not a UI; use `/healthz` for readiness. The funding API is authenticated. Expand **Operation trace (requests and responses)** and use **Copy full log** for a colleague-facing record. It includes action stages, connector events, request/response metadata, account and wallet addresses, deposit ID, preparation ID and balances; it excludes raw passkey results, PRF output, viewing secrets, wallet seeds and bearer tokens. The trace begins at page load, so repeat the flow in one session if the complete sequence is needed. `node scripts/demo.mjs fund --help` documents the operator CLI.

Keep the funding token, asset policy, reservation file, wallet state, and deployment log outside the repository. The default single-host reservation file is `~/.midnight-passport/funding-reservations.json`. A successful request ID returns its recorded result on replay. An uncertain request stays **pending** and returns HTTP 409 on replay. An operator must compare the request, wallet transactions and ACC ledger before deciding how to repair the reservation; the reference store has no automated reconciliation command. Do not switch to a new UUID merely to bypass a pending result. A stale `.lock` directory also requires inspection before removal. Multiple replicas need a transactional store.

## Audit findings and follow-up

| Area | Reviewed state | Follow-up |
| --- | --- | --- |
| Fund safety | The browser cannot choose an arbitrary amount or target outside the demo deployment log. The funding route enforces asset request/day caps and stores reservations before wallet calls. Completed IDs are idempotent. | Build an operator reconciliation tool before production use. A failed or unconfirmed wallet call can leave a reservation pending. |
| Confirmation | The backend waits for the ACC balance to increase and returns transaction IDs. The exact-value localnet NIGHT path has node-backed evidence. | Correlate a finalised deposit receipt with the credit for multi-sender deployments; a balance increase alone could come from another concurrent sender. Qualify NIGHT separately on each target network. |
| Secrets and exposure | The browser proxy is localnet/loopback only and keeps the token server-side. The funding route requires a bearer token. | Add authenticated ingress, TLS, rate limits, spending controls, secret management and monitoring for a shared environment. The current demo proxy is not a production API. |
| SDK and deployment | The reusable funding route, typed client and wallet backend are packaged; the NIGHT preparation is in the demo funding application. The published funding image predates it. | Review a new signed image build and mounted-tree node run before publishing this behavior. Pin its digest. No package release is implied by this handover. |
| Browser evidence | The UI shows unshielded ACC NIGHT and test-token balances in smallest units. It shows a confirmed deposit and exports the public operation trace. | Add an automated node-backed NIGHT end-to-end test when the CI environment can supply a pinned localnet and proving keys. The current focused test mocks the wallet preparation. |

The audit found no concrete fund-loss issue in the observed localnet path. Its proof is limited to the pinned localnet, the tested ACC and wallet, and the executed checks. Shielded transfers, partial spends, full Lace interoperability, and non-localnet NIGHT funding remain outside this demonstration. See the [problem statement]({{ '/problems/' | relative_url }}) and [release notes]({{ '/release-notes-rc4/' | relative_url }}) for the wider SDK status.
