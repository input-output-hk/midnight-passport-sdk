# X9a — the dapp in a browser with a mock passkey (2026/10/07)

A click-through of the real dapp page with the dev-only mock passkey (`?mockPasskey`), standing in
for the recorded run with a real authenticator (X9, still to do). Everything except the
authenticator is real: the page, the connector, the WebAuthn seam and its wa-json134 checks, the
Lace PRF recipe, the service, the proof server and the chain.

| | |
|---|---|
| Page | `http://localhost:5173/?mockPasskey` (Vite dev server), in the Claude desktop browser pane |
| Passkey | Mock: a WebCrypto P-256 key and a PRF secret in `localStorage`, signing exactly as a wa-json134 authenticator (flags UP+UV, 37-byte authenticator data, no extensions) |
| Localnet | Passport localnet on host ports 19944/18088/16300, beside another localnet on the defaults |
| Service | `apps/passport-service` at `127.0.0.1:8787`, binding `acc-45721e1`, manifest `682bfbd3…` |
| Network | `undeployed` |

## Steps

| Step | Result |
|---|---|
| Create Passport account | Passkey created, enrolment probe passed, encryption key derived from the PRF (Lace recipe v1, MIP-0015, context `undeployed/0`); 10-wave deploy and sponsored activation. Account `34a8c1d8b82c07c64e4ed77ed8e4b950d4bc2dd72af5cc64cf52caaec0d68c06` |
| Rotate encryption key | Passkey-signed `rotate_enc_key_with_p256` (k = 18), proved on the service through `/prove-tx`, sponsored, confirmed: transaction `9c07f6321fcafbc6…` |
| Reload, Open with passkey | Same account; the registry record was checked against the chain (the passkey owns the stored key, the contract exists, the device entry is on the ledger). State: booted, auth nonce 1, one device |
| Connect built-in wallet | Seed from the passkey's PRF (Lace recipe v1: root salt, wallet-entropy HKDF, 24 words, BIP-39 seed). DApp Connector API 4.1.0, `connected` on `undeployed`; synced against the localnet indexer from the page (so the indexer accepts the page's origin). Unshielded `mn_addr_undeployed15233pmws2h07ncm0xdsgvl5z6f8c8j0dhwsfwgr24xfukhmk6gtq4q36xg`, Dust `mn_dust_undeployed1da8dwnvxuaj5nct3srm9j3xf6wshegczga25f0kxphfw8jkx8eyqydrz53`; balances empty, as expected for a new wallet |
| Rotate encryption key (after reopen) | The use counter was rescanned; confirmed at block 358, transaction `8074d5cf29c64099c8b9e921175ab44c7e957ba316810aff6e5d759eda308e2c`; auth nonce 2 |

## What this does not cover

- A real authenticator: platform passkey UI, real PRF support, and real clientDataJSON from a
  browser. That is X9, the recorded manual run with a real passkey.
- A second machine with a synced passkey.
