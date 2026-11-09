---
layout: default
title: Account keys, viewing secrets and recovery
permalink: /account-keys/
---

This is the library contract for `mn-passport-keys` and the account ports that use
it. The host supplies the key source, network, live account records and explicit
custody policy. Importing the library does not request a passkey, start a wallet,
retain a login session or decide which operations need fresh approval.

## Choose the capability you need

| Material | Purpose | What it does not provide |
| --- | --- | --- |
| Passkey / PRF source | A provider-controlled credential and deterministic, domain-separated inputs | An ACC address, recovery guarantee or automatic chain authority. |
| JubJub owner key | Signs the supported owner circuits after enrollment | A bounded grant; an enrolled full owner has durable chain authority. |
| X25519 reader key | Opens the sealed envelopes addressed to that reader | Permission to sign or spend. |
| Random ACC viewing secret | Determines the ledger encryption key and opens matching private records | A Midnight HD wallet seed or owner signing key. |
| Derived wallet seed | Initializes a separate host-selected HD wallet | ACC ownership or a replacement for the viewing secret. |
| ZKIR / prover / verifier files | Public circuit proving and verification artifacts | Private account custody; use the [artifact guide]({{ '/keys/' | relative_url }}). |

The [library integration guide]({{ '/library-guide/' | relative_url }}) describes
input ownership and lifecycle. The demo's [routine access]({{ '/quick-actions/' | relative_url }}),
[fresh-owner approval]({{ '/authenticated-owner/' | relative_url }}) and
[bounded transfer sessions]({{ '/jubjub-sessions/' | relative_url }}) are host policy,
not defaults of the key recipes. Published RC7 and later source features remain
labeled in those guides.

## RC8: use wallet material during verified login {#source-preview-use-wallet-material-during-verified-login}

The optional `BrowserPassportConfig.onAccountOpened` callback runs after a verified
open/open-at, while that passkey's login scope is still active. It does not run for
account creation or an authenticated `ownerSession` composition. Its
`BrowserLoginKeys` exposes only `deriveWalletSeed()`, not raw PRF outputs, reader
secrets or an owner signer. Each call returns a fresh caller-owned seed copy.

This complete RC8 module adds the callback to a host's normal passkey
composition. The host supplies the wallet operation; the SDK does not connect a
wallet or retain a session automatically:

```ts
import {
  createBrowserPassport,
  type BrowserPassportConfig,
} from '@input-output-hk/mn-passport-adapter-browser';
import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';

export function passportWithWalletLogin(
  config: Omit<BrowserPassportConfig, 'onAccountOpened' | 'ownerSession'>,
  useSeed: (account: PassportAccount, seed: Uint8Array) => Promise<void>,
) {
  return createBrowserPassport({
    ...config,
    onAccountOpened: async (account, keys) => {
      const seed = keys.deriveWalletSeed();
      try {
        await useSeed(account, seed);
      } finally {
        seed.fill(0);
      }
    },
  });
}
```

Call `openAccount` or `openAccountAt` from the host's reviewed user action. Use the
login handle inside the awaited callback; it refuses after that login scope ends.
Do not save `keys` for a later click. If `useSeed` retains its own copy or creates a
wallet runtime, the host owns that copy/runtime's lifetime and teardown; this
example clears only the seed it derived. A callback failure rejects the open call,
but does not delete an existing account or reverse earlier effects.

The handoff is absent from published RC7. It does not enroll or unlock a full
owner, grant authority, persist private material, or choose a routine lifetime.
The [demo guide]({{ '/demo-guide/' | relative_url }}) describes that host's additional
routine-reader and wallet policy; other hosts choose their own custody and consent.

## RC8: caller-owned inputs {#source-preview-caller-owned-inputs}

The source after RC7 admits an owned keyring/recipient/entry snapshot **before**
opening an asynchronous key-source scope. Device delivery, key creation, coin
opening/re-encryption and grant sealing use that snapshot throughout the operation.
Changing a caller's array, `Buffer`, destination or registration while a credential
request is pending cannot redirect the admitted operation. Caller-owned input bytes
are not zeroed as a side effect. Hosts still own their original copies and must
clear secret material when their own scope ends.

Admission retains the existing **4,096-entry** bound for each supported envelope,
registration and inbox collection. Only exact 192-byte wire entries are copied;
malformed entries remain non-opening noise instead of causing an unbounded copy.
The bound applies to the initial snapshot, not a mutable collection after a key
request. It is a resource admission limit, not a qualified large-inbox latency budget.
Low-level grant view opening checks its fixed wire size before copying input bytes.

The encrypted mutation journal also serializes the admitted document before key
access. Its ciphertext, authenticated revision and byte-store compare-and-swap use
the same captured revision. A caller editing `next` while PRF/crypto is pending
cannot create an acknowledged record that the next read cannot authenticate.
The injected store must still provide atomic, crash-durable CAS; encryption cannot
supply those storage guarantees. See [recovery contracts]({{ '/durability/' | relative_url }}).

These ownership changes preserve existing wire suites, key domains and public
method signatures. TypeScript `readonly` communicates intent; runtime admission
protects the tested asynchronous boundaries. It is not a JavaScript sandbox for
hostile getters, arbitrary provider code or concurrent shared-memory writes.

## Account viewing secrets and recovery

In Lace's JubJub Passport flow, a fresh random 32-byte account viewing secret determines the ACC's X25519 `enc_key`. The secret is sealed into 192-byte on-chain device envelopes. Each enrolled passkey derives a network-specific X25519 reader key with the MIP-0015 domain `lace-passport:reader:v1`; that reader opens its envelope during a key session. The PRF-derived JubJub signer, reader key, account viewing secret, and wallet HD seed have separate roles. `recipeDeviceKeyring` implements the typed viewing-key port: it creates and delivers envelopes, opens coin descriptions under live and recent secrets, re-encrypts coins during rotation, opens device and grant records, and seals a read grant to its recipient's X25519 key. The account create/open and host-backed rotation flows use this port. Grant-aware rotation and a chain-backed holding-verification adapter are implemented. Complete host sources and durable grant openings are required; interrupted-rotation recovery remains a preview limit.

### Wire-format compatibility

At Lace PR #2845 merged head `502b0794cc7bcfc76342230193fef4ebb63cae1c`, device envelopes (`0xd1`), JubJub registrations (`0xd2`) and grant records (`0xd3`) use suite `0x02`. The envelope recipient tag covers the entire sealed entry except its tag and the AEAD associated data excludes that tag; grant records use an HMAC tag over the same frame. The SDK writes that suite and opens both suite `0x02` and its earlier suite `0x01` records, so existing sealed SDK accounts remain readable. The 192-byte coin description keeps its separate custody suite `0x01`. Exact Lace known-answer bytes are checked in `tests/keys-lace-suite2-interop.test.mjs`; synthetic localnet cross-product opening has passed at the pinned Lace head. Real passkey-provider and complete hosted-flow qualification remain limited; see the Lace handover guide.

### Recovery and loss of a device

If one enrolled device is lost, another enrolled device can open its own envelope and use `removeDevice` to exclude the lost reader while rotating the viewing and roster keys. Supply the complete live device/grant and verified-holding sources required by removal; ordinary rotation does not decide which still-live device was lost. A synced passkey may also be usable on a replacement device if its provider restores the same credential and PRF outputs. If all enrolled authorising devices and their recoverable passkeys are lost, the envelopes alone do not provide an account recovery path. When adding a device while read grants are live, `addDevice` rotates the viewing and roster keys before sealing to the joiner, so it can refuse enrollment if a live grantee or surviving device cannot receive the new secret. The browser's P-256 create/open flow now also generates a random ACC secret and checks its sealed device envelope against the live `enc_key`; accounts made with the earlier passkey-derived `lace-passport:acc-enc:v1` recipe are explicitly refused by the new browser composition until migrated.

### P-256 registration policy

The keyring seals the current P-256 registration as a 192-byte suite `0x02` type `0xd5` record. Its authenticated plaintext contains a 32-byte X25519 reader key, canonical compressed 33-byte P-256 key, 32-byte RP id hash and 21-byte origin. It uses HKDF info `mn-passport:device-registration:p256-policy:v1`; the 118-byte plaintext leaves 44 zero padding bytes after the encrypted payload. The earlier type `0xd4` stores only the reader and P-256 key and remains readable, but lacks the policy needed to resolve another live P-256 device. JubJub registrations retain Lace's type `0xd2` and 32-byte compressed key. The P-256 registration is an SDK wire-format extension; Lace PR #2845 currently decodes only the JubJub `0xd2` record. The [wire-format decision](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/adr/0009-versioned-p256-device-registration.md) specifies type, suite, padding and downgrade behavior. The P-256 browser flow publishes its envelope and registration with `append_inbox_with_p256` before reporting the account active. It can resume publication after an interrupted create. Hosts must supply chain-backed holding and grant sources for the supported owner flows. The reference demo wires these sources; the two-browser ceremony still needs separate manual localnet validation.

### Resolve live rotation readers

Before a JubJub rotation delivers a new account secret, `resolveJubjubReaders` matches each opened registration to a live on-chain device commitment at its current epoch and use counter. It excludes removed devices and drops conflicting reader/device claims. A registration in the inbox does not by itself grant access to the new secret. `rotateViewingKey` also requires a host to identify verified, distinct holdings from chain outputs; it refuses grant records until those readers can receive a fresh seal. The package flow has focused binding tests and a mixed-device localnet probe; a Lace-hosted consumer run remains open.

The account package also exports `resolveRegisteredReaders` for mixed JubJub/P-256 rosters. It uses the registration's authenticated P-256 policy to derive each candidate ACC commitment, then retains only unique reader-to-live-entry matches. Earlier `0xd4` P-256 registrations have no policy and are dropped. Both owner arms use this resolver for mixed rotation when the key port supplies the P-256 decoder, and refuse a live device without a unique registered reader. Rotation also refuses any surviving read grant whose recipient cannot receive a fresh seal. Removal excludes the target from both the fresh viewing and roster keys.

### Open a known account address

After a P-256 owner enrolls a second device, that passkey can call `openAccountAt(address)` with the ACC address supplied by its host. The flow verifies the selected credential and policy, locates its live ACC device entry, and opens an inbox envelope against the current ledger `enc_key`; it does not rely on a directory hint or expose the raw viewing secret. A host must supply the known address and an already-enrolled passkey; this does not discover accounts or recover a lost passkey. The reference demo exposes it through account-address login. P-256 rotation is available to hosts that supply verified holdings and a complete live read-grant source.

### Remove a device

`removeDevice` uses a fresh roster key as well as a fresh viewing secret, excludes the target
reader before sealing, and refuses a surviving reader that shares a key with the target. It then
calls the owner's `remove_device_with_jubjub` or `remove_device_with_p256` circuit and confirms the target left the live ACC set. The operation
spans several chain transactions; an interruption may require the owner to resume from its new
sealed keyring before trying removal again.

## Device-entry removal boundary

`removeDevice` removes one opaque entry and excludes its reader from fresh sealed
keys. It cannot certify complete compromised-key revocation or erase prior viewing
knowledge. Ambiguous rosters and grants to the removed reader must be reconciled
before removal. Total-loss recovery remains unavailable on the retained binding.
See [Qualification and safety boundaries]({{ '/qualification/' | relative_url }}).

Removal excludes target metadata from the fresh roster. A fresh legacy invocation
may refuse after an interrupted key switch, as do other legacy rotations of that
unresolved roster. An original protected continuation needs the opt-in RC6 durability API and an unchanged checked frontier; it is not provided by the legacy flow.
The unanchored history port is removed. Earlier secrets remain bounded decryption
candidates; they neither authenticate metadata nor evict genuine older holding keys.

### Historical candidate correction — 2026/10/24

The global sixteen-key truncation/refusal is withdrawn: anonymous earlier envelopes
must neither evict a genuine old coin key nor lock sign-in. All distinct earlier
secrets within the existing 4096-envelope bound remain decryption candidates, and
are zeroed after use. Only the ledger-matching current secret/roster authenticates
metadata; earlier candidates never identify device-removal targets. The regression
places a real older coin behind seventeen forged envelopes and verifies metadata,
coin reads, device delivery and new key creation remain usable. Large-inbox work
still scales with candidate keys and coin entries; the existing 4096 limits and
operator/resource qualification remain explicit. No unbounded-input guarantee.

## RC6 opt-in durability boundary

{% include durability-boundary.md %}



