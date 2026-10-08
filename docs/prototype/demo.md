# Demo script

A script for presenting the Passport DApp prototype. It describes the page by its actions, because
the layout may change. The actions are **Create Passport account**, **Open with passkey**,
**Rotate encryption key**, **Connect built-in wallet** and **Copy evidence**.

Allow about 10 minutes. Most of that is two waits: the deploy (about 3 minutes) and the rotations
(about 1 minute each).

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

## What to know before you start

- **The passkey prompts.** Every prompt after create or open is pinned to the account's own
  passkey, so the browser offers no other one. Only **Open with passkey**, and the wallet with no
  account open, show a passkey picker.

  | Action                                                  | Prompts | Which                                                                   |
  | ------------------------------------------------------- | ------- | ----------------------------------------------------------------------- |
  | Create, provider returns PRF results at creation        | 2       | create; enrolment probe                                                 |
  | Create, provider returns only `prf.enabled` at creation | 3       | create; enrolment probe; PRF ceremony for the encryption key            |
  | Create, provider without PRF                            | 1       | create, then refused. Nothing is deployed.                              |
  | Open with passkey, after a rotation                     | 1       | the passkey picker                                                      |
  | Open with passkey, before the first rotation            | 2       | the passkey picker; then a PRF ceremony that checks the encryption key  |
  | Rotate encryption key                                   | 1       | a signature, pinned to the account's passkey                            |
  | Connect built-in wallet, account open                   | 1       | the PRF ceremony, pinned to the account's passkey                       |
  | Connect built-in wallet, no account open                | 2       | the passkey picker; then the PRF ceremony, pinned to the passkey chosen |

  Whether Google Password Manager returns PRF results at creation (two prompts) is expected but not
  confirmed by a recorded run. Be ready for three. The page's own hint text may still say three.

- **The durations.** Deploy: about 180 seconds. Activation: about 25 seconds. Each rotation: about
  1 minute. The page shows no progress bar during the deploy. See [Narrating the wait](#narrating-the-wait).
- **The page forgets on reload.** The open account and the evidence panel are in memory. That is
  the point of the reopen step.

## The click-through

### 1. The page

**Say.** "This is a DApp page. It is not a wallet. The Passport connector is injected at
`window.midnight.passport`, the way a wallet would inject itself, and the page discovers it like
any DApp would."

**Expect.** The status line reads "Not connected." **Rotate encryption key** is disabled. The
evidence panel holds one step, `page-loaded`, with the connector's `apiVersion`
(`0.1.0-prototype`).

### 2. Create Passport account

**Do.** Click **Create Passport account**.

**Say.** "I am creating a passkey. The browser asks where to save it. I choose Google Password
Manager (or iCloud Keychain), because the account needs the PRF extension. A provider without PRF
is refused right here, before anything is deployed."

**Expect.**

1. The passkey prompt appears. Create the passkey. The status line shows `passkey-created`.
2. A second prompt, the **enrolment probe**. It is a throwaway signature that proves this
   authenticator produces the exact WebAuthn bytes the contract verifies. Confirm it.
3. A third prompt only if the provider did not return PRF results at creation. It derives the
   account's encryption key. Confirm it.
4. The status line shows `deploying`. **This takes about 180 seconds.** Nothing is asked of the
   user.
5. The status line shows `deployed`, then `activating`. Activation takes about 25 seconds.
6. The status line shows `active`, then "Account `<12 hex characters>…` is created."
   **Rotate encryption key** is now enabled.

**Say, during the wait** (see [Narrating the wait](#narrating-the-wait)). "The user holds no tokens.
The service deploys the account in 10 waves, because it does not fit in one block, and pays every
fee. In the last wave it retires its own maintenance authority, so this account can never be
upgraded. The only authority left is the passkey."

**Evidence.** A `create:passkey-created`, `create:deploying`, `create:deployed`,
`create:activating`, `create:active` run, each with a timestamp, then a `created` step with the
account address, the binding (`acc-45721e1`) and the ledger state: booted, authorisation nonce 0,
device epoch 0, one device entry, spec version 2. The gap between `create:deploying` and
`create:deployed` is the deploy time. The gap to `create:active` is the activation.

### 3. Rotate encryption key

**Do.** Click **Rotate encryption key**.

**Say.** "Now the passkey authorises a transaction. The page computes a challenge from the
contract's own pure circuit, the passkey signs it, the service proves the transaction, and the
service's sponsor pays the fee. The passkey's key never leaves the authenticator. The new
encryption key is random. Lace has no rotation recipe yet, so the prototype keeps no copy."

**Expect.** One passkey prompt. The status line reads "Proving on the service (≈ 30 s)…". The
whole step takes about **1 minute**: the P-256 proof is about 20 to 30 seconds, and the rest is
balancing, submission and waiting for the block. Then "Rotated in transaction `<16 hex>…`."

**Evidence.** A `rotate` step with `txHash`, `blockHeight` and the new state. The authorisation
nonce goes from 0 to 1. The entry count stays 1.

### 4. Reload, then Open with passkey

**Do.** Reload the page. Note that **Rotate encryption key** is disabled and the evidence holds only
`page-loaded` again. Click **Open with passkey**.

**Say.** "The page has forgotten everything. The passkey is the only thing it needs. The browser
shows a picker of passkeys for this site. I choose mine. The page asks the service's registry which
account that passkey owns. It does not trust the answer. It checks three things against the chain."

**Expect.** One prompt, the passkey picker. Then "Account `<12 hex>…` is reopened." in well under a
second.

**Say.** "The three checks: the passkey I picked owns the key in the registry record. A contract
exists at that address. And the contract's device list holds this passkey's entry."

**Evidence.** A `reopened` step with the same address and state as before, authorisation nonce 1.

### 5. Rotate again

**Do.** Click **Rotate encryption key**.

**Say.** "This is a fresh page, so it has no memory of the previous call. It rescans the contract's
use counter to find this passkey's live entry. That is why it works after a reload."

**Expect.** One prompt, about 1 minute. A `rotate` step. The authorisation nonce is now 2.

### 6. Connect built-in wallet

**Do.** Click **Connect built-in wallet**.

**Say.** "This part is separate from the account. It shows that a Midnight wallet can come from the
same passkey. The browser asks the passkey for two PRF outputs. The root output goes through the
Lace recipe to a 24-word seed, and the wallet is built from that seed. Nothing is stored. It is a
standard DApp Connector API 4.1.0 wallet, read-only: it never proves or pays, because the service
sponsors."

**Expect.** One prompt with an account open, two with none (the picker, then the PRF prompt). The
status line steps through "Reading the service configuration…", a PRF prompt message, "Syncing the
built-in wallet…" and "Built-in wallet connected through the DApp Connector API." The sync runs from
the page against the localnet indexer.

**Evidence.** A `wallet` step: `seedSource: "passkey PRF (Lace recipe v1)"`, the wallet's
configuration (indexer, node, network `undeployed`), an unshielded address (`mn_addr_undeployed1…`)
and a Dust address (`mn_dust_undeployed1…`). The wallet is new, so it holds no funds. The same
passkey always gives the same addresses.

To show the two-prompt path, reload first and click **Connect built-in wallet** with no account
open.

### 7. Copy evidence

**Do.** Click **Copy evidence**. The status line reads "Evidence copied."

**Say.** "This is the record of the run. It names the network, the pinned manifest hash, every
step with a timestamp, the account address, and every transaction hash. It holds no secret: no
key, no seed, no PRF output. We keep these under `experiments/acc-0.35/results/`."

If the browser refuses clipboard access, the status line reads "Copy failed: the browser refused
clipboard access." Select the evidence text by hand instead.

## Narrating the wait

The status line shows `deploying` for about three minutes, and the page has no progress bar
(fork issue [#17](https://github.com/input-output-hk/midnight-passport-sdk/issues/17) tracks it).
In a real run the owner could not tell whether creation had finished. Use the time:

- Explain the 10 waves and why the service pays: a new user has no tokens, and there is no wallet
  to hold them yet.
- Explain the prompt count: two or three prompts to create, none for the deploy.
- Point at the evidence panel. It updates as each step lands, so `create:deployed` appears the
  moment the deploy finishes.
- Show the service's terminal if you wish. Expect little output while it works.

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
- A passkey from another browser profile or machine opens an account only if the registry on this
  machine knows it.

## Troubleshooting

When a step fails, the status line reads `Failed: <code> — <message>`, and the evidence gains an
`error` step with the same code and message. The error texts below are exact.

### UnsupportedAuthenticator at create

> This passkey provider does not support the PRF extension, which the Passport account and the
> built-in wallet need. When the browser asks where to save the passkey, choose a PRF-capable
> provider: Google Password Manager or iCloud Keychain (the "Chrome profile" store and some
> security keys have no PRF). Then create the account again.

It appears right after the first prompt. Nothing is deployed. **Fix:** delete the passkey that was
just saved (it exists in the provider that refused it), click **Create Passport account** again, and
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

The code is `UnsupportedAuthenticator`. It appears at create, at the enrolment probe, before any
deploy. The detail names what differed, for example "unsupported or mismatched clientDataJSON
(wa-json134)", "WebAuthn authenticatorData length or RP mismatch", "WebAuthn requires UP+UV, no
extensions, valid backup flags" or "invalid WebAuthn ES256 signature". The contract accepts one
exact shape of assertion, and this authenticator produced another.

**Fix:** delete the passkey and retry once. If it repeats, retry with another provider. No run so
far has hit this with a real authenticator, so no remedy beyond that is recorded. At a later
signature the same details appear without the prefix, with the code `InternalError`.

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
