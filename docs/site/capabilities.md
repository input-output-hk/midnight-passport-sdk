---
layout: default
title: Capability and configuration checks
permalink: /capabilities/
---

## Which problem this solves

A partner can reuse the compiled ACC and keys without adopting our browser host or
account orchestration. Packaging a circuit does not mean the account library has a
flow for it, and a typed flow does not mean a particular wallet/provider can run it.
Use separate checks for those decisions.

**Local candidate, not published RC6:** the subpaths on this page are additive work
for the next iteration. Do not install `0.1.0-rc6` and expect these exports. They add
no packages or runtime dependencies and do not change the immutable ACC binding.

| Decision | API or evidence | What it establishes |
| --- | --- | --- |
| Adopt the contract/assets only | `contract/capabilities`, `contract/capabilities.json` | Pinned binding identity, generated circuit signatures, key profiles and implemented flow classification. No browser or account runtime is loaded. |
| Compose an existing sealed owner account | `account/preflight` | Missing configured methods and immutable network pins for the four covered flow checks below. No key ceremony or network call. |
| Use a typed owner or grant-bearer flow | Account API plus the catalog's `support` field | The named SDK flow exists and has repository test definitions. |
| Claim proof-backed integration | Exact-source [qualification receipts]({{ '/qualification/' | relative_url }}) and [compatibility matrix](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/compatibility.md) | Only the environment, source, operations and failure boundaries actually measured. |
| Use application business logic with an existing ACC | [Partner contract guide]({{ '/partner-integration/' | relative_url }}) | Application→ACC is the primary reference. Native merchant acceptance is still pending. Custom outgoing ACC bundles are optional. |

## Read the machine-readable catalog

```ts
import {
  ACC_CAPABILITIES,
  getAccCircuitCapability,
} from '@input-output-hk/mn-passport-contract/capabilities';

console.log(ACC_CAPABILITIES.binding);
const withdrawal = getAccCircuitCapability(
  'withdraw_unshielded_with_grant_jubjub',
  'proof',
);
console.log(withdrawal?.support); // 'holder flow'
```

The catalog contains all **52 proof circuits and 66 pure helpers**. It includes exact
argument names/types from the generated declarations, witnesses, authority, consent,
flow owner, key profiles and test-definition paths. The JSON is also available as a
[static file]({{ '/assets/acc-s3r1.1.capabilities.json' | relative_url }}) and as the
package export `@input-output-hk/mn-passport-contract/capabilities.json` for tooling.
JavaScript JSON-module loading syntax depends on the consumer runtime; the typed
`./capabilities` entry avoids that requirement. Its data is deeply frozen.

`typed flow`, `holder flow`, `sender port` and `service flow` identify different
owners of the implementation. `artifact only`/`binding only` are explicit gaps.
`testEvidence` names test definitions; it is **not** a native/browser/provider pass.
The key service's `all` profile contains every proof circuit. `jubjub-owner-v1` is
only a ten-circuit subset; do not infer complete grant/device support from its name.
k256 remains experimental binding/artifacts, with no supported account authoriser.

The generator checks declarations, the independent key manifest, release metadata
and profile roster, then emits the table, package data, typed entry data and static
JSON together. `pnpm run lint` rejects drift. Per-key SHA-256 hashes and toolchain
regeneration details remain in the packaged key manifest, not a second integrity
scheme. Verify installed bytes and trusted pins before using the catalog; metadata
is not a substitute for artifact integrity verification.

## Inspect configuration before a key ceremony

```ts
import { inspectAccountConfiguration } from '@input-output-hk/mn-passport-account/preflight';

// ports is your trusted host composition, implementing PassportPorts.
const report = inspectAccountConfiguration(ports, {
  operation: 'issue-grant',
  grantRead: false, // issue must explicitly choose read/non-read
});
for (const issue of report.issues) {
  console.log(issue.path, issue.message);
}
// Even with no issues: report.status === 'runtime-validation-required'.
```

`sealed-owner-v1` inspects configuration for an **existing active sealed account**
on P-256 or JubJub. It is advisory and does not change flow behavior or bypass any
runtime guards. Call it before opening/signing; do not treat it as permission to send.

| Operation | Additional configuration inspected |
| --- | --- |
| `withdraw-unshielded` | Owner key-session/authoriser and opening methods, chain object or loader, network identity and immutable binding/manifest pins. |
| `withdraw-shielded` | Qualified held-coin selection in addition to the common owner checks. Runtime still requires an exact-value coin. |
| `issue-grant` | Local record existence/read/write access, live grant snapshot/commitments, durable staging/loading/publication journal, trusted host origin and sealed bookkeeping. Explicit `grantRead` is required. Read grants additionally require holdings, read-grant targets and complete mixed-reader delivery/rotation methods. |
| `recover-pending-grants` | Live grant IDs/commitments, local read/write records (also existence for JubJub), journal pending/load/mark-published and sealed grant/read delivery. Issue-only staging and issue-time snapshots are not required. A journal that can stage a new grant does not necessarily support recovery. |

Active P-256 withdrawal/recovery checks do not require a reader-public-key method;
JubJub opening and read-grant rotation do.

The function returns either `configuration-incomplete` with public actionable member
paths, or `runtime-validation-required` with no configuration issues. **There is no
"ready", "authorised" or "qualified" result.** It never invokes methods, lazy chain
or binding loaders, or property getters. Class prototype methods are supported;
accessor-based ports must expose explicit data/method members for inspection. Supply
trusted objects, not proxies with executable reflection traps. Reports exclude
supplied values and exception diagnostics and are immutable.

Even a complete inspected configuration leaves these runtime checks:

- Installed binding bytes/pure helpers, service configuration and required proving
  keys/profile; lazy loaders are deliberately not evaluated.
- Active sealed account, matching live owner/device/nonce and authenticated envelopes.
  The profile does not validate a legacy unsealed account or perform account creation.
- Consent at the intended key origin, grant openings/rosters and reader availability.
  Method presence cannot prove a host possesses a survivor's grant opening.
- Live holdings/balances, proofs, fee sponsor, finality and recipient observation.
- A separate value-bearing sender wallet for deposits. A fee sponsor is insufficient.

Account creation, enrollment/removal/rotation, grant revoke/revoke-all, grant-holder
spending and sender deposits are **outside this preflight profile**, even where the
SDK implements them. Consult the catalog and their own runtime guards. This finite
profile is not a complete support negotiation protocol or full Lace compatibility.

## Engineer recipe

[The typed host inspection example](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/host-preflight/inspect.ts)
composes the two lightweight entries without importing a browser implementation or
the generated contract runtime. Compile it in the host with strict TypeScript and
actual candidate package versions. Keep UI, account discovery, consent, wallet
identity and submission orchestration in the host.

For a real transfer, continue with the [fund/withdraw recipe]({{ '/use-cases/' | relative_url }}):
fund `10`, withdraw `1`, verify ACC `9` **and** recipient credit `1` after sync,
all in smallest units. Inspecting configuration or refreshing an ACC balance does
not establish recipient credit. Preserve original request/transaction IDs when an
outcome is uncertain; never obtain a fresh pass by replaying under a new ID.

## Plan proof keys before opening the key source

The candidate account preflight entry also exports `getAccountProofRequirements`.
It describes a **set** of proof circuits and required pure helpers for each of the
four covered operations, including helper methods enforced by connector guards.
It is not a transaction count, deployment plan, prompt budget or proof benchmark.
Explicit read-grant issue includes inbox publication and viewing-key rotation for
a mixed reader roster. Pending publication recovery needs the inbox prover only;
it never plans a second issue proof. Shielded withdrawal still requires an exact-value coin.

```ts
import { getAccountProofRequirements } from '@input-output-hk/mn-passport-account/preflight';
import { inspectAccProofProfile } from '@input-output-hk/mn-passport-contract/capabilities';

const requirements = getAccountProofRequirements('jubjub-schnorr', {
  operation: 'issue-grant', grantRead: true,
});
// profileAnswer and manifestAnswer are parsed /v1/profile and /v1/manifest JSON
// from the host's chosen endpoint. Fetch them before requesting any key ceremony.
const coverage = inspectAccProofProfile(
  profileAnswer, manifestAnswer, requirements.proofCircuits,
);
// coverage.status: 'profile-incomplete' or 'profile-covers-request'
// coverage.evidence is always 'advertised-metadata-only'.
```

Coverage checks the packaged binding/manifest identity, explicit prover **and**
verifier names, and malformed/duplicate/unknown lists. It does not trust a profile
name or `ready: true`. In particular, the actual `jubjub-owner-v1` profile includes
grant issue/append/rotation, but **does not include either owner withdrawal prover**.
All 52 verifier keys remain advertised in that profile; this does not make missing
provers available. P-256 owner calls likewise require their matching prover set.

A materialized `ports.binding` is now inspected for the planned pure-helper methods
without calling them. Lazy binding/chain loaders remain uncalled and require later
validation. `inspectHostProofs` in the typed host example composes both reports;
unknown authoriser arms or absent grant read intent never fall back to another plan.

This is an early configuration refusal, **not artifact verification**: authenticate
the endpoint, independently pin/check the manifest and every consumed file, and
handle stale/missing downloads and proof failures at runtime. Creation/deployment,
a caller application's own keys and real-provider approval are separate requirements.
For application→ACC grant spending, explicitly request
`withdraw_unshielded_with_grant_jubjub` plus the caller's independent artifacts;
owner-flow plans do not describe a grant holder or custom outgoing ACC bundle.
