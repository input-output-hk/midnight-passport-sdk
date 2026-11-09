# Installation and compatibility

The current published preview is **`0.1.0-rc8`**: nine private `@input-output-hk/mn-passport-*` npm packages and three public Linux/amd64 service images. Use an exact version for every package you install. The moving `next` tag is useful for discovery, not a reproducible dependency. [The signed release receipt](https://github.com/input-output-hk/midnight-passport-sdk/releases/download/sdk-v0.1.0-rc8/rc8-publication-receipt.json) records source, hashes, images, and binding pins.

GitHub Packages access requires an authorized account or consuming repository. Configure `@input-output-hk:registry=https://npm.pkg.github.com` and place the package token in **user-level** npm configuration. For Actions, grant the repository package access and use its scoped `GITHUB_TOKEN`. Keep tokens out of source and browser bundles. See the [first integration](/getting-started/first-integration) for an exact install command.

The repository's Nix environment pins Node 22, pnpm, Compact, and the Midnight runtime used for qualification. A different runtime or browser/provider needs its own validation. The browser adapter requires WebAuthn and the documented WASM/polyfill setup. Node can use portable account and service packages with injected ports; it does not gain a native passkey by importing them. React is an optional host example, and React Native/server rendering are not qualified release targets.

| Version axis | RC8 value or responsibility |
| --- | --- |
| SDK packages | `0.1.0-rc8` for all selected packages |
| ACC binding | `acc-s3r1.1`, independently pinned from `mn-passport-contract` |
| Account API | `1.0.0-pre.0`; check the host descriptor and supported methods |
| Network | Your host chooses and pins node/indexer/service endpoints; the tutorial uses `undeployed` |
| Proof artifacts | Public keys must match the binding manifest; prover keys are restored outside npm |

Publishing a proposal, compiling an export, importing a package, and passing a synthetic test each establish different things. Use [testing and qualification](/operations/quality) for the release evidence, and [source changes](/operations/archive) for behavior later than RC8.
