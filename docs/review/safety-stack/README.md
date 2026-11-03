# Safety and reproducibility PR stack

Delivery target: `passport-acc-prototype`. Parent #257. No release in this tranche.

1. **PR #267, merged:** browser/bootstrap/timing base, signed merge `6cdf5f8`.
2. **PR #268:** original-intent shielded deposit recovery, exact head
   `d15d17f4e5df48fa554ed135dfa3a3f97336b2a3`. Start with the
   [recovery review map](../shielded-deposit-recovery/README.md).
3. **PR #270, stacked on #268:** evidence, HTTP, worker schema, and browser qualification.
   Start with [hardening](../qualification-hardening/README.md) and
   [actual browser evidence](../browser-signer/README.md). Both PRs retain the prototype as
   their delivery target. After #268 merges, #270's comparison becomes the qualification slice.

## Integration evidence

[Local integration record](integration.json): **1,087 passed, seven existing conditional skips,
zero failures** in the complete required gate before this signed merge commit. All 35
qualification and 13 recovery implementation/document blobs outside the two shared append paths
are byte-identical to their respective prior tested heads. The only merge conflicts were
`apps/README.md` and `docs/prototype/README.md`; both complete additions are preserved.
The record names the tested staged tree before adding these two review-receipt files.

The combined gate covers source API/types, encryption/restart/HTTP/unit and application tests.
It does not turn a historical installed-consumer or browser run into a fresh combined-source
native acceptance run. The actual 19-case browser receipt remains measured at signed `59cca01`,
with nine virtual assertions and one independently verified fake-chain SDK call. No provider
restoration, reader delivery, production signer UI, native/browser combined proof, or full Lace
compatibility is claimed. Published RC6 does not export the candidate recovery API.

## Remaining gates and merge order

The mandatory fresh exact-head Claude reviews are still waiting for session availability.
A quota response is not approval. Keep both PRs draft until review and latest hosted checks pass.
Review/merge #268 first through a GPG- and DCO-signed merge. Then recheck #270's authoritative
head, comparison, required checks, and fresh review before its signed merge. If any code changes,
rerun the required local gate and obtain a fresh exact-head review/CI verdict. Verify deployed
Pages after the eligible merges, update issue acceptance, and clean only owned completed resources.

Exact-value withdrawals, original hosted consent, immutable binding/artifact identities, and
unknown transaction IDs remain preserved. Fenced no-send/rollback/large-inbox recovery is #269;
measured CI latency follow-up is #271. No release or state reset is part of this stack.
