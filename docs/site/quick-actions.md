---
layout: default
title: Quick actions and passkey approval
permalink: /quick-actions/
---

**Source preview after RC7.** Quick actions keeps explicitly approved routine key
material in this page's memory for **10, 15 or 30 minutes**. It does not turn a
wallet connection or a login into unrestricted ACC spending authority.

## Try it

1. Create or open your Passport account using its existing passkey.
2. In **Passport account → Manage quick actions**, or **Settings → Quick actions**,
   choose a lifetime and select **Unlock quick actions**. Review the purpose, then
   approve the pinned passkey PRF request.
3. **Read shielded holdings** and **Connect built-in wallet** now reuse the unlocked
   material. Repeating them within this session does not request the passkey again.
   They retain their operation reviews and chain/network/credential checks.
   If the lease expires or locks while reviewing or starting an action, it stops;
   the page does not silently replace the reviewed routine path with a passkey request.
4. To use JubJub for a transfer, choose the withdrawal asset and recipient, then
   approve the separate **Transfer permission** and its caps/expiry. Issuing that
   permission is a critical owner operation and still needs fresh passkey approval.
5. Each matching withdrawal has an exact transfer review and uses the scoped
   JubJub signer. The recipient, asset, per-transfer and total caps are enforced.
   A failed or uncertain spend never falls back to an owner transfer.
6. **Lock quick actions** clears the routine cache and its derived grant signers.
   A transfer session authorized independently has its own **Lock on this device**
   control; unlocking or locking the routine cache does not replace that session.
   Hidden tab and page exit lock both. Each session also enforces its own expiry.
   Reload never restores a secret.

## Which key is used?

| Operation | Key / approval |
| --- | --- |
| Public balances, account state and rosters | Public reads; no private key is needed. |
| Private holdings | The existing passkey-derived **X25519 reader key**, through a bounded reader session and live holding verification. JubJub signatures do not decrypt envelopes. |
| Built-in wallet connection | The same **Lace recipe HD wallet seed** derived from PRF root output, preserving the wallet's address. It is distinct from the ACC viewing secret. |
| Matching capped transfer | A separate **PRF-derived JubJub grant child**, usable only after the owner issues its bounded on-chain permission. |
| Add/remove device, rotate viewing keys, issue/revoke permissions, owner transfer | Fresh owner passkey path. The routine cache supplies neither its P-256 signature nor JubJub owner secret. |

The first PRF output, used by a JubJub owner, is erased immediately. The routine
cache retains the second output's derived wallet seed and network reader key,
not the raw PRF outputs or an owner signing key. Grant children are derived under
their own domain and fresh grant context. The displayed local public key does
not itself add an owner or grant permission. JavaScript cannot guarantee erasure
of engine temporaries; the implementation clears its owned arrays and disposes
its child signers. Nothing secret is written to localStorage, Audit or the log.

Local expiry is not chain revocation. A copied grant key can retain its on-chain
permission until chain expiry or confirmed revocation. Grant scope has its own
deadline; a local quick-actions lock may stop signing sooner. Renewal retains
the existing revoke-before-reissue and unknown-intent rules. A connected built-in
wallet is a separate component: locking the quick-actions cache does not
disconnect that already running wallet or erase its own internal material.

## Engineer integration

The foundation packages remain framework-neutral. The optional
`PassportPorts.routineViewingKey` / `BrowserPassportConfig.routineViewingKey`
factory accepts an account, network, binding and credential context, and returns
only an `openInbox` reader or `undefined`. It is consulted **only** by the verified
holdings flow. Live account/device checks, live encryption-key matching and
chain-backed coin verification still run. Critical flows use their original key
ports. An absent session follows the existing explicitly consented passkey path.

The demo's memory lease and presentation live in
`apps/passport-dapp/src/routine-keys.ts` and `routine-access.ts`; they are host policy,
not a new SDK package or an implicit global cache. A partner may inject its own
bounded reader implementation without adopting our UI or a React dependency.
Do not retain raw owner material, return an unbound reader for another credential,
or silently issue a grant while opening an account.

## Evidence boundaries

Unit tests exercise real key derivation/envelope opening, expiry, clock rollback,
late unlock cancellation, context mismatch and signer disposal. SDK tests cover
both owner arms, chain-verified holdings and critical-flow isolation. Browser
journeys count actual synthetic credential accesses: one explicit unlock,
repeated holdings/wallet operations without more requests, fresh critical owner
approval, and lock/page-exit behavior. These checks do not qualify a real passkey
provider, browser/native proof combination or a published release.

[Passkey purposes]({{ '/passkey-prompts/' | relative_url }}),
[scoped transfer permissions]({{ '/jubjub-sessions/' | relative_url }}),
[demo navigation]({{ '/demo-ui/' | relative_url }}).
