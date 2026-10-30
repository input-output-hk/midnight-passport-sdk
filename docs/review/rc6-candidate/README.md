# RC6 candidate installed qualification

The clean GPG/DCO-signed source `c75461577cf15c92de8bb623c17c5a5676565a9c`
passed `consumer-installed` with all nine local `0.1.0-rc6` tarballs. All eight
arm/kind/interruption combinations run at completed TTL zero. Confirmed originals
return done via the authenticated retained-result read after process restart,
without recovery prepare/execute/submit. Pre-host originals stay unknown. Installed
SDK files match the supplied tarballs; physical runtime identity, offline frozen
install and synthetic hosted-consent checks pass.

[Inner installed receipt](installed-receipt.json) and [outer signed-source receipt](suite-receipt.json)
are hash-bound: outer stdoutSha256 equals inner receipt bytes. The scenario took
2,945ms on this machine. It uses synthetic chain/host drivers, not native proofs,
an actual host release, a registry publication, or real passkey providers. Later
JSDoc edits change packed adapter-service JS/declaration bytes, and catalog edits
change the workspace fingerprint. These are earlier candidate hashes, not final
release byte pins; final release smoke and publisher attestations verify the new
archives. Do not relabel this source. Earlier 12f4001 default-TTL
receipts remain historical; they are not TTL-zero acceptance. Release workflow
smoke reruns the installed TTL-zero harness on the exact release tarballs.


The five-minute installed-consumer catalog budget covers two individually bounded
120-second phases (offline install and scenario process) plus file audits. The
release smoke's 60-second bound covers only the harness after its separate install;
it does not include that installation. Neither is a performance promise, and the
old signed-source receipt retains its original catalog/deadline and fingerprint.
