# Partner documentation and proposal handover

The handover describes the reusable SDK contracts, supported subset and reference
application separately. It does not deliver the fork's run journals or make a
broader compatibility claim. Refs #300, #237, #238 and #236.

## Content selection

`partner-handover-policy.json` is the explicit source allowlist:

- `docs/site`: library and demo guides with their separate entry points, operator
  and release references, layouts and assets. Its contributor-facing README is excluded from source
  selection as well as from the rendered build.
- `docs/examples`: maintained strict-checked integration examples and inventory.
- Rendered output: supply the exact site prepared for handover; inspect its
  contents independently of the source selection.
- Packages: supply the matching nine-package candidate bundle and exact version;
  existing SHA-256/archive checks run before content inspection.

Repository contributor instructions, `docs/review`, ignored review output and
private process journals are excluded from the selected source roots. New private
run/tool notes belong in the owner's knowledge base. Historical fork-only review
maps remain readable provenance; they are not automatically copied into partner
exports. Do not delete immutable receipts to make a content check pass.

## Check before sharing

```sh
nix develop -c node scripts/docs/check-handover.mjs \
  --output /absolute/path/to/fresh-receipt.json \
  --site /absolute/path/to/rendered-site \
  --tarballs /absolute/path/to/candidate-bundle --version YOUR_EXACT_VERSION
```

Use absent output paths. Source-only checks can omit `--site` and `--tarballs`;
that narrower receipt does not inspect rendered output or package archives.
The supplied render must be built separately from the intended source. This
checker records relative paths, byte counts and hashes but does not regenerate
or independently establish its source provenance. Pair it with the render/link,
installed-consumer, signed-source and publication receipts.

Every admitted file is checked for known text markers regardless of filename or
extension, including text under extensionless and binary-looking names. Each
archive’s internal package name/version must match its candidate manifest identity.
The policy refuses known machine/vault references and tool-specific quota/fallback
text without echoing the matched private content. It rejects symlinks, escaping
source roots, private process paths, oversized source/rendered files and empty
exports. This bounded check cannot detect every form of a secret or encoded text;
manual content/privacy review remains necessary. SDK source/declaration maps and
API examples remain useful public implementation information, not agent journals.

## External proposal versus current fork history

The public fork already contains historical contributor/process material. Removing
it from the current tree or excluding it from a handover does not remove the old
commits. Before proposing work outside the fork, choose a reviewed clean export
or separately prepared proposal history containing only the intended changes.
Do not force-push or rewrite the shared fork history by default. Retain original
signed history and evidence in the fork/private archive, and sign/review any new
proposal commits under the destination's requirements.

The full repository's setup/review rules remain required for contributors even
though they are not SDK integration documentation. Host-specific credentials,
private source pins and provider/account state never belong in an export. Share
only explicitly supported adoption layers and keep pending acceptance visible.
