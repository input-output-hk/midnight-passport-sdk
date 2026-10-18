# Make the nine package tarballs reproducible

Local PR draft; no GitHub PR created.

- Head: `review/rc5-reproducibility` at `f24466a8c58e6f6c9edac4eba71df032a4eb9322`
- Initial review base: `review/rc5-demo-flows` at `9eb0aca9aca5ce51311329ca9246514c4dc8f48c`
- Final merge target: `passport-acc-prototype`, after earlier slices merge; retarget and rerun CI then.
- Related issue(s): 205. Close only after review, merge and acceptance confirmation.

## Summary

Exclude TypeScript build caches, reject caches in packed artifacts, and compare two independent clean builds before release attestation.

## Review focus

Check the packed file allowlists and release workflow placement. Registry bytes still need comparison with publisher attestation after publication.

## Verification

The final stack passes the full repository gate. The intermediate cut is a review boundary,
not a claim that this exact head has run GitHub CI or every final runtime probe. Before each
merge, test that exact retargeted head and review its diff. See `docs/local-backlog-acceptance.md`
and `docs/lace-consumer-report.md` at the final stack tip for exact tests, transaction records,
package hashes and limitations. All existing commits retain their GPG/DCO signatures.

## Local review

```sh
git diff 9eb0aca9aca5ce51311329ca9246514c4dc8f48c...f24466a8c58e6f6c9edac4eba71df032a4eb9322
git log --show-signature 9eb0aca9aca5ce51311329ca9246514c4dc8f48c..f24466a8c58e6f6c9edac4eba71df032a4eb9322
```
