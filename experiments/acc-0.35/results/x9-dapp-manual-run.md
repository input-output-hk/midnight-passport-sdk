# X9 — the dapp in a browser with a real passkey (2026/10/07)

The owner's click-through of the demo page with a platform passkey: no mock, no software
authenticator. The page, connector, WebAuthn seam (wa-json134), Lace PRF recipe, service, proof
server and chain are the same as in X8 and X9a.

| | |
|---|---|
| Page | `http://localhost:5173/` (Vite dev server), Chrome on macOS |
| Passkey | Platform passkey with PRF. A first passkey saved in Chrome's "Chrome profile" store had no PRF and was refused at the PRF step; the retry used a provider with PRF |
| Localnet | Passport localnet on host ports 19944/18088/16300, beside another localnet on the defaults |
| Service | `apps/passport-service` at `127.0.0.1:8787`, binding `acc-45721e1`, manifest `682bfbd3…` |
| Network | `undeployed` |

## Steps

| Time (UTC) | Step | Result |
|---|---|---|
| 07:18:35 | Create: passkey created, enrolment probe, encryption key from the PRF | — |
| 07:18:45 → 07:21:45 | Create: 10-wave deploy | 180 s |
| 07:21:45 → 07:22:09 | Create: sponsored activation | 24 s. Account `e16f92bdc7051ac35f3416284de0d07814b2b4a3adbb33461c8f5daf877b0f4e`; booted, one device |
| 07:24:04 → ~07:25 | Rotate encryption key, passkey-signed | P-256 proof 22.5 s on the proof server; confirmed (auth nonce 0 → 1) |
| 07:26:03 | Reload, Open with passkey | Same account; registry record checked against the chain |
| 07:26:42 | Connect built-in wallet | `UnsupportedAuthenticator`: the picker offered the old Chrome-profile passkey (no PRF) |
| 07:27:16 | Connect built-in wallet, retried | Connected; seed from the passkey's PRF (Lace recipe v1). Unshielded `mn_addr_undeployed1xwujyey0xgq7ly76shr0ppmgcgpugvgd7zcd30zlwnte480hw42spktgpy`, Dust `mn_dust_undeployed1wvc57maud22frf0ff0e6ak85caza2ufmll6xr9kgyfdsy7xccqxk2wvurzy` |
| 07:28:03 | (a passkey prompt dismissed) | `UserCancelled`; nothing submitted |
| 07:29:57 | Rotate encryption key after the reopen | Confirmed at block 8205, transaction `e58efc91cfeb48cb619eade8beac8b5db90d96ca27c1a508beda39286e2d72b2`; auth nonce 2 |

## Findings

- **PRF had to be requested at creation.** The first attempt failed because `browserPasskey.create`
  did not request the PRF extension, and the passkey went to Chrome's profile store, which has no
  PRF. Fixed in PR #16: PRF is requested at creation, and a provider that reports it unavailable is
  refused before any deployment, with advice to use Google Password Manager or iCloud Keychain.
- **The wallet's passkey picker offers every passkey for the origin**, including the old one without
  PRF. The wallet should pin the account's credential (`allowCredentials`) once an account is open.
  Recorded on issue #17.
- **Progress is opaque during the four-minute create.** The owner copied the evidence mid-deploy and
  could not tell whether creation had finished. Issue #17 covers progress events, an event log and a
  progress bar.
