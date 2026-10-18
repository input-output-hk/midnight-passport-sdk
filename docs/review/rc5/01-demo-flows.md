# Expose reviewed demo account, device and grant flows

Local PR draft; no GitHub PR created.

- Head: `review/rc5-demo-flows` at `9eb0aca9aca5ce51311329ca9246514c4dc8f48c`
- Initial review base: `feat/demo-night-funding` at `260816d008b6d16942ca0e604b559e79f0582ec5`
- Final merge target: `passport-acc-prototype`, after earlier slices merge; retarget and rerun CI then.
- Related issue(s): 208, 209, 210, 211, 212, 213. Close only after review, merge and acceptance confirmation.

## Summary

Address recovery, live holdings, NIGHT withdrawal, second-device enrollment/removal, funding reconciliation and scoped grant issue/export/spend/revoke.

## Review focus

PR #207 remains the first prerequisite. Review value movement, request-id idempotency, operation-log redaction and live source checks.

## Verification

The final stack passes the full repository gate. The intermediate cut is a review boundary,
not a claim that this exact head has run GitHub CI or every final runtime probe. Before each
merge, test that exact retargeted head and review its diff. See `docs/local-backlog-acceptance.md`
and `docs/lace-consumer-report.md` at the final stack tip for exact tests, transaction records,
package hashes and limitations. All existing commits retain their GPG/DCO signatures.

## Local review

```sh
git diff 260816d008b6d16942ca0e604b559e79f0582ec5...9eb0aca9aca5ce51311329ca9246514c4dc8f48c
git log --show-signature 260816d008b6d16942ca0e604b559e79f0582ec5..9eb0aca9aca5ce51311329ca9246514c4dc8f48c
```
