# Midnight Passport SDK 0.1.0-rc8 handover

[Release](https://github.com/input-output-hk/midnight-passport-sdk/releases/tag/sdk-v0.1.0-rc8) ·
[Library guide](https://input-output-hk.github.io/midnight-passport-sdk/library-guide/) ·
[Demo guide](https://input-output-hk.github.io/midnight-passport-sdk/demo-guide/) ·
[Install](https://input-output-hk.github.io/midnight-passport-sdk/getting-started/) ·
[Limitations](https://input-output-hk.github.io/midnight-passport-sdk/release-notes-rc8/)

Nine private GitHub npm packages share **`0.1.0-rc8`**, distribution tag `next`.
Request package read access for your user/team and consuming Actions repository.
Keep the token in user configuration, outside source control:

```ini
@input-output-hk:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```sh
npm install --save-exact \
  @input-output-hk/mn-passport-account@0.1.0-rc8 \
  @input-output-hk/mn-passport-adapter-browser@0.1.0-rc8 \
  @input-output-hk/mn-passport-adapter-service@0.1.0-rc8 \
  @input-output-hk/mn-passport-contract@0.1.0-rc8
```

Adopt the contract/assets, helpers or adapters you need. Hosts own consent,
credential custody, persistence, transaction routing and finality. No replacement
of Lace orchestration or adoption of the demo UI is required. A separate Lace
Wallet connection grants no ACC authority. Core packages remain framework-neutral.

RC8 adds validation/brands, `account/authorisation`, optional secret-store/background
ports, combined verified login and bounded scoped grants. The reference demo adds
nested navigation, Activity/audit, fresh critical consent and an owned wallet worker.
Binding remains `acc-s3r1.1` / Passport6458ed5 / Compact0.35.0 / runtime0.20.0.

The GPG-signed `rc8-publication-receipt.json`, `SHA256SUMS` and `IMAGES.txt` release
assets record actual package hashes/SRI/provenance and immutable image digests.
Private npm tarballs are not public attachments. Three public Linux/amd64 images
still require explicit operator policy and Linux-prepared contract mounts.

**Limits:** exact-value shielded withdrawals; no partial change, total-loss
recovery, complete compromised-key revocation, full Lace/provider or real
Google/iCloud restoration acceptance. Grant bookkeeping recovery needs its
original issuing reader. Default demo mutation buttons are not automatically
durable jobs. Full-owner page-memory keys can be copied; local expiry is not
chain revocation. Unknown effects retain original IDs without replay or silent
owner fallback. Wider service/funding runtime readiness and CI latency remain
open. Earlier native receipts retain their original versions; this release does
not assert a new native funds lifecycle on RC8 images.
