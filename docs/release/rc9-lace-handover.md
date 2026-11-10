# Midnight Passport SDK 0.1.0-rc9 — Lace handover


[Source release](https://github.com/input-output-hk/midnight-passport-sdk/releases/tag/sdk-v0.1.0-rc9) ·
[Private publisher release](https://github.com/input-output-hk/midnight-passport-sdk-publisher/releases/tag/sdk-v0.1.0-rc9) ·
[Developer documentation](https://input-output-hk.github.io/midnight-passport-sdk/) ·
[Signed artifact receipt](https://github.com/input-output-hk/midnight-passport-sdk/releases/download/sdk-v0.1.0-rc9/rc9-publication-receipt.json)

Nine implemented packages use exact version `0.1.0-rc9` on the private GitHub npm
registry. Configure the scope, keep the token outside source control, and install
only the packages your application imports:

```ini
@input-output-hk:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```sh
pnpm add --save-exact \
  @input-output-hk/mn-passport-account@0.1.0-rc9 \
  @input-output-hk/mn-passport-adapter-browser@0.1.0-rc9 \
  @input-output-hk/mn-passport-adapter-service@0.1.0-rc9 \
  @input-output-hk/mn-passport-contract@0.1.0-rc9
```

A local classic token needs `read:packages` and organization authorization; a
consuming Actions repository needs package read access. Repository administration
alone does not grant access to package records owned by the private publisher.

RC9 adds opt-in JubJub PRF-only creation and explicit verified-creation handoff,
demo signing-mode comparison, safe repeated deposits/inventory refusals, account
and native-boundary decomposition, bounded input admission and installed-release
quality/crypto checks. Libraries remain framework-neutral; demo UI, workers,
funding wallets, consent and storage are host wiring choices.

Binding `acc-s3r1.1` / Passport `6458ed5` / Compact `0.35.0` / runtime `0.20.0`
and API `1.0.0-pre.0` are unchanged. Keep client/backend versions together. Use
Linux-prepared contract mounts and immutable image digests from the signed receipt.

Verified all nine actual registry packages: private visibility, exact `0.1.0-rc9`/`next`, SHA-256/SRI, source-equivalent archive contents and 18 source/publisher attestations. A fresh registry consumer passed public imports, strict Node/DOM/Worker examples, six software/generated-contract crypto cases, eight synthetic interruption cases, a browser build and single-circuit restore/export, with unchanged installed inputs and temporary auth removed.

Source-native qualification passed 28 populated lifecycle cases across P-256/JubJub, including six original-operation resumptions. The actual pulled Linux/amd64 service/funding images passed create/activate/read/reopen, NIGHT deposits from 0→10→20 smallest units, same-ID replay without extra credit and an unavailable-token refusal before submission. That image flow used a source SDK client and synthetic JubJub credentials; it is separate from registry-installed native or job-backed image interruption qualification. Key HTTP checks verified all 52 verifier hashes, selected prover/range bytes/CORS and one-circuit regeneration. Inputs and owned cleanup were verified for each lane.

Limits: exact-value shielded withdrawals; fresh critical approval; scoped transfers
retain recipient/asset/cap/expiry; unknown effects retain their original IDs. No
full Lace/provider restoration, total-loss recovery, complete compromised-key
revocation, native merchant atomicity, all-circuit typed API or wider-network NIGHT
qualification is claimed. Local session lock is not on-chain revocation.

[Next stability work](https://github.com/input-output-hk/midnight-passport-sdk/milestone/1)
retains unmet acceptance, including CI latency (#271), read retries (#274), and a
checked-in mounted-image lane (#313). Wider capabilities remain in milestone0.2.0.
