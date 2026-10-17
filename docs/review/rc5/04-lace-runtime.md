# Verify packed SDK interoperability with unmodified Lace flows

Local PR draft; no GitHub PR created.

- Head: `review/rc5-lace-runtime` at `6c6e3c7af6e6b08de0f8cae44f3c117d2c982e35`
- Initial review base: `review/rc5-keys-browser` at `9611cc7787dd8143b98a0dad88e97983834f62f1`
- Final merge target: `passport-acc-prototype`, after earlier slices merge; retarget and rerun CI then.
- Related issue(s): 79, 81. Close only after review, merge and acceptance confirmation.

## Summary

Authenticate nonempty inbox batches, detect duplicate runtime modules, respect authorising-only add-device consent, and record both recognition directions plus hosted mutation and P-256 read-grant revocation.

## Review focus

Review the two actual SDK fixes closely. Native Lace orchestration remains upstream-owned. Hosted generic SDK creation, sealed enrollment and address recovery still have documented scope limits. No partial shielded spends.

## Verification

The final stack passes the full repository gate. The intermediate cut is a review boundary,
not a claim that this exact head has run GitHub CI or every final runtime probe. Before each
merge, test that exact retargeted head and review its diff. See `docs/local-backlog-acceptance.md`
and `docs/lace-consumer-report.md` at the final stack tip for exact tests, transaction records,
package hashes and limitations. All existing commits retain their GPG/DCO signatures.

## Local review

```sh
git diff 9611cc7787dd8143b98a0dad88e97983834f62f1...6c6e3c7af6e6b08de0f8cae44f3c117d2c982e35
git log --show-signature 9611cc7787dd8143b98a0dad88e97983834f62f1..6c6e3c7af6e6b08de0f8cae44f3c117d2c982e35
```
