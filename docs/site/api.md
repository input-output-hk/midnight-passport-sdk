---
layout: default
title: Account API
permalink: /api/
---

The public flow is `createPassportAccounts(ports): PassportConnectorAPI` from `mn-passport-account`. The interfaces are in `mn-passport-protocol`; adapter authors import the contracts from `mn-passport-account/ports`. Source links below point to the exact prototype API.

```ts
import { createPassportAccounts } from '@midnight-ntwrk/mn-passport-account';
import type { PassportPorts } from '@midnight-ntwrk/mn-passport-account/ports';

declare const ports: PassportPorts; // supplied by the host adapters
const passport = createPassportAccounts(ports);
const account = await passport.createAccount({
  userName: 'alice',
  retireAuthority: true,
  onEvent: (event) => console.log(event.step, event.phase),
});
const state = await account.state();
```

`retireAuthority` is required. `true` removes the maintenance authority after the last deployment wave and cannot be undone. A host must make that choice explicitly. The prototype currently accepts only `p256-webauthn`; the types describe future `jubjub-schnorr` and `k256-ecdsa` arms as well.

## Flow methods

| Method                                                            | Result                     | Behaviour                                                                                                                      |
| ----------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `createAccount({ userName, retireAuthority, signal?, onEvent? })` | `PassportAccount`          | Creates a passkey, deploys the ACC, records a directory hint and activates the first device.                                   |
| `openAccount({ signal?, onEvent? }?)`                             | `PassportAccount`          | Finds a registered account with a passkey, verifies ownership against the chain and reopens it.                                |
| `account.state()`                                                 | `PassportAccountState`     | Reads `booted`, `authNonce`, `deviceEpoch`, `entryCount` and `specVersion`. `entryCount` counts entries, not distinct devices. |
| `account.rotateEncryptionKey(newKey, options?)`                   | `{ txHash, blockHeight? }` | Authorises a gated call with the account passkey. The prototype caller supplies the new 32-byte key.                           |

The account object also exposes `address`, `networkId`, `bindingId`, `scheme` and, for passkeys, `credentialId`. `apiVersion` is currently `1.0.0-pre.0`. See [protocol `api.ts`](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/packages/protocol/src/api.ts) and [account `connector.ts`](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/packages/account/src/connector.ts).

## Ports

`PassportPorts` injects a pinned `network` and `binding`, `credentials`, `authoriser`, `encryptionKey`, `chain` and `deployer`. `directory`, `records` and `random` are optional in the current type. Chain-facing ports include `Prover.proveTx`, `FeeSponsor.balanceAndSign` and `Submitter.submit`. A host implements these contracts instead of putting browser, service or Midnight dependencies into the account flow. The [port source](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/packages/account/src/ports/index.ts) is the detailed type reference; [`account/testing`](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/packages/account/src/testing) supplies fakes and contract suites.

## Events and cancellation

Each step reports `start` and exactly one `end` or `error` with the same `flowId` and `id`. `PassportEvent` includes `step`, `phase`, timestamp `at`, `clock`, optional `durationMs`, safe detail fields and an error code. Relevant steps include `passkey.create`, `deploy`, `activate`, `prove`, `sponsor.submit` and `chain.finality`. `signal` ends a flow with `Aborted`; it cannot reverse an already submitted transaction. See [events.ts](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/packages/protocol/src/events.ts).

## Errors

Catch `PassportConnectorError` and use its `code`, `retryable` and `step` fields. Do not branch on message text. Codes include `UserCancelled`, `UnsupportedAuthenticator`, `WrongPasskey`, `AccountNotFound`, `SponsorRejected`, `ProverUnavailable`, `ArtefactIntegrity`, `ApiVersionUnsupported` and `InternalError`. The full table and Lace code mapping live in [errors.ts](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/packages/protocol/src/errors.ts).

`createPassportConnector(seams)` is a deprecated compatibility bridge. New integrations use `createPassportAccounts(ports)`.
