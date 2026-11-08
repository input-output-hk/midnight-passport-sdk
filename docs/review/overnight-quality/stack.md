# Local review stack — overnight quality work

No branches have been pushed and no PRs have been opened for this session. This is
an ordering proposal for review after the owner resumes. Continue on the current
branch until publication is authorized. Refresh the fork's actual base before
creating a stack; the local baseline is not evidence that the remote is unchanged.

The cumulative source starts at signed `0d5ec73`. Every listed local commit has a
verified GPG signature, DCO sign-off and `Assisted-by: AI`. Each candidate passed
its full local gate and an independent exact-head review. Checks apply to those
heads; rebasing a stack requires verifying signatures and current-head gates again.

## Proposed review units

Changed lines below are `git diff --numstat BASE HEAD` additions plus removals,
including authored tests/docs. They are a review-size measure, not production LOC.

| Order | Local range | Changed lines | Review focus |
| --- | --- | --- | --- |
| 1 | `0d5ec73..654826d` | 6,423 | Immutable grant/secret inputs, login entry and combined consent; typed JubJub rotation and bounded service configuration. |
| 2 | `654826d..5971cf1` | 5,751 | Typed P-256 enrollment, exact operation/credential review, lazy P-256 sign scope, authorization and background initialization. |
| 3 | `5971cf1..a0ce284` | 6,824 | Routine-lease identity, P-256 rotation, bounded host-job transport and executable library examples. |
| 4 | `a0ce284..b7eafb4` | 5,727 | Keyring/journal byte ownership, isolated native qualification and rendered documentation integrity. |
| 5 | `b7eafb4..02188b6` | 5,930 | Durable invocation identity, verified holding bytes, P-256 revocation and whole-observation HTTP lifetimes. |
| 6 | `02188b6..44af4ac` | 8,183 | Sponsor/funding snapshots and deadlines, P-256 readiness, JubJub publication, teardown and installed-consumer/crypto qualification. |

The following browser-harness/CI and quality-inventory tranche remains in progress;
its final signed range, size and receipts will be added after acceptance. Do not
include an unreviewed working-tree delta merely because an earlier unit is green.

## Review by contract

- Start with the [execution map](README.md), then the matching tranche's immutable
  evidence packet in the owner's Obsidian milestone space. Packets preserve failed
  attempts, fixes, exact source/runtime hashes and limitations.
- Use [library contracts](../../site/library-guide.md) for public input, custody,
  authority, errors and cleanup. Use [demo composition](../../site/demo-guide.md)
  for the chosen UI, consent, memory lifetimes, funding and wallet-worker wiring.
- Check operation extractions against their original effect/session/challenge order.
  Existing journals and unknown IDs must retain their original identity; timeout is
  not proof of no submission and local lock is not on-chain revocation.
- Distinguish source unit/type, synthetic browser, installed tarball, real native
  proof and provider evidence. A fresh source-native receipt cannot be inferred
  from a prior tranche, nor can local packages establish registry availability.
- The exact-value shielded withdrawal guard, explicit maintenance-retirement choice,
  fresh critical approval and bounded-grant no-fallback policy remain release gates.

## Before tomorrow's publication work

Confirm the actual prototype base and any merged upstream/fork work; reconcile the
local stack without rewriting unknown user changes. Review/merge in dependency
order only after the owner authorizes publication. Re-run release-head package,
image, visibility, integrity, installation and deployed-doc checks under the release
workflow. Tonight's work makes no new registry, image or deployed Pages claim.
