# Midnight Passport SDK 0.1.0-rc6 preview

Release: https://github.com/input-output-hk/midnight-passport-sdk/releases/tag/sdk-v0.1.0-rc6
Docs: https://input-output-hk.github.io/midnight-passport-sdk/
Install: https://input-output-hk.github.io/midnight-passport-sdk/getting-started/
Limits: https://input-output-hk.github.io/midnight-passport-sdk/release-notes-rc6/

Nine packages are private on GitHub Packages, under `@input-output-hk/mn-passport-*`,
all at `0.1.0-rc6` (`next`). Ask a package administrator to grant user/team and
consuming Actions repository read access. Use a token with `read:packages` or the
authorised Actions repository token. Keep authentication in user configuration:

```ini
@input-output-hk:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Install the entrypoints your application imports; for the minimal browser flow:

```sh
npm install --save-exact \
  @input-output-hk/mn-passport-account@0.1.0-rc6 \
  @input-output-hk/mn-passport-adapter-browser@0.1.0-rc6 \
  @input-output-hk/mn-passport-adapter-service@0.1.0-rc6 \
  @input-output-hk/mn-passport-contract@0.1.0-rc6
```

Node tooling requires Node 22+. Compose the ports and host-owned durable record
store as described in the docs; package installation alone does not deploy an ACC.
Keep one physical Compact runtime instance and the exact pinned peer versions.
Client/backend versions must match for identity-bound host-job result collection.

RC6 adds portable/hosted key adapters, opt-in durable owner and operator host jobs,
original-reader grant reconstruction, reduced proving profiles with all verifier
keys, and installed-package interruption checks. The default demo composition
stays unchanged. ACC binding is `acc-s3r1.1`, Passport `6458ed5`, Compact 0.35.0,
Compact runtime 0.20.0; compiler manifest SHA-256 is
`77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f`.

## Preview limits

- Exact-value shielded withdrawals only; partial spending/change settlement is refused.
- Full Lace hosted-consent/value-route and real passkey-provider recovery remain unqualified.
- Grant bookkeeping needs its original publishing reader; surviving ACC access alone is insufficient.
- Entry removal does not erase earlier disclosures or certify complete compromised-key retirement.
- No total-loss recovery, automatic worker scanner, distributed wallet lock or persistent spending budget.
- Operator job tokens belong in a trusted host/BFF, never a public browser page.
- NIGHT funding is qualified only on the pinned `undeployed` localnet, in smallest units.
- Current release install/transport/startup/key HTTP checks are separate from historical native proof/image lifecycle evidence.

The three public Linux/amd64 GHCR images and exact immutable pins are in
`IMAGES.txt`. Service/funding require Linux-prepared pinned reference exports and
persistent writable operator state; images contain no wallet seed or full prover cache.
Check `rc6-publication-receipt.json` and its detached GPG signature for all package
SHA-256/SRI, image digests, checks and deferred issues. Do not use private npm
tarballs as public release attachments. The release contains only hashes and public receipts.
