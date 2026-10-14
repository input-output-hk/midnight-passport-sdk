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
| `account.rotateEncryptionKey(newKey, options?)`                   | `{ txHash, blockHeight? }` | P-256 only: authorises a gated call with the account passkey. The caller supplies the new 32-byte key. JubJub rotation is a release gate. |

The account object also exposes `address`, `networkId`, `bindingId`, `scheme` and, for passkeys, `credentialId`. `apiVersion` is currently `1.0.0-pre.0`. See [protocol `api.ts`](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/packages/protocol/src/api.ts) and [account `connector.ts`](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/packages/account/src/connector.ts).

## Ports

`PassportPorts` injects a pinned `network` and `binding`, `credentials`, `authoriser`, `encryptionKey`, `chain` and `deployer`. `directory`, `records` and `random` are optional in the current type. Chain-facing ports include `Prover.proveTx`, `FeeSponsor.balanceAndSign` and `Submitter.submit`. A host implements these contracts instead of putting browser, service or Midnight dependencies into the account flow. The [port source](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/packages/account/src/ports/index.ts) is the detailed type reference; [`account/testing`](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/packages/account/src/testing) supplies fakes and contract suites.

`Chain.readAccount(address, { includeInbox: true })` also returns the ACC inbox values in ledger-index order, capped at 4096 entries, for flows that need to open sealed account keys. The default read omits the inbox so the P-256 state path does not fetch every entry. JubJub create/open requests this view to validate the viewing key.

A deployed JubJub `AccountHint` may carry up to 16 sealed 192-byte `keyEntries` until they have been appended to the ACC inbox. They contain no raw viewing secret. A directory response is an untrusted pointer: the owner flow must match its credential and device key to the selected passkey, check the on-chain device entry, and open an envelope against the ledger's `enc_key` before completing or accepting it.

### JubJub viewing-key port

`AccountViewingKey` is the port for Lace's random ACC viewing secret and device envelopes. `recipeDeviceKeyring(prfSource)` from `mn-passport-keys` implements it: `readerPublicKey`, `createKeys`, `sealToDevice`, `openInbox`, `sealGrant`, `reencryptInbox`, and `sealView`. The keyring opens the current sealed secret only inside a passkey session, checks it against the ledger's `enc_key`, and clears it after each operation. The account flow must confirm that any joining reader belongs to the device entry being enrolled, and that readers kept during rotation are unique live devices. `openInbox` returns decrypted coin descriptions, device registrations and grant bookkeeping, or `null` for unrelated entries.

The JubJub authoriser also supplies `devicePublicKeyHex()`, a validated compressed point for the device registration. The WebAuthn credential adapter can select a discoverable passkey for a pinned PRF ceremony before a P-256 key is chosen; a JubJub flow verifies the resulting device key against the on-chain entry and the directory hint.

The JubJub create/open path uses `AccountViewingKey` to create a random account secret, seal it to the passkey-derived reader, and validate it against the live ACC encryption key. It persists sealed entries before activation so `openAccount` can resume an interrupted create. JubJub rotation, grants and Lace consumer validation remain release gates. The `encryptionKey` port remains the P-256 prototype's deterministic key source. See [key roles and recovery]({{ '/keys/#account-viewing-secrets-and-recovery' | relative_url }}).

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
submitter), `remoteDeployer`, `remoteDirectory` and `fetchCheckedConfig`. Until the service-library
migration, the demo maps its old `/accounts` registry to the directory port; the versioned
`remoteDirectory` expects `/v1/accounts` and cannot yet target the prototype server.
