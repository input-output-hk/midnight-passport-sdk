# Midnight Passport SDK 0.1.0-rc7 preview

- [Release](https://github.com/input-output-hk/midnight-passport-sdk/releases/tag/sdk-v0.1.0-rc7)
- [Install and connect](https://input-output-hk.github.io/midnight-passport-sdk/getting-started/)
- [Package responsibilities](https://input-output-hk.github.io/midnight-passport-sdk/packages/)
- [Use cases and test evidence](https://input-output-hk.github.io/midnight-passport-sdk/use-case-coverage/)
- [Limitations](https://input-output-hk.github.io/midnight-passport-sdk/release-notes-rc7/)

Nine implemented packages are private GitHub Packages at **`0.1.0-rc7`** (`next`).
Ask a package administrator to grant your team/user and consuming Actions repository
read access. Supply a token with `read:packages` through user configuration:

```ini
@input-output-hk:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```sh
npm install --save-exact \
  @input-output-hk/mn-passport-account@0.1.0-rc7 \
  @input-output-hk/mn-passport-adapter-browser@0.1.0-rc7 \
  @input-output-hk/mn-passport-adapter-service@0.1.0-rc7 \
  @input-output-hk/mn-passport-contract@0.1.0-rc7
```

Adopt the contract/assets, helpers or adapters your host needs; our demo
orchestration is optional. RC7 adds compiler dependency export for application→ACC
calls, capability/proof-plan inspection, safer original-intent shielded-deposit
continuations and optional `beforeCeremony` WebAuthn purposes. The demo adds explicit
operation/retirement reviews and repeatable synthetic Playwright journeys.
ACC binding remains `acc-s3r1.1` / Passport `6458ed5` / Compact 0.35.0 / runtime 0.20.0.
Keep one physical runtime instance, the documented exact peers and matching client/backend versions.

**Preview limits:** exact-value shielded withdrawals only; no partial change,
total-loss recovery, complete compromised-key revocation, full Lace or blanket
Google/iCloud recovery claim. The native/host evidence retains its original source
and RC6 pins; RC7 publication does not rerun those flows. Expiring local JubJub
session grants remain proposed in #281 /0.2.0. Keep operator tokens outside browsers
and reconcile unknown operations by their original IDs.

Three public Linux/amd64 images are pinned in the release's `IMAGES.txt`.
Service/funding need Linux-prepared pinned contract mounts and durable private
operator state. `rc7-publication-receipt.json`, detached GPG signatures and
`SHA256SUMS` record actual package SHA/SRI, provenance, visibility, installation
and image checks. Private npm tarballs are not public release attachments.
