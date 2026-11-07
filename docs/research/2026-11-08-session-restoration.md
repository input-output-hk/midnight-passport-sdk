# Session restoration and passkey access

Research date: **2026-11-08**. Public source and anonymous staging assets only;
no user account, credential, wallet or browser storage was inspected.

## Answer

The upstream demo can return to a usable wallet without a new passkey request
because it **persists the wallet seed and restores that capability**. It does not
infer authentication from a trusted-machine flag. Fresh account-control actions
have a separate passkey approval policy.

For this SDK, distinguish a remembered public account, a verified private session,
a running HD wallet and authority to sign. A remembered address is not any of the
other three. The reference demo requires passkey login and fresh critical approval;
its reviewed routine lease and bounded grant transfers are separate capabilities.

## Inspected versions

| Surface | Pin / observation |
| --- | --- |
| Public demo source | [`d343acf6674b7258e04cad9eb5d64c054f0dfebd`](https://github.com/midnightntwrk/passport-demo/tree/d343acf6674b7258e04cad9eb5d64c054f0dfebd), public `main` checked on the research date |
| Public planning source | [`e0e4e0e6272399d71dfaaa7cae0689ab4e2363f3`](https://github.com/midnightntwrk/passport/tree/e0e4e0e6272399d71dfaaa7cae0689ab4e2363f3) |
| Anonymous staging entry asset | `main-C7YCFX-o.js`, SHA-256 `3f99382a7171106f81018773ece5506c81f03f6f90b7a8825bbc5d9f1d4533f8` |
| Staging service worker | Build marker `362ee84c685ebb8b`; SHA-256 `9b7fb5a3d25883788999ae424100f4b34706eb4b78f82764ccb44345527cb4ff` |

The live entry asset contains the persistence/restore implementation described
below. This links the observation to deployed public code; it does not attest a
source-to-deployment mapping, genuine provider UX or a particular user's session.

## Upstream wallet restoration

The source [persists the wallet session](https://github.com/midnightntwrk/passport-demo/blob/d343acf6674b7258e04cad9eb5d64c054f0dfebd/examples/passport-demo/src/App.tsx#L1306-L1464)
and [restores it on mount](https://github.com/midnightntwrk/passport-demo/blob/d343acf6674b7258e04cad9eb5d64c054f0dfebd/examples/passport-demo/src/App.tsx#L2461-L2572):

1. After deriving its wallet seed, the demo encrypts the 32-byte value with a
   random AES-GCM-256 `CryptoKey` and a random 12-byte IV.
2. IndexedDB `midnight-passport-session` / `wallet-sessions` / `active-session`
   stores the ciphertext **and the usable decrypt key**, plus public scope hints,
   credential ID and `createdAt`. A legacy per-scope record can also be read.
3. On reload, the demo retrieves the key, decrypts the seed, rebuilds the wallet,
   restores the public profile and displays Home. This makes no credential call.
4. The reader does not enforce `createdAt` or a persisted expiry. Signout attempts
   to remove current/legacy records and close the wallet; deletion is best effort.

This is actual persisted private wallet material. A nonextractable WebCrypto key
prevents raw key export through that API, but same-origin script can still obtain
and use it to decrypt. Storing both in the origin therefore does not provide a
new passkey or OS-authentication gate. The upstream comments identify this as a
demo storage stopgap. Do not copy it and describe it as proof of current user
verification, secure hardware custody or a fresh passkey login.

Upstream and SDK seed recipes are independently pinned; the observed 32-byte
upstream seed is not permission to change this SDK's existing 64-byte Lace recipe,
labels, addresses or sealed-reader derivation.

## Upstream account approval is separate

The current [custody policy](https://github.com/midnightntwrk/passport-demo/blob/d343acf6674b7258e04cad9eb5d64c054f0dfebd/examples/passport-demo/src/lib/custodyApproval.ts#L1-L66)
explains that earlier page-lifetime cached JubJub keys could sign later payments
without another request. The current policy obtains a fresh assertion per logical
value/control action, reuses its key for that action's transactions and then
[forgets the signer](https://github.com/midnightntwrk/passport-demo/blob/d343acf6674b7258e04cad9eb5d64c054f0dfebd/examples/passport-demo/src/identity/passkeyCustody.ts#L1-L53).
The [one-shot PRF provider](https://github.com/midnightntwrk/passport-demo/blob/d343acf6674b7258e04cad9eb5d64c054f0dfebd/demo-backend/src/passkey.ts#L1115-L1265)
can derive multiple needed values in one assertion before disposal.

A restored ordinary wallet therefore does not establish a restored ACC owner,
its PRF-gated private-state keys or blanket account-control consent. A separately
configured signing provider may hold another legitimate key, but a provider
connection alone does not confer ACC ownership or permission.

Browser autofill/conditional UI and [Chrome Immediate UI](https://developer.chrome.com/docs/identity/immediate-ui-mode)
can alter credential selection UX; they do not replace assertion validation or
supply silent ownership. Current Immediate UI uses `uiMode: 'immediate'` with a
capability check. No such mechanism was found in the pinned upstream restore path.

## Reusable library boundary

| Capability | Required evidence / host responsibility |
| --- | --- |
| Remembered account | Valid public network/binding/address metadata. Display it as locked. No private read, signer, wallet connection or authenticated claim follows restoration. |
| Verified account open | Existing credential/PRF proof, live membership and sealed-reader checks. The optional successful-open hook may hand off routine keys inside the same scope. |
| Routine access | Explicit host-owned lifetime, account/credential binding and revision. Lock, visibility, page exit and expiry dispose its owned material. |
| Critical action | Exact reviewed intent and route, fresh approval as required by host policy, checked live authority and no expiry fallback. |
| Scoped transfer | Separately approved recipient/asset/caps/expiry, exact transfer consent and persistent unknown-effect fences. |
| Persistent custody | An explicitly selected provider/store and documented protection, access, expiry and removal behavior. A byte-store read is not a user-verification or authorization proof. |

The [secret-store ADR](../adr/0016-host-secret-custody.md) provides an injectable
async store. Its IndexedDB reference requires explicit plaintext opt-in and reports
`protection: 'none'`; it automatically persists no owner or wallet seed. A future
OS/Lace-backed provider can implement host custody through an explicit protocol.
Returning exportable bytes cannot promise a nonexportable signing vault.

## Local implementation direction

- Keep passkey login and fresh critical approval. A cached in-memory account can
  remain open during navigation; Home selects Balances rather than presenting a
  new login form or starting another credential request.
- Restore only validated public metadata by default, with a visible locked state
  and an explicit passkey unlock action. Never authenticate from a local boolean.
- Preserve the ordinary wallet's separate lifecycle: routine lock does not
  disconnect an already running wallet. Do not claim all its internal material
  disappeared when only the routine cache was disposed.
- Any future persistent private session must be a separately reviewed host option,
  with expiry and close/removal failure semantics. No automatic owner enrollment,
  seed persistence, partial shielded spends or new recovery guarantee follows this
  research.

Software and synthetic-browser tests can demonstrate these application contracts.
Actual Google/iCloud restoration, provider sheets, native browser/proof integration
and released-package behavior retain their separate qualification requirements.
