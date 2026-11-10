# ADR 0015: Package quality and domain boundaries

Status: accepted for local implementation, 2026-11-07. Refs: release backlog Q1–Q9
in [the review map](../review/sdk-quality/README.md).

## Context

The SDK is reused by browser and Node hosts. The demo is one composition, not
the product architecture. The two connector roots grew beyond 1,900 lines, and
the former coverage command measured loaded files only. A high aggregate coverage
number cannot justify weak boundary validation or main-thread wallet work.

## Decision

Keep the existing package set and ports/use-case architecture from ADR 0007.
Extract cohesive operations from connector wiring; preserve arm-specific circuit
and consent behavior. Do not replace the proven mutation journal with a generic
state manager. Account identity, a credential, a viewing key, an HD wallet,
authenticated local ownership and an on-chain grant remain different concepts.

| Concern | Owner | Dependency direction |
| --- | --- | --- |
| Versioned account and event contracts | `protocol` | No platform dependency |
| Account use cases, validation, consent routing and ports | `account` | Protocol and pure libraries |
| PRF recipes, signer and reader key lifetimes | `keys` | Account ports |
| Generated ACC binding and integrity manifests | `contract` | Pinned runtime at its binding entry |
| Credentials and host key sessions | WebAuthn/host adapters | Account ports |
| HTTP, proof, sponsorship and submission | Service/Midnight adapters | Account ports and protocol |
| Wiring and optional browser facilities | `adapter-browser` | Explicit adapter dependencies |
| UI, review wording, navigation, visibility policy | Demo or partner host | Public package surfaces |
| HD wallet runtime and dust sync | Host-owned worker | Read/computation messages, not DOM |

Use Zod at new external data boundaries and exported parsing constructors.
Account addresses, assets, recipients, amounts, networks and bindings receive
distinct brands after parsing. Brands prevent accidental interchange in typed
code; they prove neither chain existence nor signer authority. Keep existing
string-based API compatibility and validate again at the use-case boundary.
Never coerce a decimal amount through `Number` or parse an unbounded `BigInt`.

All executable authored sources in the nine public packages enter the release
coverage denominator, including unimported files. Enforce **80% lines, functions
and branches globally and per package**. Report generated metadata, type-only
stubs, test helpers and retired private scaffolds as explicit exclusions. Root
Node coverage is not UI, native proof or provider acceptance.

Required fast lint uses TypeScript AST metrics, import boundaries, strict compiler
settings and explicit per-file ceilings. New files default to 600 lines,
150 lines per function and complexity 25, with no explicit `any`, suppression,
non-null assertion or double-`unknown` escape. Existing exceptions are measured
debt and may not grow without review. The extracted rotation operation retains
its prior large body while its ordering/fences stay under regression tests; a
new filename does not erase that debt. The report shows the actual complexity.

## Execution and state

Async I/O does not move CPU work to another thread. The demo's browser wallet
runtime, including dust synchronisation and WASM/HD work, runs in a dedicated
worker. NIGHT observes only unshielded sync readiness; DUST is an independent
background observation, with its own status/timestamp and generation fence. A
DUST failure cannot erase a ready NIGHT balance or keep unrelated controls busy.
The Node demo probe uses the same runtime directly; a Node host can use
`worker_threads` through the structural background port. SDK account flows do
not create threads or assume a global browser/Node worker.

The background protocol permits explicit read/computation methods only, bounds
pending work, correlates IDs, rejects replays, sanitises failures and closes
pending reads on disconnect. Timeout is not cancellation or evidence about a
transaction. Do not use this read RPC to retry mutations. Host job and mutation
journals remain the transaction execution/reconciliation model.

The host is the single writer of UI observations. Use the existing immutable
`ActivityStore` revision compare-and-replace for presentation; reject stale
wallet completions after disconnect. Authentication, account switching and
visibility lifecycle are host policy, with checked leases at new key/transport
use. Workers cannot ask for a passkey or fabricate consent.

## Consequences

- Framework-neutral account/keys/protocol APIs support browser and Node hosts.
  WebAuthn and IndexedDB adapters require browser capabilities; Node services
  and file adapters have explicit platform entry points.
- Coverage stays outside the short required PR path. The release gate must run
  it, and fast CI still runs the full test inventory in shards. Do not enforce a
  45-second timeout that turns incomplete qualification into success.
- Property/range tests, cross-target consumer compilation, browser worker tests
  and native opt-in evidence answer different quality questions.
- No new package, forced React dependency, automatic owner-key persistence,
  contract upgrade, partial shielded spend or full Lace-compatibility claim.

## Sources

The [c8 all-files option](https://github.com/bcoe/c8#ignoring-uncovered-lines-functions-and-branches)
includes unexecuted files; [Zod schemas](https://zod.dev/api) validate boundary
values; [Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)
execute independently of the page. Tool versions are pinned in the lockfile.

## Source follow-up: architecture and backend inventory — 2026-11-10

Literal dependency edges are parsed with the existing TypeScript compiler instead
of regular expressions. Node built-ins and cross-package source paths are checked
alongside the package graph. Computed dynamic module names remain a reviewed host
boundary. New backend TypeScript/JavaScript sources join the AST gate.

Two pre-existing native runtime files receive explicit measured ceilings when
entering this inventory. Their dynamic ledger types need separate native
qualification; moving or renaming that debt cannot erase it. All new operations,
transport parsers and app modules use the default size/complexity and zero unsafe
escape limits. The JubJub connector's previous ceilings decrease after extracting
cohesive typed phases. See the pre-RC audit for before/after evidence.
