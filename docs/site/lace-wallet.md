---
layout: default
title: Optional Lace Wallet connection
permalink: /lace-wallet/
---

**Local source after RC7.** This optional connection is separate from the
Passport account API, the passkey-derived built-in wallet and `lace-sdk`.
It is not available in published RC7. There is no new package: the small
`mn-passport-adapter-browser/wallet` subpath has no global access on import,
framework dependency, signer, prover or ACC permission logic.

## Try the prototype

1. In **Settings → Wallet connections**, choose **Find Lace Wallet**. Discovery
   reads advertisements only; it never connects automatically. If none is found,
   check the extension and choose Find again. No polling or guessed provider key.
2. Select an advertisement explicitly, even when only one is present. Entries use
   UUID keys under `window.midnight`. The demo filters the self-reported
   `io.lace.wallet` rdns; names/rdns/version are not proof of wallet identity.
   Duplicate advertisements can represent multiple versions or lookalikes.
3. Choose **Connect Lace Wallet**, review the provider and configured network,
   then **Continue to wallet**. You may cancel before the connector is called.
   Inspect the extension's own prompt: the public connector may offer broader
   permissions than the calls this demo makes.
4. **Midnight wallet → Lace Wallet** displays only its validated unshielded
   address, wallet-reported token amounts in **smallest units** and read time.
   NIGHT is the all-zero token color. **Refresh Lace Wallet balance** explicitly
   reads again; no continuous synchronization/finality guarantee is implied.
5. **Forget local connection** drops this page's facade and ignores late results.
   It does not revoke permissions in the extension. Manage those in Lace Wallet.

A connection does **not** open an ACC, enroll a device, deliver a viewing secret,
create a spending grant, choose a recipient or transfer funds. The built-in HD
wallet and its balance controls remain separate. No ACC credential is requested
by this connection. Transfers from an external wallet need a separately designed
and consented value adapter; they are outside this milestone.

Network mismatch, disconnect, unsupported responses and failed reads show
**balance unavailable**, not zero or an old balance as current. The adapter checks
connection status before and after each read and decodes address kind/network
with the host's pinned address implementation. It does not switch networks or
retry a permission request. Errors are coarse public codes, never arbitrary
extension error fields. A rejected/failed request does not establish that the
wallet is locked; the UI suggests checking it without claiming a cause.

## Reuse the read facade

```ts
import {
  discoverWalletProviders,
  connectWalletReader,
} from '@input-output-hk/mn-passport-adapter-browser/wallet';

// Supply the registry and address decoder explicitly. No SDK global discovery.
const candidates = discoverWalletProviders(registry());
const provider = await hostReviewAndSelect(candidates); // explicit user action
const reader = await connectWalletReader(provider, {
  networkId: configuredNetwork,
  registry,
  validateAddress: decodeUnshieldedAddressForNetwork,
});
const snapshot = await reader.read();
// Retain exact bigint amounts; the returned snapshot is immutable.
reader.forget(); // local invalidation, not extension permission revocation
```

The provider object must be the exact frozen candidate returned by discovery.
Advertisement object identity, connect method and reviewed metadata remain pinned
through connection and reads. The returned facade contains only `read` and
`forget`; it never exposes the raw connected API. The host owns request timeouts,
user cancellation, rendering and controller lifetime. The demo additionally uses
a generation fence so a forgotten pending connection cannot republish its result.
A host must handle a provider that never resolves; it cannot cancel the
extension's native prompt through this interface.

The current read subset accepts stable **4.0.x and 4.1.x** advertisements. Other
versions fail closed. The source contract was inspected at public
[`midnight-dapp-connector-api` 4.1.0, commit 7dfc6c0](https://github.com/midnightntwrk/midnight-dapp-connector-api/blob/7dfc6c0fe2dde00dbd24062233b56e56171b9817/src/api.ts).
The [official browser guide](https://docs.midnight.network/guides/browser-dapp)
provides the connection context. This source review and synthetic contract tests
are **not actual Lace extension acceptance or full Lace compatibility**.
No standard `disconnect` or wallet-locked error is invented.

## Evidence boundary

Unit tests cover discovery without globals, unsupported versions, pinned provider
replacement, exact networks, malformed/negative/out-of-range balances, structural
permission refusal, immutable snapshots and late-read invalidation. Actual
Chromium exercises the real demo controls with a synthetic extension:
absent/duplicate providers, text-safe names, cancellation before connect, successful
reads without ACC/credential effects, network drift, rejection, replacement after
review and forgetting an in-flight connection. Both owner-arm configurations run.
Real extension/browser/provider acceptance remains a separate follow-up.

[Demo UI]({{ '/demo-ui/' | relative_url }}),
[interaction models]({{ '/interaction/' | relative_url }}),
[issue #293](https://github.com/input-output-hk/midnight-passport-sdk/issues/293).
