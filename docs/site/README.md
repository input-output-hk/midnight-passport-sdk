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
- `account-keys.md` owns private account-key capabilities, wire formats, byte ownership
  and recovery. `keys.md` owns public proving artifacts, hash pins, caches and serving;
  its older account-viewing heading links to the private-key guide.
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


### Compile source examples before review

`nix develop -c pnpm test:docs` compiles every TypeScript fence and both example
modules through `docs/examples/checked-snippets.json`. Required lint runs the same
checker. Declare neutral, browser DOM, WebWorker or Node targets explicitly; complete
examples receive their host capabilities as parameters. For a machine-readable receipt
with source-line diagnostics and snippet hashes, use `nix develop -c node
scripts/docs/snippets.mjs --json` and a fresh ignored output. The checker does not
execute examples, install packages or authenticate a provider.


### Check the rendered site before deployment

The Pages workflow runs `scripts/docs/check-rendered.py` after Jekyll and before
upload/deployment. It checks rendered local links, styles/scripts/images and HTML
anchors under the configured base URL, including duplicate IDs and missing targets.
It performs no network fetch, CSS parsing or deployed-site verification. Required
fast PR checks remain unchanged; the Pages build owns this small post-render gate.

After a local Jekyll render, use the repository-pinned Python with a fresh receipt:

```sh
nix shell --inputs-from . nixpkgs#python3 -c python3 -m unittest discover -s tests/docs -p 'test_*.py'
nix shell --inputs-from . nixpkgs#python3 -c python3 scripts/docs/check-rendered.py \
  /absolute/path/to/rendered-site --base-url /midnight-passport-sdk \
  --output /absolute/path/to/fresh-docs-links.json
```

External URLs are counted but not checked. HTML pages are admitted with a bounded
read; a path or symlink escaping the site refuses. Rendered `<base href>` directives refuse rather than silently applying the wrong
relative-link resolution. Existing receipts are never
overwritten, and a missing/empty render cannot produce a pass. Keep browser layout
and actual deployment checks as separate evidence.


### Partner handover admission

The repository's `docs/partner-handover-policy.json` selects public site sources
and executable examples. `scripts/docs/check-handover.mjs` checks those files,
optionally the supplied rendered site and all nine hash-verified candidate
archives, for known process/private-path contamination. Use a fresh receipt:

```sh
nix develop -c node scripts/docs/check-handover.mjs \
  --output /absolute/path/to/new-handover-check.json \
  --site /absolute/path/to/rendered-site \
  --tarballs /absolute/path/to/candidate-bundle --version YOUR_EXACT_VERSION
```

This is a content/allowlist check, not render provenance, a general secret audit,
history sanitisation, native/provider qualification or publication. Read the
repository's `docs/partner-handover.md` before preparing an external proposal;
removing a file from today's tree does not remove it from earlier commits.
