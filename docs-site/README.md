# Passport developer documentation

This is the VitePress source for the SDK site. Tooling and its lockfile live here, outside the runtime package and demo workspaces. The published site base is `/midnight-passport-sdk/`.

The top-level learning paths are Getting started, Guides, Packages and API, Architecture and standards, Reference demo, and Operations and development. [MIGRATION.md](MIGRATION.md) maps old Jekyll URLs to current guides. `scripts/legacy-urls.mjs` emits compatibility pages and anchors after VitePress builds. The earlier `docs/site` sources remain in the repository as the input to that compatibility map and for tagged historical detail; they are no longer the published site's primary navigation.

Local commands, using the repository's Nix toolchain:

```sh
nix develop -c npm ci --prefix docs-site
nix develop -c npm run build --prefix docs-site
nix develop -c npm run dev --prefix docs-site
```

For the Pages base path:

```sh
DOCS_BASE=/midnight-passport-sdk/ nix develop -c npm run build --prefix docs-site
DOCS_BASE=/midnight-passport-sdk/ nix develop -c npm run preview --prefix docs-site
nix shell --inputs-from . nixpkgs#python3 -c python3 scripts/docs/check-rendered.py docs-site/.vitepress/dist --base-url /midnight-passport-sdk
```

The browser example is maintained in `docs/examples/browser-first-integration.ts` and compiled by `nix develop -c pnpm test:docs`. Diagrams use Mermaid and have nearby prose explanations. The site uses VitePress built-in local search, contextual sidebars, page outline, and previous/next navigation. The approach was inspected against [Midnight DID's Apache-2.0 documentation site](https://github.com/midnightntwrk/midnight-did/tree/main/docs-site); the Passport theme and content are written for this repository.
