# Validate sealed mixed-device recovery and real WebAuthn handling

Local PR draft; no GitHub PR created.

- Head: `review/rc5-keys-browser` at `9611cc7787dd8143b98a0dad88e97983834f62f1`
- Initial review base: `review/rc5-reproducibility` at `f24466a8c58e6f6c9edac4eba71df032a4eb9322`
- Final merge target: `passport-acc-prototype`, after earlier slices merge; retarget and rerun CI then.
- Related issue(s): 25, 161. Close only after review, merge and acceptance confirmation.

## Summary

Preserve mixed-device readers, fail closed on incomplete read-grant/device rosters, specify P-256 registration policy and exercise Chrome CDP virtual PRF credentials.

## Review focus

This existing signed commit contains both keys and browser coverage. Review them together; the stack does not imply an artificial separation. Tests use synthetic credentials and do not establish real-provider behavior.

## Verification

The final stack passes the full repository gate. The intermediate cut is a review boundary,
not a claim that this exact head has run GitHub CI or every final runtime probe. Before each
merge, test that exact retargeted head and review its diff. See `docs/local-backlog-acceptance.md`
and `docs/lace-consumer-report.md` at the final stack tip for exact tests, transaction records,
package hashes and limitations. All existing commits retain their GPG/DCO signatures.

## Local review

```sh
git diff f24466a8c58e6f6c9edac4eba71df032a4eb9322...9611cc7787dd8143b98a0dad88e97983834f62f1
git log --show-signature f24466a8c58e6f6c9edac4eba71df032a4eb9322..9611cc7787dd8143b98a0dad88e97983834f62f1
```
