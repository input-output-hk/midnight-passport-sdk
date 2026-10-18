# Demo script

> The current sealed-account flow is described below. For environment setup, NIGHT funding and
> verified handover status, use the [engineering handover](../site/handover.md) and
> [AGENTS.md](../../AGENTS.md).

A script for presenting the Passport DApp prototype. It describes the page by its actions, because
the layout may change. The actions are **Create account**, **Open with passkey**,
**Rotate sealed viewing key**, **Connect built-in wallet** and **Copy evidence**.

Allow time for ten deployment waves, activation, sealed-key publication and any rotations;
localnet proof time varies by host.

## Prerequisites

Set up the stack as [`apps/README.md`](../../apps/README.md) describes: Nix, Docker with at least
24 GiB of memory, and the compiled ACC artefacts. Then:

1. Start the stack with `pnpm prototype:up`. It starts the localnet, the service and the page, and
   stops them on Ctrl-C.
2. Check that the service answers: `curl -s http://127.0.0.1:8787/config`.
3. Open **`http://localhost:5173`** in Chrome, not `127.0.0.1`. The passkey is bound to the origin.
4. Have a platform passkey provider with PRF ready: Google Password Manager or iCloud Keychain. See
   [Passkey provider advice](#passkey-provider-advice).
5. Optional but wise: do a dry run with the mock first ([Mock mode](#mock-mode)). It shows any
   problem with the stack before an audience does.

If the chain was reset since the last run, delete `~/.midnight-passport/registry.json` and
`registry.deployments.json` first.

## Open a known ACC by address

To demonstrate opening without a directory hint, copy the ACC address from the account card or
evidence JSON, reload the page, paste it into **Known Passport ACC address**, and choose **Open by
ACC address**. Select a passkey already enrolled in that ACC. The flow checks its live device entry
and sealed viewing key against the chain, then reads the ACC state and balances. The address alone
does not grant access, and this action cannot find an unknown address or recover a lost passkey.
The operation trace records the requested and verified public addresses. The underlying SDK flow
does not read a directory hint; its account-package tests cover opening when that hint is absent.
After either open action, **Refresh ACC state** rereads the live ACC counters and, when the
funding process is available, the unshielded balances. It does not ask for a passkey.

## Optional ACC funding demonstration

To run the separate funding wallet with the demo, prepare the private token and asset policy as
described in the [funding service guide](../../apps/passport-funding-service/README.md). The
wallet must already hold each allowlisted asset. The localnet genesis wallet holds NIGHT; a
separate test token must be minted to it before it can be offered. Start the local demo with:

```sh
export PASSPORT_FUNDING_TOKEN_FILE=$HOME/.midnight-passport/funding-token
export PASSPORT_FUNDING_ASSETS_FILE=$HOME/.midnight-passport/funding-assets.json
nix develop -c node scripts/demo.mjs up --funding
```

After creating or opening an ACC in the page, use **Fund Passport account** in Actions. The button
deposits up to 10 smallest units of the selected allowlisted asset from the separate localnet funding
wallet. A NIGHT deposit first splits an exact-value UTXO in the funding wallet, then calls the ACC's
`deposit_unshielded` circuit; this transaction shape passed the pinned localnet's cost check and a
live 10-unit deposit increased the ACC NIGHT balance from 0 to 10. It appears only when the demo was
started with `--funding` and is enabled only while an ACC
is open. The account card reads the ACC's unshielded NIGHT and test-token balances separately, and
shows the confirmed transaction. For NIGHT, the response and copied operation log also include
the wallet self-transfer transaction ID. The browser never receives
the funding wallet seed or bearer token. The browser keeps the same request ID for each asset after
an uncertain result. A completed request replays its recorded result; a pending request returns 409
and needs operator reconciliation before any new attempt. The button is localnet-only and does not fund the read-only built-in HD
wallet.

The operator CLI remains available. Use the account address from the evidence panel and the color
from the asset policy. Keep the same UUID when retrying a request so the service returns its
recorded result without paying twice.

```sh
nix develop -c node scripts/demo.mjs fund \
  --account '<64-hex ACC address>' \
  --color '<64-hex asset color>' \
  --amount 10 \
  --request-id '12345678-1234-4234-9234-123456789abc'
```

The command prints the transaction ID and confirmed ACC balance. The funding service listens on
`127.0.0.1:8789` and stops with the demo. The Passport service owns a localnet-only browser route
at `/v1/demo/funding`; it reads the token file on the server and forwards a fixed-size deposit to
the separate funding service.

## Optional owner withdrawal demonstration

After the ACC holds an unshielded asset, enter an explicit destination in **Recipient unshielded
Midnight address** and choose **Withdraw from Passport account**. Use a full `mn_addr_…` address on
the demo's network; a raw hex key or an address from another network is refused. The page defaults
to one smallest unit, reads a fresh ACC balance, rejects an amount above it, and shows the network,
ACC, asset color, amount and destination in a confirmation dialog before passkey consent. The SDK
owner flow signs and submits the pinned withdrawal circuit. The page then shows its transaction ID
and rereads the ACC balance. It does not construct a transfer transaction itself.
A [node-backed P-256 probe](../../experiments/acc-0.35/results/sdk-p256-unshielded-withdraw-node.json)
used a fresh localnet ACC, deposited ten smallest NIGHT units, withdrew four to the public genesis
wallet and verified that six remained. The browser confirmation still needs a manual passkey run.

For a controlled round trip, use an unshielded address from a wallet you control and inspect that
wallet's balance after confirmation. The demo's passkey-derived built-in wallet can show its address
and balances but is read-only; it cannot send a received asset from this page. A failed or uncertain
submission does not establish that funds stayed in the ACC. Check the ACC, transaction and recipient
on the live chain before submitting again.

## Shielded holdings inspection

After a shielded deposit into the ACC, choose **Read shielded holdings**. The page unlocks the
sealed viewing key with the enrolled passkey, opens inbox coin descriptions, and checks each coin
against the indexer's successful ACC output event and exact Merkle index. It also checks the
successful ACC input events for the coin's spend nullifier. Only coins that pass these checks appear with their
color, smallest-unit value and inbox position. A forged inbox entry, an output for another ACC,
or an already-spent coin does not appear. If the indexer cannot prove a unique output position or
cannot supply current spend state, the read fails. Reopen or refresh the ACC to clear a displayed
snapshot and read again. The funding button deposits **unshielded** assets and will not populate
this panel. The page and evidence omit viewing secrets, coin nonces and PRF values.

## Add a second sealed device

Use two browser profiles at `http://localhost:5173`. In the joining profile, paste the existing
ACC address into **Open by ACC address** and choose **Prepare joining device**. It creates a new
passkey and displays a public handoff JSON document and fingerprint. Copy that document into the
owner profile's **Joining device public handoff JSON** field. Read the live device roster, choose
**Enroll joining device**, and compare the fingerprint on both screens before owner passkey
consent. The demo checks the network, binding, ACC, authoriser arm and P-256 policy before signing.
It reports the enrollment transaction and confirms the new commitment in the ACC roster. The
joining profile can then use **Open by ACC address** with its newly created passkey. The handoff
never contains a private passkey, PRF output, viewing secret or wallet seed.

If the owner sees an interrupted publication, reread the roster and try opening from the joining
profile. A confirmed ACC entry plus successful sealed-key opening establishes enrollment. If the
entry is absent, use the same public handoff for a reviewed retry. If the entry exists but the
joiner cannot open, stop and inspect the ACC inbox and event log; another enrollment may create an
ambiguous state. The owner browser retains openings for grants it issued in an encrypted journal
bound to its passkey; active read grants without an opening in that profile block this flow.
To remove the joining device, read the live roster again, copy its complete commitment into
**Device commitment to remove**, and review the network, ACC, epoch, target and entry count in the
confirmation before consenting with the owner passkey. The SDK verifies every surviving reader,
held coin and active read-grant target before rotating the viewing and roster keys, then removes
the target. An absent or ambiguous target, a missing grant opening, or an unverifiable holding
stops the operation. It spans multiple transactions: if it is interrupted after key rotation,
inspect the live roster and inbox before attempting another removal. The removed passkey should
no longer open the ACC; confirm the owner can still open it.

## Scoped grant demonstration

With an ACC open, choose **Read grant roster** to see its chain-confirmed grant generation, nonce,
IDs, active status and read flag. In a separate browser profile, use **Prepare grant holder** to
create a different passkey and copy only its public JubJub key to the owner. The owner chooses one
asset, a fixed unshielded recipient, a per-call limit and a total cap, then chooses **Issue scoped
grant**. After the live roster confirms its ID, the owner uses **Export grant opening** to unlock
the encrypted journal and verify the opening against the active on-chain commitment. Send that JSON
directly to the grantee; it includes the scope salt and is deliberately absent from the copied
operation trace.

The grantee pastes the opening into **Grant opening JSON from the owner**, enters the amount and
previous spent total, and chooses **Spend scoped grant**. The page checks the live grant and fixed
recipient before grantee passkey consent, then confirms the updated commitment. The owner can use
**Revoke scoped grant** on an active ID and verify its inactive tombstone. **Recover pending grants**
resumes publication of openings already staged in this browser's encrypted journal after checking
live ACC commitments. The journal is profile-local; clearing browser storage loses its openings,
and a grant created on another device cannot be recovered here. A node-backed package run covers
issue, independent holder spend, revoke and post-revoke refusal; the two-browser passkey ceremony
still needs a manual localnet run.

For a colleague-facing run, expand **Operation trace (requests and responses)** while using the
page. **Copy full log** exports one JSON document with the action stages, all Passport connector
events (including deployment waves and activation), the HTTP request/response timeline, the open
ACC, and built-in wallet addresses and balances. The trace shows public request and response
fields and byte counts for transaction, boot and encryption-key payloads. It never copies raw
transaction bodies, passkey results, PRF output, wallet seeds, viewing secrets or bearer tokens.
The trace starts when the page loads; replay create/open, connect the wallet and fund the ACC in
one session to capture the whole lifecycle. A prior account creation cannot be reconstructed from
a later page load.

## What to know before you start

A current sealed ACC uses a random viewing secret. The browser derives only this device's reader
key and the separate wallet seed from its passkey. Creation, opening and rotation can require
several passkey prompts; the provider decides whether PRF output is available at creation.
Chromium sometimes adds a signed GREASE field to an assertion. The adapter retries that exact
known variant up to five times, so prompt counts are not fixed. The event log records each
operation and the progress bar follows the SDK flow events.

The account and operation log are in page memory. Reloading clears the page state, then
**Open with passkey** checks the directory hint against the live ACC and opens this device's
sealed envelope. A device with no live ACC entry cannot open it.

## The click-through

### 1. Create the ACC

**Do.** Open exactly `http://localhost:5173/` and click **Create account**. Save the passkey with a
PRF-capable provider when prompted. The browser makes a profile probe before deploying. The
service then deploys the ACC in ten waves, activates the first device and publishes its sealed
key envelope and registration. This can take several minutes. The page reports the full ACC
address and confirmed ledger state; no seed phrase is shown.

**Show.** In the event log, identify the passkey creation, PRF preparation, deploy waves, activation
and sealed-key publications. The account viewing secret stays inside the keyring. The service
pays for deployment and the passkey authorises the account calls.

### 2. Rotate the sealed viewing key

**Do.** Click **Rotate sealed viewing key**. The page reads the live device roster, verified
shielded holdings and active read grants, then shows their counts for review. Confirm only when
those match the intended account. The SDK refuses missing device readers or unsealable surviving
read grants before it changes the ACC key. A successful run reports its transaction hash and a
higher authorisation nonce without putting the secret or grant seals in the shareable log.

### 3. Reload and reopen

**Do.** Reload the page, click **Open with passkey**, and choose the enrolled passkey. Confirm that
the ACC address is unchanged and the rotated key opens. **Open by ACC address** is available to a
second enrolled device that knows the address; it does not reconstruct a lost passkey.

### 4. Connect the built-in wallet

**Do.** Click **Connect built-in wallet**. With an ACC open, the PRF ceremony is pinned to that
account's credential. The wallet derives its own HD seed from the passkey and shows read-only
addresses and balances. The sponsor wallet is separate. If the browser selects another credential,
the pinned wallet ceremony is refused.

### 5. Copy the evidence

**Do.** Click **Copy evidence**. The JSON contains public requests, responses, account state,
transaction hashes and timing. It excludes passkey private keys, PRF outputs, the wallet seed,
account viewing secrets and sponsor credentials. If clipboard access fails, open the evidence
panel and copy its text.

## Narrating the wait

The ten deploy waves dominate a fresh run. The status line, progress bar and event log show what
has completed; proof and finality can add time after the final wave. The browser test in
[AGENTS.md](../../AGENTS.md#5-run-the-automated-end-to-end-test) automates the WebAuthn path with
virtual credentials, while a real Google or iCloud provider run remains a separate manual check.

## Mock mode

Mock mode needs no authenticator. It works under the Vite dev server (`pnpm prototype:dapp`, or
`prototype:up`) and never in a production build.

| URL                                                | Create asks | Use it to                                                                       |
| -------------------------------------------------- | ----------- | ------------------------------------------------------------------------------- |
| `http://localhost:5173/?mockPasskey`               | twice       | Rehearse the click-through. Behaves like a provider that returns PRF at create. |
| `http://localhost:5173/?mockPasskey=noprf-results` | three times | Rehearse the path of a provider that returns only `prf.enabled`.                |

The mock replaces `navigator.credentials` before the app loads. Everything else is real: the page,
the connector, the WebAuthn checks, the Lace recipe, the service, the proof server and the chain.

- A banner reads "MOCK PASSKEY — dev only" and the evidence records `"passkey": "MOCK …"`.
- The mock answers without any browser prompt, so there is nothing to click, but the calls are the
  same as for a real passkey.
- Its credentials, private keys and PRF secrets included, are kept in `localStorage`
  (`passport-dev:mock-passkey:v1`) so that **Open with passkey** works after a reload. A
  discoverable prompt picks the newest credential.
- To start clean, clear that key (or the site's storage). A mock account does not open with a real
  passkey, or the reverse.
- Never present mock mode as a real passkey run.

## Passkey provider advice

The account and the built-in wallet need the WebAuthn **PRF** extension.

- **Save the passkey in Google Password Manager or iCloud Keychain.** When Chrome asks where to
  save the passkey, choose one of these.
- **Do not choose Chrome's "Chrome profile" store.** It has no PRF. Neither do some security keys.
  The first real run failed this way: the provider reported PRF unavailable, and create was refused
  after the first prompt, with nothing deployed.
- **Delete stale passkeys for `localhost`** before a demo. Both pickers (**Open with passkey**, and
  the wallet with no account open) list every passkey for the site. An old passkey without PRF, or
  from a chain that has since been reset, makes the demo fail in front of people. In Chrome, passkeys
  are listed at `chrome://password-manager/passkeys`. For iCloud Keychain, use the Passwords app.
- A passkey in another profile or machine can open a known ACC address after it has been enrolled
  in that account and can recover its sealed reader key. The local directory is needed only for
  **Open with passkey**, which discovers the address.

## Troubleshooting

When a step fails, the status line reads `Failed: <code> — <message>`, and the evidence gains an
`error` step with the same code and message. The error texts below are exact.

### UnsupportedAuthenticator at create

> This passkey provider does not support the PRF extension, which the Passport account and the
> built-in wallet need. When the browser asks where to save the passkey, choose a PRF-capable
> provider: Google Password Manager or iCloud Keychain (the "Chrome profile" store and some
> security keys have no PRF). Then create the account again.

It appears right after the first prompt. Nothing is deployed. **Fix:** delete the passkey that was
just saved (it exists in the provider that refused it), click **Create account** again, and
choose a PRF-capable provider.

A provider that does not say whether it supports PRF is not refused here. If it then returns no PRF
output at the encryption-key prompt, you get the next error, still before any deploy.

### UnsupportedAuthenticator later

> This passkey returned no PRF output. Either it has no PRF support (a passkey saved in the "Chrome
> profile" store, or some security keys), or it is a different passkey from the one this account was
> created with. Choose the account's own passkey, saved in Google Password Manager or iCloud
> Keychain.

It appears at a later PRF prompt: the encryption-key prompt of a three-prompt create, or the
built-in wallet. The most common cause is a stale passkey. In the manual run the wallet's picker,
with no account open, offered the old Chrome-profile passkey. **Fix:** delete the stale passkey, or
open the account first so the wallet's prompt is pinned to its own passkey, then retry.

Other `UnsupportedAuthenticator` texts: "The authenticator did not create an ES256 (P-256) key."

### A wrong passkey

> This is not the passkey this account was created with; choose that passkey.

The code is `AccountNotFound`. A prompt that is pinned to the account's passkey (the enrolment
probe, a rotation signature, the wallet's PRF ceremony) was answered by a different credential.
**Fix:** choose the account's own passkey. If you no longer have it, you cannot sign for that
account.

### The wa-json134 profile

> The authenticator does not match the wa-json134 profile: `<detail>`

The code is `UnsupportedAuthenticator`. The detail names what differed, for example mismatched
`clientDataJSON`, authenticator data, RP hash, flags or ES256 signature. The contract accepts one
exact assertion shape. Chromium's known signed GREASE field is retried up to five times without
changing the signed bytes; a different format is refused.

**Fix:** retry once, then try another PRF-capable provider if the profile error repeats. If the
five bounded GREASE attempts are exhausted, retry the operation. An unknown assertion layout
requires a contract/profile update before it can authorise an ACC call.

Related: "Passkey enrolment origin mismatch: the page is `<origin>`, the policy is
`http://localhost:5173`." The page was opened at another origin, such as `127.0.0.1`. Open
`http://localhost:5173`.

### UserCancelled

> The passkey prompt was cancelled.

Also "Passkey creation was cancelled." and "No passkey was chosen." Nothing was submitted. The
browser reports the same error when a prompt times out. **Fix:** click the button again. A
cancelled create may leave a passkey in the provider with no account. Delete it.

### AccountNotFound after a chain reset

The registry is only valid for the chain it was written on. If the localnet's volumes were dropped
(`docker compose … down -v`, or `experiments/acc-0.35/run.sh`, which starts fresh), the registry
still names accounts that no longer exist. **Open with passkey** then fails with one of:

> No contract at `<address>`.

> The account at `<address>` does not hold this passkey.

> This passkey has no live entry on the account.

The code is `AccountNotFound` in each case. **Fix:** delete `~/.midnight-passport/registry.json` and
`registry.deployments.json`, delete the old passkeys for `localhost`, and create a new account.

Two more texts have the same code, for a passkey the registry does not know, or a record that is not
this passkey's:

> No Passport account for this passkey on this network.

> The registry record does not belong to this passkey.

### Other errors you may meet

| Error                                                                          | Meaning and fix                                                                                                                                                  |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProverUnavailable`, after about 10 minutes                                    | The page gave up on the proof. Proofs and deploys share one queue, so a rotation queued behind a deploy can time out. Wait for the deploy to finish, then retry. |
| `ProverUnavailable` at once                                                    | The service is unreachable, or Docker has too little memory for a P-256 proof (about 13.5 GiB). Raise Docker to 24 GiB.                                          |
| `SponsorRejected`: "deployment limit reached for this service instance"        | The service accepts 20 deploys per process, failures included. Restart the service.                                                                              |
| `SponsorRejected`, other text                                                  | The sponsor policy refused the transaction, or the sponsor failed. A failure at submit can be the Dust race. Retry.                                              |
| `ProverUnavailable` or `SponsorRejected`: "service busy: too many queued jobs" | More than eight jobs wait on the service. Wait, then retry.                                                                                                      |
| `ArtefactIntegrity`                                                            | The service's manifest hash is not the one the page was built with. Restart both with the same `PASSPORT_MANIFEST_SHA256`.                                       |
| `NetworkMismatch`                                                              | The service is on another network than `undeployed`.                                                                                                             |

For ports, Docker memory, the manifest hash and the two-copies error, see the troubleshooting
section of [`apps/README.md`](../../apps/README.md).
