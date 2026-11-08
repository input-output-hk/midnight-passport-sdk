# Agent instructions: Passport libraries and reference demo

The primary outcome is reusable account packages for Lace and other partners,
adoptable by layer. Start with the [library guide](docs/site/library-guide.md)
for package integration and the [demo guide](docs/site/demo-guide.md) for the
reference application's wiring. Demo UI, memory leases, funding wallets and
worker creation are host choices, not automatic SDK behavior or prerequisites.

## Scope and working agreement

- Continue on the branch already checked out; do not switch to `main` or overwrite
  somebody else's changes. Current owner/session instructions determine scope.
- Current overnight work is local only: no push, release, tag or upstream action.
  A documented command is not authorization to start services or move funds.
- Follow the [partner plan](docs/partner-adoption-plan.md) and issue275 for
  application-contract→deployed ACC integration. Do not require custom ACC builds
  or replacement of Lace orchestration to reuse packages. Keep business logic,
  host consent and credential ownership explicit.
- Prefer coherent **5k–10k authored changed lines per PR**, smaller signed commits
  and a review map. Do not pad diffs. This supersedes historical 400/600-line split
  rules in skills/plans; AST file/function budgets remain independent constraints.
- The stability scope is supported-subset binding/recovery/revocation, interruption
  safety and reproducible consumers. Preserve exact-value shielded withdrawal
  guards. A breaking binding/API change needs an explicit version-axis decision.

## Required reading for the change

Read the relevant row before modifying or operating that boundary. The
[agent runbook](docs/agent-runbook.md) contains current commands, prerequisites,
state locations and lane-specific restrictions; it is required before demo,
consumer or native qualification work.

| Work | Read before proceeding |
| --- | --- |
| Library/API, ports, errors, custody | [Library guide](docs/site/library-guide.md), [API](docs/site/api.md), [package map](docs/site/packages.md), [account keys](docs/site/account-keys.md) |
| Owner/login/session or value UI | [Owner policy](docs/site/authenticated-owner.md), [consent](docs/site/consent.md), [routine access](docs/site/quick-actions.md), [bounded grants](docs/site/jubjub-sessions.md), [credential audit](docs/review/credential-policy/README.md) |
| Demo/navigation/prompts | [Demo guide](docs/site/demo-guide.md), [UI](docs/site/demo-ui.md), [prompt paths](docs/site/passkey-prompts.md), [UX map](docs/prototype/ux-milestone.md) |
| Durable calls, jobs, grants, funding | [Durability](docs/site/durability.md), [host durability](docs/site/host-durability.md), [service jobs](docs/site/service-jobs.md), [service](docs/site/service.md), [funding app](apps/passport-funding-service/README.md) |
| Source/installed/native qualification | [Runbook](docs/agent-runbook.md#qualification-selection), [qualification](docs/site/qualification.md), [consumer integration](docs/site/consumer-integration.md), matching review map |
| Tests, docs, budgets or workflows | [Quality](docs/site/quality.md), [site instructions](docs/site/README.md), [CI policy](docs/ci.md), ADRs 0015–0017 |
| Optional host examples | [React](docs/site/react-example.md), [wallet reader](docs/site/lace-wallet.md), [names](docs/site/names.md), [presentation](docs/site/interaction.md) |

## Authentication, consent and retained intent

- Login needs passkey access. Critical operations need fresh approval even when
  a JubJub full-owner session is active. This supersedes earlier all-owner reuse.
- Explicit verified-login adoption may warm only derived reader/wallet-seed
  material for a reviewed 10/15/30-minute routine lease. Never retain raw PRF
  outputs or an owner key in that cache. Failed/stale adoption, hidden tab, page
  exit, lock and expiry invalidate it. Other hosts must opt in themselves.
- Login never automatically enrolls/unlocks a full owner, connects a wallet or
  issues a grant. Public reads, wallet refresh, funding and external Lace
  connection need no Passport passkey. Navigation and stored hints never authenticate.
- Full-owner mode is the deterministic Lace PRF-output-1 JubJub owner, not a
  scoped child. Explicit P-256 companion enrollment grants durable FULL on-chain
  authority; the local timer/fresh-review policy does not restrict that authority.
- Before critical owner transfers, device/key/grant changes, sensitive opening
  export or pending-grant recovery/publication, obtain fresh credential-pinned
  approval and match owner/reader/live entry/sealed reader to the captured lease.
  Reuse approval only within that operation; never extend it or fall back silently.
- Separately approved bounded-grant transfers retain their exact scope and
  zero-request route. Routine viewing keys are read-holdings-only, never signers.
  Expiry, stale routes or unknown spends must not select an owner fallback.
- Keep one combined operation/ceremony review before each actual credential call,
  with fresh review for retries. Creation explicitly acknowledges maintenance
  authority retirement before credential creation. Keep late-bound exact reviews;
  reducing dialog counts is not permission to remove a required decision.
- Capture and recheck account, route, lease and exact intent before dispatch or
  sensitive display. Preserve post-dispatch receipts even after local expiry.
  Cancellation cannot undo a send; a local lock is not chain revocation or
  necessarily wallet shutdown. The runbook preserves detailed login/UI limits.
- Preserve original IDs, pending enrollment/activation attempts, salts, seals,
  scope/expiry and unknown-result fences. Do not replay, replace IDs, clear a
  journal/site data or enroll a real account automatically after uncertainty.
  Missing host/job records or transaction IDs do not prove that no send occurred.
- Keep P-256 directory/counter state independent. Strict signing/enrollment probe
  and real P-256 setup signatures remain required; older durable transcripts may
  safely refuse a changed scope rather than being rewritten.

## Resources, state and secrets

- Leave other people's processes, localnets, wallets and Docker stacks alone.
  Before demo/native work, inspect branch/tree, intended containers, leases and
  ports. Reuse a healthy intended stack; do not start a second wallet on occupied ports.
- Stop only processes you started by recorded PID and exact owned container IDs.
  Never use `pkill` patterns. Docker restart affects other sessions and requires
  owner approval. Do not free capacity by deleting/reconfiguring unrelated resources.
- Native work requires the existing **15 GiB free-disk guard**, sufficient Docker
  memory and verified cached inputs. Do not regenerate all keys unnecessarily.
  Keep source, compiled outputs, physical dependencies/reference/keys frozen for
  the run; verify final hashes before changing that checkout.
- Preserve chain/key/state volumes, registry/deployment history, passkeys,
  reservations, failed/unknown fixtures and occupied leases. A new disposable
  environment needs a fresh owned project/root and prior archive/reconciliation;
  it is not a repair by reset. Incomplete cleanup retains its lease.
- Never commit secrets: real network files, sponsor seeds, passkey/PRF/owner/reader
  material, grant openings, proof witnesses or prover keys. Only the intended
  `infra/networks/undeployed.env` is exempt from the ignored real-network files.
- Host-job bearer tokens do not belong in browser storage. Do not automatically
  persist an owner or raw PRF. Browser plaintext secret persistence needs explicit
  opt-in. Keep private auth in temporary user configuration, never logs/manifests.
- Keep milestone decisions, redacted receipts and handovers in the owner's
  Midnight Obsidian vault under `Initiatives/07 Midnight Passport ACC/SDK milestones/`;
  update `Current checkpoint.md` and artifact index after meaningful progress
  **unless current session instructions exclude vault access**. Public docs stay
  here; private consumer notes stay private. Never copy wallet state, tokens,
  passkeys, proof witnesses, giant keys or private source snapshots into the vault.

## Toolchain and required verification

**Use Nix for every command:** `nix develop -c …`. Never call a global `compact`,
`node` or `pnpm`; `guard.sh` refuses a toolchain outside the Nix store.

**Run the checks locally before every commit.** PRs also run
`.github/workflows/pr-checks.yml`. Keep the complete gate:

```sh
nix develop -c bash -c 'pnpm run lint && pnpm run format:check && pnpm run build && pnpm test \
    && pnpm run test:apps && pnpm --filter passport-service exec tsc --noEmit -p . \
    && pnpm --filter passport-funding-service exec tsc --noEmit -p . \
    && pnpm --filter passport-dapp exec tsc --noEmit -p .'
```

- Workflow edits also require the pinned-nixpkgs `actionlint` command in
  [CI policy](docs/ci.md#workflow-expression-validation). Every core check must
  exist and pass at the exact head; image-only green is not a started core workflow.
- Run `nix develop -c pnpm run test:coverage` before release. Coverage includes all
  executable authored sources in all nine public packages, with 80% lines/functions/
  branches globally and per package. Loaded-only measurements are insufficient.
- Lint includes AST budgets; TypeScript rejects unused declarations. Never
  regenerate/increase legacy budgets just to pass. New modules use defaults;
  exceptions need measured, reviewed rationale. See quality docs for metric scope.
- After flow/endpoint/prompt changes update `docs/prototype/` and `apps/README.md`
  in the same PR. Library contracts and demo policy belong in their separate guides.
- Keep docs examples strict-checked against matching public exports/version;
  source-only imports are not RC7 examples. Render/check local links/anchors and
  inspect desktop/mobile layout after navigation/content changes. See runbook.

## Evidence, reviews and publication

- Source unit/type, fake-chain process, synthetic browser, native proof,
  real-provider, production-image and installed/released-consumer evidence are
  distinct. No test or source receipt alone establishes another tier or full Lace.
- Use fresh private/ignored evidence paths and preserve failed outputs. Record
  source SHA, commands, pins, URLs/logs and exact owned resources. Missing inputs,
  skips and unimplemented cases never become qualified passes; three foundation
  runs establish repeatability only for their declared scope.
- Keep copied-output preview separate from actual tarball installation. Local
  installed candidates do not establish registry provenance or a new release.
  Published RC7 and later source preview remain separate; never retag old evidence.
- Use exact committed-head independent review and re-review substantive fixes.
  Independent Codex CLI review is owner-authorized when Claude is quota-limited.
  Full local gates, signing and hosted checks remain required when publishing.
- Use conventional commits with `git commit -S -s` (GPG signature and DCO), ending
  with `Assisted-by: AI`. Never add a `Co-Authored-By` trailer naming a model.
  Check `git log --format='%h %G?' -1` shows `G` after each commit.
- When separately authorized to publish, push/open PRs only in
  `input-output-hk/midnight-passport-sdk`, against `passport-acc-prototype`.
  Never push, open issues or comment upstream. Current local-only work stays local.

## Repository map and historical guidance

| Path | Boundary |
| --- | --- |
| `packages/protocol`, `packages/account` | Public types/errors and platform-neutral account flows/ports |
| `packages/keys`, `packages/contract` | Portable key recipes and pinned contract capabilities/artifacts |
| `packages/adapter-webauthn`, `adapter-service`, `adapter-midnight-js`, `adapter-browser` | Credential, fetch, call-pipeline and browser composition adapters |
| `apps/passport-service`, `passport-funding-service`, `passport-dapp` | Reference services, funding wallet and demo UI |
| `infra/localnet`, `infra/networks`, `experiments/acc-0.35` | Network configuration, contract export/compile tools and historical results |
| `docs/prototype`, `docs/superpowers/specs`, `docs/site` | Design, publishing specs and versioned library/demo reference |

The [guidance archive/index](docs/review/agent-guidance/README.md) preserves every
original section, command, pin and historical unknown-state note with a relocation
ledger. Read its incident links before handling retained qualification state.
It is historical evidence, not current acceptance or permission to operate resources.
