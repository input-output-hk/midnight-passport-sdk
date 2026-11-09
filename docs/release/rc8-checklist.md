# RC8 supported-preview publication checklist

Status: published preview; signed receipt records completed boundaries. `0.1.0-rc8`, nine
packages and the three existing backend images. Binding/version axis unchanged.
The supported subset and limitations are in `docs/site/release-notes-rc8.md`.

## Source and review

- [x] Merge eligible correction/preparation PRs into passport-acc-prototype after
  exact-head core/image CI and independent review. Preserve original findings/fixes.
- [x] Select the signed/DCO source commit; fresh full gate, coverage, strict docs,
  actual installed exports and source/browser evidence retain their exact identities.
- [x] Verify intended tag names are absent; sign annotated SDK/key/service/funding
  tags with DCO/Assisted-by messages. Push tags individually and verify each workflow
  starts. A sdk-check dry run is separate from live publication.

## Packages

- [x] Pack all nine exact versions, inspect file sets/key exclusions and verify
  independent-build reproducibility; exercise strict Node/browser/worker consumers.
- [x] Source release workflow passes; retain its manifest and source attestations.
- [x] Existing private publisher completes; verify all nine private package records,
  exact version/next tag, archive SHA-256/SRI and publisher/source attestations.
- [x] Fresh authenticated registry installation exercises runtime exports, declarations,
  browser build, supported recovery/crypto checks and physical runtime identity.
  Local candidates do not substitute for registry provenance.

## Images and documentation

- [x] Resolve all three published Linux/amd64 registry manifests; pull by digest.
- [x] Verify service/funding non-root/content/startup refusals. Wider mounted-runtime
  readiness remains explicitly deferred in #299; key-profile HTTP/integrity/restoration use the matching binding.
  Never claim a new native funds lifecycle from readiness or older receipts.
- [x] Render/link-check the final docs, strict examples and curated handover sources,
  supplied render and package contents. Inspect desktop/mobile; signed deployed-URL verification is attached after Pages deployment.
- [x] Publish the signed receipt, package SHA/SRI, images/digests and concise partner
  handover. Update the current release banner only after actual verification.

## Deferred boundaries

Retain #81/#232 actual host/provider qualification, #201 exact-value-only shielded
spends, #82 broad circuit coverage, #229 complete compromised-device semantics,
#240 total-loss recovery and #271 measured CI latency. Default demo durability and
original-reader grant-loss constraints remain explicit. A preview release is not
closure of every historical stability tracker or permission to relax these guards.
