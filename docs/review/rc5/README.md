# RC5 local review stack

**Historical snapshot — superseded.** The stack was integrated by PR #220. Use
[the current release receipt](../../release/rc5-local-receipt.json) and
[handover runbook](../../release/rc5-lace-handover.md) for qualification and release status.

Status: prepared locally, unpublished. Proposed version: `0.1.0-rc5` (`next`).

Review and merge in order:

1. Existing PR #207 (`feat/demo-night-funding`) into `passport-acc-prototype`.
2. `01-demo-flows.md`.
3. `02-reproducibility.md`.
4. `03-keys-browser.md`.
5. `04-lace-runtime.md`.
6. Release preparation on `release/preview-rc5-local`, after the implementation stack.

These branches reuse signed history rather than cherry-picking it. They are stacked review
boundaries, not independent changes. Initial review bases name the prior slice; final PR merge
target is the prototype branch after predecessors merge. GitHub CI cannot be run locally and
has not been run for these unpublished branches. No branch, tag, PR, issue update, package or
image is published by preparing this directory.

Proposed issue reconciliation after merge: #25, #205, #79, #161 and #81 have the local
acceptance evidence in `docs/local-backlog-acceptance.md`. Demo issues #208–#213 need their
individual acceptance criteria checked against slice 1 before closure. Keep #201, #82 and
broader capability trackers open. #202 still needs its outstanding live/value-host evidence.

The next feature slice after RC5 review/release is #201: durable spend/change intent and
spent-coin reconciliation first; enable partial shielded withdrawals only after full change
recovery and both authoriser arms pass proof-backed crash/retry tests.
