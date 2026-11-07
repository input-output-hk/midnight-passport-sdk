# GitHub Pages source

`docs/site` is the Jekyll source for the SDK's Pages site. `docs-pages.yml` builds and
deploys it from `passport-acc-prototype`. The repository owner selects **GitHub Actions**
as the Pages publishing source. Editing or locally rendering this source does not deploy it.

## Documentation paths

- `library-guide.md` is the integration entry: package/export boundaries, host contracts,
  input admission, authorization, custody, error handling and cleanup.
- `demo-guide.md` is the reference app entry: local setup, UI/navigation, consent, routine
  memory material, full-owner policy, bounded grants and operational evidence.
- `getting-started.md` retains `/getting-started/` and the published RC7 install/composition
  path. `api.md` retains `/api/` and the export reference, with explicit source-only additions.
- The layout groups Library reference, Demo reference and Operations/releases. Existing
  pages and permalinks remain; do not physically move pages just to classify navigation.

A reusable port contract belongs in the library path. The demo's chosen lifetime,
Web Locks, dialogs, storage keys, service URLs and funding wallets belong in the demo
path, with links back to the relevant public API. An optional host hook must never be
described as automatic SDK caching, enrollment, wallet connection or key persistence.

## Release and evidence labels

Keep installation/API instructions tied to exported source types and matching published
versions. Current source adds APIs absent from published `0.1.0-rc7`; label those imports
and examples before the code. Use release-tagged source for the RC7 quickstart and the
prototype branch for explicitly labeled source examples. Do not imply a source-only
example compiles against RC7 packages.

Keep source unit/type, synthetic browser, native proof, provider, production image and
released-consumer evidence distinct. Link test sources as a contract map; only a matching
receipt establishes that a particular source/runtime passed. Never expose credentials,
owner/scalar/seed material, viewing secrets, grant openings or private operator logs.

## Review changes

Check internal permalink and anchor targets after a Jekyll render, including a base URL
of `/midnight-passport-sdk`. Preserve existing page permalinks and heading anchors where
possible. Type-check executable snippets against the intended export/version; the
released browser quickstart remains in `docs/examples/browser-quickstart.ts`.

The GitHub Actions workflow is the deployment build. Local source/permalink validation
without Jekyll can detect missing pages, but cannot establish Liquid/Kramdown rendering,
generated heading IDs or responsive layout. Report those verification gaps explicitly.
