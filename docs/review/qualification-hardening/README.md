# Qualification hardening — #266

Signed measured source `47938b5644a402f5d59922dd9174c871f5635a43`.
[Verification](verification.json): full gate 1,060 passed, seven conditional skips, zero failures;
Jekyll 22 pages/504 local links with no errors. This documentation commit does not change
executed code or claim a new measurement.

- [Actual protocol parent](protocol-parent.json), [12 cases](protocol-result.json): isolated
  account/circuit/commitment refusals, actual public handlers, synthetic credentials/fake chain.
- [Six committed integrity controls](integrity-controls.json): copied roots retained, all refused
  before import, untouched original reverified. Fresh builder input pin recorded in the receipt.
- [Offline actual-consumer bootstrap](bootstrap-offline.json): original genesis recipe independently
  reproduced both expected public keys, then the integrated helper asserted those exact pins;
  actual declared HD ESM/ledger decoder and early proving-hook composition, no wallet/network/proof.
- Browser 8-case pass and owned SIGTERM failure-control summaries retain their raw receipt hashes.
  The summaries are explicit public projections, not byte-identical private receipts. A never-created
  attacker server is `not-created` with `closed: null`, not a false cleanup success.

Review code in this order: isolated protocol probes and bounded secret scanner; builder external
requirements; committed copied-root tamper runner; native public projection/end-identity failure
retention; browser late acquisition ownership; HTTP target/error/stream tests and engineer docs.
Unknown error text is not exported. Expected route `HttpError` messages remain deliberate public
API. Native evidence from earlier sources stays historical; no native rerun is claimed here.

The browser fixture still requires #258's additional actual boundary cases. Current preparation
uses the frozen external consumer and supplemental dependencies; historical prepared roots must
not be repinned or reused with a changed builder. No installed package, binding, key or image
has been replaced, and no release has been published.

## Pre-merge audit correction

The quality audit caught a producer/worker schema regression in the initial public-input rename.
The actual bootstrap now reads the renamed key-directory identity and obtains its private signer
root from the controlled worker environment, checking both root-path hash and config pin. The
parent invokes the same validator before Docker startup. An offline producer/consumer regression
covers both native profiles plus missing, changed, and legacy fields. Earlier native source
receipts remain historical; this correction is not a new live native qualification.
