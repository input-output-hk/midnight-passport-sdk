---
layout: default
title: Account API
permalink: /api/
---

The public flow is `createPassportAccounts(ports): PassportConnectorAPI` from `mn-passport-account`. The interfaces are in `mn-passport-protocol`; adapter authors import the contracts from `mn-passport-account/ports`. Source links below point to the exact prototype API.

```ts
import { createPassportAccounts } from '@input-output-hk/mn-passport-account';
import type { PassportPorts } from '@input-output-hk/mn-passport-account/ports';

declare const ports: PassportPorts; // supplied by the host adapters
const passport = createPassportAccounts(ports);
const account = await passport.createAccount({
  userName: 'alice',
  retireAuthority: true,
  onEvent: (event) => console.log(event.step, event.phase),
});
const state = await account.state();
```

`retireAuthority` is required. `true` removes the maintenance authority after the last deployment wave and cannot be undone. A host must make that choice explicitly. The account connector supports P-256 WebAuthn and JubJub Schnorr creation and opening. The typed `k256-ecdsa` arm is not implemented.

## Flow methods

| Method                                                            | Result                     | Behaviour                                                                                                                      |
| ----------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `createAccount({ userName, retireAuthority, signal?, onEvent? })` | `PassportAccount`          | Creates a passkey, deploys the ACC, records a directory hint and activates the first device.                                   |
| `openAccount({ signal?, onEvent? }?)`                             | `PassportAccount`          | Finds a registered account with a passkey, verifies ownership against the chain and reopens it.                                |
| `account.state()`                                                 | `PassportAccountState`     | Reads `booted`, `authNonce`, `deviceEpoch`, `entryCount` and `specVersion`. `entryCount` counts entries, not distinct devices. |
| `account.rotateEncryptionKey(newKey, options?)`                   | `{ txHash, blockHeight? }` | P-256 only: authorises a gated call with the account passkey. The caller supplies the new 32-byte key. |
| `account.rotateViewingKey(options?)`                              | `{ txHash, droppedDeviceEntries }` | JubJub only: seals a random secret to unique live readers, rotates the ACC key, then re-encrypts verified holdings. Requires the host's `VerifiedHoldingSource`; refuses accounts with grant records until grant-aware rotation is implemented. |
| `account.readShieldedHoldings(options?)`                           | `PassportShieldedHolding[]` | JubJub only: opens coin descriptions inside a `read-holdings` key session and returns those confirmed against chain-owned outputs. Requires the host's `VerifiedHoldingSource`. |

The account object also exposes `address`, `networkId`, `bindingId`, `scheme` and, for passkeys, `credentialId`. `apiVersion` is currently `1.0.0-pre.0`. See [protocol `api.ts`](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/packages/protocol/src/api.ts) and [account `connector.ts`](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/packages/account/src/connector.ts).

## Ports

`PassportPorts` injects a pinned `network` and `binding`, `credentials`, `authoriser`, `encryptionKey`, `chain` and `deployer`. `directory`, `records`, `holdings` and `random` are optional in the current type. Chain-facing ports include `Prover.proveTx`, `FeeSponsor.balanceAndSign` and `Submitter.submit`. `VerifiedHoldingSource` is required when a host offers JubJub viewing-key rotation: it must validate opened coin descriptions against chain-created outputs and select distinct held entries. An inbox ciphertext by itself does not prove a holding. A host implements these contracts instead of putting browser, service or Midnight dependencies into the account flow. The [port source](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/packages/account/src/ports/index.ts) is the detailed type reference; [`account/testing`](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/packages/account/src/testing) supplies fakes and contract suites.

`Chain.readAccount(address, { includeInbox: true })` also returns the ACC inbox values in ledger-index order, capped at 4096 entries, for flows that need to open sealed account keys. The default read omits the inbox so the P-256 state path does not fetch every entry. JubJub create/open requests this view to validate the viewing key.

`Chain.readAccount(address, { includeDevices: true })` returns up to 64 live device commitments. A rotation or device-management flow must resolve registered reader keys against this set before sealing a new account secret to them; inbox registrations alone are untrusted.

`createMidnightHoldingSource(indexer)` from `mn-passport-adapter-midnight-js` implements `VerifiedHoldingSource` using the Midnight ledger's contract-owned output commitment. The host supplies `enumerateContractActions(account)` and `queryShieldedOutputs(txHash)` from an indexer on the account's pinned network. The adapter selects the first inbox description for each distinct output the chain created for the ACC and ignores decryptable descriptions without such an output. Pass this source as `holdings` to `createBrowserPassport` when enabling JubJub rotation.

`readVerifiedHoldings({ account, keyring }, { networkId, chain, authoriser, viewingKey, holdings })` is an additive account helper for a host that has already selected this device's sealed keyring from the live ledger. It checks the account and current `enc_key`, opens the inbox inside one `read-holdings` key session, and returns only opened coins whose inbox indices the chain-backed `VerifiedHoldingSource` confirms. It rejects duplicate, out-of-range, or non-coin selections. The caller supplies the keyring selection and indexer-backed holding source; the helper does not perform those host-specific steps or move funds. An empty inbox returns without a key session.

An opened JubJub `PassportAccount` also offers `readShieldedHoldings(options?)`. It selects the sealed keyring from the current ACC inbox, confirms the recorded owner device still has a live entry, then uses the same verified holding source and `read-holdings` consent flow. The pinned Lace v1 inbox prefix lets it return an empty list without a key ceremony when there are no coin-description entries. The host must inject `holdings`; the SDK does not trust a decryptable inbox description without a matching chain output. P-256 prototype accounts do not expose this optional method.

`addJubjubAuthorisingDevice(input, ports)` is the first typed device-write helper. It derives a new JubJub entry from the joining device's public key, checks the current owner's live entry and ACC binding, signs the pinned `add_device_with_jubjub` challenge inside an `add-device` key session, calls the circuit, then persists the advanced use counter. It intentionally enrolls **authorisation only**: it does not send the account viewing secret or roster key to the new device. A host must not present the new device as able to read holdings until a separate, consented key-delivery flow has completed. Device removal and full reader delivery remain release work.

`prepareJubjubGrant(input, pure, random?)` checks a Lace-shaped JubJub grant request and derives the grant ID, first free slot, scope digest and object commitment with the pinned ACC pure circuits. Supply the live active grant IDs and current POSIX seconds from the account's network; the function cannot verify a caller-provided roster. It accepts decimal strings for amounts, rejects unsafe grantee and read public keys, enforces the contract's reserved window fields and the 16-active-grant client limit, and draws a fresh 32-byte scope salt. The returned `scopeArgs` follow `issue_grant_with_jubjub` declaration order. This is **preparation only**: a complete owner flow must pin a caller where needed, obtain consent and the owner's signature, submit and settle the proof, seal the viewing secret for a read grant, and persist grant bookkeeping. Grant issuance and revocation remain unavailable as account methods.

`issueJubjubGrantCall(input, ports)` adds the owner-signed submission step for **unshielded spend grants without read access**. Before prompting, it checks local record presence, reads active grant IDs from the host's chain-backed `ActiveGrantSource`, and prepares the scope. Inside one `issue-grant` key session, it reads the possibly sealed record, confirms the device against the active ACC, signs the generated challenge, and requires `GrantIssueJournal.stage` to persist the opening before calling the chain. It advances the local use counter after a successful call and returns `status: 'submitted'`; the host must reconcile this staged grant against the settled chain roster and publish sealed bookkeeping before presenting it as active. Read or shielded grants are rejected until the viewing-secret rotation and delivery path is implemented. The journal must survive process restarts so a submitted call can be recovered after a crash.

The `mn-passport-service` package now exports a bounded `createMemoryJobStore` and `jobsRoute` for `GET /v1/jobs/{id}?after={cursor}`. A submitted job is pollable before work begins; polls return only events after the cursor plus its current result or sanitized error. The memory store is a standalone reference implementation and loses jobs on restart. A deployed backend should inject a durable `JobStore` with the same contract. `v1ChainRoute` serves `POST /v1/prove-tx` and `/v1/deploy` as `202 {jobId}` plus synchronous `POST /v1/sponsor/balance` and `/v1/sponsor/submit`. The demo serves these routes alongside its legacy paths, using one proof/deploy queue and one deployment cap. `serviceConfigRoute` answers `/v1/config` with the pinned network, binding, manifest hash, API version and sponsor public keys. `pinnedZkRoute` verifies the full artefact tree before serving the binding-specific `/v1/zk/{bindingId}` URL that config advertises. The demo browser uses the versioned routes. On a `/v1/accounts` miss it reads the legacy `/accounts` registry so existing demo accounts can reopen; new hints go only to `/v1/accounts`.

The same package exports `sponsorPolicy`, `viewOfLedgerTx`, and `guardedBalance`. An operator injects the ledger deserializer, current allowlist of Passport ACCs, and its own funded wallet through `GuardedBalanceDeps`. The policy refuses shielded or unshielded offers, Dust actions, non-call actions, unlisted contracts, and non-Dust value imbalances before it invokes the wallet. Fee sponsorship does not transfer value into an ACC; that needs the separate funding service.

`mn-passport-adapter-service` exports `remoteV1Prover`, `remoteV1Deployer`, and `remoteV1Sponsor`. The first two submit a v1 job and poll it with a cursor; they forward validated service progress through `onEvent`, honor `signal`, enforce a total timeout, and preserve the service's error code. The sponsor uses the synchronous v1 fee endpoints. `fetchCheckedV1Config` checks the advertised network, binding, manifest, service API version and binding-specific artefact URL against host pins before a host uses these ports. The standalone browser demo uses these clients without changing the account core.

The separate `mn-passport-adapter-service/faucet` subpath exports `remoteFaucet` for `POST /v1/faucet/fund`. A caller supplies a stable UUID, pinned network/binding/manifest, ACC address, allowlisted asset color and decimal amount, plus a callback for fresh authorization headers. The result includes the transaction ID and confirmed credited ACC balance. The funding route and client are available as library pieces; a wallet-backed funding app is not yet running.

A deployed JubJub `AccountHint` may carry up to 16 sealed 192-byte `keyEntries` until they have been appended to the ACC inbox. They contain no raw viewing secret. A directory response is an untrusted pointer: the owner flow must match its credential and device key to the selected passkey, check the on-chain device entry, and open an envelope against the ledger's `enc_key` before completing or accepting it.

### JubJub viewing-key port

`AccountViewingKey` is the port for Lace's random ACC viewing secret and device envelopes. `recipeDeviceKeyring(prfSource)` from `mn-passport-keys` implements it: `readerPublicKey`, `createKeys`, `sealToDevice`, `openInbox`, `sealGrant`, `reencryptInbox`, and `sealView`. The keyring opens the current sealed secret only inside a passkey session, checks it against the ledger's `enc_key`, and clears it after each operation. The account flow must confirm that any joining reader belongs to the device entry being enrolled, and that readers kept during rotation are unique live devices. `openInbox` returns decrypted coin descriptions, device registrations and grant bookkeeping, or `null` for unrelated entries.

The JubJub authoriser also supplies `devicePublicKeyHex()`, a validated compressed point for the device registration. The WebAuthn credential adapter can select a discoverable passkey for a pinned PRF ceremony before a P-256 key is chosen; a JubJub flow verifies the resulting device key against the on-chain entry and the directory hint.

The JubJub create/open path uses `AccountViewingKey` to create a random account secret, seal it to the passkey-derived reader, and validate it against the live ACC encryption key. It persists sealed entries before activation so `openAccount` can resume an interrupted create. The rotation path sends new envelopes before switching the ledger key and refuses a concurrent key or device-roster change. A host must supply chain-backed holding verification; the browser composition does not provide one by default. Grant-aware rotation and Lace consumer validation remain release gates. The `encryptionKey` port remains the P-256 prototype's deterministic key source. See [key roles and recovery]({{ '/keys/#account-viewing-secrets-and-recovery' | relative_url }}).

## Events and cancellation

Each step reports `start` and exactly one `end` or `error` with the same `flowId` and `id`. `PassportEvent` includes `step`, `phase`, timestamp `at`, `clock`, optional `durationMs`, safe detail fields and an error code. Relevant steps include `passkey.create`, `deploy`, `activate`, `prove`, `sponsor.submit` and `chain.finality`. `signal` ends a flow with `Aborted`; it cannot reverse an already submitted transaction. See [events.ts](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/packages/protocol/src/events.ts).

## Errors

Catch `PassportConnectorError` and use its `code`, `retryable` and `step` fields. Do not branch on message text. Codes include `UserCancelled`, `UnsupportedAuthenticator`, `WrongPasskey`, `AccountNotFound`, `SponsorRejected`, `ProverUnavailable`, `ArtefactIntegrity`, `ApiVersionUnsupported` and `InternalError`. The full table and Lace code mapping live in [errors.ts](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/packages/protocol/src/errors.ts).

`createPassportConnector(seams)` is a deprecated compatibility bridge. New integrations use `createPassportAccounts(ports)`.

## Browser composition

`createBrowserPassport(config)` from `mn-passport-adapter-browser` supplies WebAuthn credentials,
the P-256 authoriser by default, or the JubJub authoriser and device keyring with `arm: 'jubjub'`. The host passes a pinned `NetworkConfig`,
the ACC binding, prover, sponsor, submitter, deployer and directory ports. The Midnight call
pipeline loads on the first chain operation; its network id is set for each read and call. The
`sponsorKeys` field carries the fee payer's public coin and encryption keys required by midnight-js.
See [BrowserPassportConfig](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/packages/adapter-browser/src/compose.ts).

`mn-passport-adapter-service` supplies `remoteProver`, `remoteSponsor` (both fee sponsor and
submitter), `remoteDeployer`, `remoteDirectory` and `fetchCheckedConfig`. The demo uses these clients
against the versioned service. `remoteDirectory` uses `/v1/accounts`; the standalone service serves it through `directoryRoute` and a single-process file store. Hints are write-once except a `deployed` to `active` status change. A supplied ownership proof is refused unless the host injects an `OwnershipVerifier`; the standalone flow currently writes without one. The directory is an untrusted pointer, and the account core checks its answer against the ACC ledger before using it.
