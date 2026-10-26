---
layout: default
title: Demo use cases
permalink: /use-cases/
---

This catalogue describes the controls available in the local demo on `passport-acc-prototype`.
It is an evaluation guide for engineers, not a claim that every flow is qualified with every
passkey provider or with Lace. The pinned contract is `acc-s3r1.1` from upstream `6458ed5`.
See the [Lace handover guide]({{ '/lace-handover/' | relative_url }}) for qualification evidence
and the [circuit matrix]({{ '/circuits/' | relative_url }}) for SDK coverage beyond these controls.

## Prepare the demo

Follow the repository's [setup guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/AGENTS.md).
The standard launcher is:

```sh
PASSPORT_REPO=/path/to/passport nix develop -c pnpm demo up
```

Open exactly **http://localhost:5173/**. Passkeys are bound to that origin. Use a PRF-capable
provider. The default authoriser is P-256; `--arm jubjub` selects the JubJub preview. For a
software-only trial, add `--mock-passkey`; its localStorage credentials are development-only.
Do not clear site data or reset the chain while evaluating an existing account.

For funding and unshielded withdrawal controls, prepare the private token and allowlisted
asset policy using the [funding service guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-funding-service/README.md), then launch:

```sh
PASSPORT_REPO=/path/to/passport \
PASSPORT_FUNDING_TOKEN_FILE="$HOME/.midnight-passport/funding-token" \
PASSPORT_FUNDING_ASSETS_FILE="$HOME/.midnight-passport/funding-assets.json" \
nix develop -c pnpm demo up --funding
```

The local funding wallet has genesis NIGHT. A custom test token must already be held by that
wallet and included in its policy. The browser never receives its seed or funding bearer token.

## Available scenarios

| Use case | Prerequisites and controls | Expected result and boundary |
| --- | --- | --- |
| Create a sponsored smart account | **Create account**, then complete the passkey prompts. | Ten deployment waves, activation and sealed-key publication create the ACC. The service proves and pays fees. No HD wallet seed phrase is required for the ACC. |
| Reopen after a reload | **Open with passkey**, selecting the enrolled credential. | The browser checks live membership and opens the sealed viewing secret; the ACC address stays the same. |
| Open a known ACC on another enrolled device | Enter **Known Passport ACC address**, then **Open by ACC address**. | Opening works without this profile's local account hint. The address alone cannot grant access or recover a lost passkey. |
| Inspect live account state | Open the ACC, then **Refresh ACC state**, **Read device roster** or **Read grant roster**. | Read live counters, device commitments and grant status. ACC balances require the funding backend. These reads do not require a passkey prompt. |
| Receive localnet NIGHT or a test token | Run with `--funding`, open an ACC, select the asset and choose **Fund Passport account**. | The separate funding wallet deposits up to ten smallest units of an allowlisted asset into the ACC. This funds the ACC, not the built-in wallet. |
| Connect the separate built-in HD wallet | **Connect built-in wallet**, then consent with the intended passkey. | A separate passkey-derived wallet exposes addresses and synced balances through the DApp Connector API. It is read-only in this demo. |
| Receive an ACC withdrawal in that wallet | Copy the built-in wallet's unshielded address, enter it as the withdrawal recipient, choose the asset and amount, then **Withdraw from Passport account**. | Review the network, address and amount before owner passkey consent. The ACC balance decreases after confirmation. The recipient must be a valid unshielded address on the same network. |
| Update the displayed wallet balance | Connect the wallet once, then **Refresh wallet balance** in its panel. | Reuse its current connection to read NIGHT, token and DUST balances after sync, with no additional passkey prompt. The UTC snapshot time and public balances are logged. This does not update the ACC card. |
| Inspect shielded holdings | Open an ACC that already has shielded deposits, then **Read shielded holdings**. | Only inbox coins verified against live ACC outputs, positions and spend state appear. Unshielded faucet deposits do not populate this panel. There is no shielded deposit/withdrawal control in this page. |
| Enrol a second device | In a second browser profile, enter the ACC address and **Prepare joining device**. Transfer its public handoff to the owner, compare fingerprints, then **Enroll joining device**. | The joining passkey is added to the live roster and receives a sealed viewing key. It can then open by ACC address. The handoff contains public keys only. |
| Rotate viewing keys or remove a device | Read the live roster, then **Rotate sealed viewing key** or enter a complete commitment and **Remove device entry**. | The SDK checks devices, verified holdings and active read-grant openings before resealing. Missing openings stop the operation. Removal can span several transactions; inspect live state after interruptions. |
| Delegate limited unshielded spending | Prepare a grant-holder passkey in a separate profile. The owner enters its public key, asset, fixed recipient, per-call limit and total cap, then **Issue scoped grant**. | A live grant restricts the named JubJub holder's spending scope. The owner uses **Export grant opening** to pass its opening directly to the holder. |
| Spend, revoke or recover a grant | Holder: paste its opening and **Spend scoped grant**. Owner: **Revoke scoped grant** or **Recover pending grants**. | Spending checks the live scope and spent counter. Revocation leaves an inactive tombstone. Recovery resumes staged publications from this profile's encrypted journal; it cannot recreate openings lost by clearing browser storage. |
| Explain or diagnose operations | Expand **Operation trace (requests and responses)**, then **Copy full log**. | Export timed stages, public requests/responses, transaction identifiers, addresses and balance snapshots. Seeds, viewing secrets, PRF values and funding tokens are excluded. Grant openings are handed off separately. |

## A short NIGHT round trip

1. Create or open an ACC and connect its built-in wallet.
2. Fund the ACC with `10` NIGHT smallest units.
3. Copy the built-in wallet's **Unshielded address** into the withdrawal recipient.
4. Withdraw `1`, reviewing the network, asset, destination and amount before signing.
5. Confirm the ACC shows `9`, then choose **Refresh wallet balance**. A previously empty
   recipient wallet should show `1` after its indexer sync catches up.
6. Copy the full log to show the deposit, withdrawal and updated wallet snapshot to colleagues.

All amounts above are **base units**, not whole NIGHT. Wallet refresh is manual and may wait
up to 120 seconds for sync. If the indexer has not observed the transfer yet, refresh again.
A failed read displays unavailable balances; it does not mean the transfer failed. A failed or
uncertain submission also does not prove funds stayed put: inspect the saved transaction and
live chain before retrying. Funding retries must reuse the original request ID until reconciled.

## Evaluation limits

- These browser controls are an SDK prototype. Node-backed/synthetic evidence does not qualify
  every real passkey ceremony or two-browser flow. Consult the [handover]({{ '/handover/' | relative_url }})
  and [Lace evaluation boundary]({{ '/lace-handover/' | relative_url }}) before integration.
- NIGHT funding is qualified only on the `undeployed` localnet. The built-in wallet cannot send
  funds from this page; ACC withdrawals are owner-authorised smart-contract operations.
- Shielded SDK withdrawals retain the exact-value guard. Partial spends and durable change/spent
  reconciliation remain deferred under #201; complete typed circuit coverage is tracked by #82.
- Losing every enrolled and recoverable passkey cannot be repaired using only the ACC address.
- The proving service sees private proof inputs and sponsors transactions. Use controlled ingress;
  the prototype is not a hardened public faucet or a claim of full Lace compatibility.

## Device-entry removal boundary

`removeDevice` removes one opaque entry and excludes its reader from fresh sealed
keys. It cannot certify complete compromised-key revocation or erase prior viewing
knowledge. Ambiguous rosters and grants to the removed reader must be reconciled
before removal. Total-loss recovery remains unavailable on the retained binding.
See [Qualification and safety boundaries]({{ '/qualification/' | relative_url }}).
