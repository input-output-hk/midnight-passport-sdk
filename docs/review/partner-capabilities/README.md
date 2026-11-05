# Partner capability/configuration tranche — local candidate

This contributes to #237/#238 without changing `acc-s3r1.1`, adding a package,
changing any account operation, or claiming native/provider/full Lace acceptance.
Implementation: `e553606fa65c3cba8d9ac67566b98d1d44707168`; review fixes:
`2082564254526af1eb9e7415656099573edef326` and
`d02f444e2f0f50cf57d2a5d3fcec8e3f62e59997`. All are GPG/DCO/Assisted signed.
Base: `f2b61f06205246c9492b662cde95f0d7076233fb`, the frozen head of PR277.

## Review order

1. `scripts/check-circuit-matrix.mjs`: one declaration/manifest/profile inventory
   generates all outputs; lint rejects drift. Existing grant-bearer withdrawal is
   now correctly classified as a holder flow. Generated files account for most
   changed lines; review the generator and curated support labels first.
2. `packages/contract/src/capabilities.ts`: frozen typed metadata and exact lookup,
   lightweight subpath, no generated ACC/runtime import. JSON export/static asset
   use the same data; artifact hashes remain in the independent key manifest.
3. `packages/account/src/preflight.ts`: trusted-object method/pin inspection only,
   four existing sealed-owner flow configurations, P-256 and JubJub. No method,
   getter, lazy loader, key session or network call. No operational-ready result.
4. Targeted tests: roster/pin consistency, both arms, missing configuration,
   explicit read intent, durable/authenticated publication, recovery enumeration,
   qualified holdings, accessor refusal, immutable reports and zero invocations.
5. Typed external consumer example, engineer guide, API/package docs and limitations.

## Checks and independent review

[Verification](verification.json) records the exact implementation, full local gate
(1,136 passed, 7 existing skips, no failures), candidate packaging and limits.
Independent Codex CLI review of the first implementation found two omissions:
`records.exists` for grant flows and `viewingKey.sealView` for pending read-grant
publication. Both were fixed, covered by regressions on both arms and passed the
full gate again. A second pass removed unnecessary issue-only ports from recovery and the unused
reader-public-key method from active P-256 withdrawal/recovery checks. Those fixes
also have regressions and a fresh full gate. The whole corrected tranche passed
a separate final Codex CLI review at `d02f444` in a clean detached checkout with
locked dependencies and fresh compiled outputs: no actionable regressions; build,
lint and all 13 focused tests passed.
Raw review/install logs remain private/ignored; code review is separate from the
actual local gate and installed-package checks.

[Installed candidate evidence](installed-candidate.json): all nine approved
packages packed locally as `0.1.0-dev.20261104.capabilities.3`; three relevant
packages installed in a fresh external consumer, all 242 installed SDK files
matched to their tarballs. Strict TypeScript compiled the public-import example;
its emitted recipe executed. A module hook refused Compact/runtime-binding imports
while catalog/preflight imports ran. Configured methods/loaders threw if invoked;
none were invoked. The JSON package export matched the typed catalog.
No registry write, installed RC6 upgrade or release qualification follows.

[Documentation evidence](docs-check.json): Jekyll 4.4.1 built 25 pages; 623 local
links/anchors passed, and the static catalog equalled the packaged JSON. This is a
local build, not a Pages deployment. Existing PR276/277 heads remain unchanged.

## Boundaries and next work

The catalog describes packaged circuits and tested flow definitions, not executed
native/browser/provider evidence. The preflight profile is advisory and finite:
existing active sealed-owner unshielded/shielded withdrawals, grant issue and
pending publication recovery. Read recovery conservatively requires sealing
because inspecting the pending journal would invoke a port. It does not cover
creation, device lifecycle, revoke/revoke-all, holder spending or sender deposit
configuration. Those existing APIs retain their own guards. Lazy bytes, required
key profiles, active owner/envelopes, reader openings, balances, proofs, fees,
submission/finality and recipient credit always require runtime validation.

Keep the exact-value shielded withdrawal guard; k256 stays experimental artifacts/
binding only. Fee sponsorship supplies no deposit assets. Preserve original intent
IDs and failures. #237/#238/#81 stay open for broader negotiation, executable
native/provider recipes and specific host adoption. #275 native merchant proof,
admission, both contract states and wallet-credit acceptance remain BLOCKED by the
owner-deferred live run. Leave archived indexer and all retained state untouched.
No release, Docker startup, live wallet, proof or transaction was performed here.
