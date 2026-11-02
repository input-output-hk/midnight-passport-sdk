# Actual browser signer qualification

Tracking [#258](https://github.com/input-output-hk/midnight-passport-sdk/issues/258), under
[the stability plan](../../roadmap/stability-0.1.0-execution.md). This is the first bounded
browser protocol slice. [Signed-source receipt](receipt.json): **7 cases passed**, 4 virtual
credential assertions, exactly 1 fake-chain SDK call. Measured source
`1d076b99b0f98ec693c77a27a55eae0359fc2b31`, clean with verified GPG/DCO commit.
Chrome `156.0.8078.76`, Playwright `1.63.0`; the receipt retains exact runtime and asset hashes.
Later documentation commits are not new measured browser executions.

## What this lane exercises

The installed RC6 account API and published `@laceio/sdk@0.1.2-canary.2` remote client/seams
run in an actual Chromium page. Separately pinned public source handlers/server run in an
actual popup at another local origin. Chromium provides a virtual WebAuthn credential with
PRF and an actual transferred MessagePort. SDK authorising-only enrollment uses an independently
verified Schnorr signature against a fake chain. It delivers no reader/viewing secret.

Seven initial cases cover handshake/PRF, declined consent, origin policy refusal, SDK enrollment,
unsupported consent refusal, expiry, and closure during pending approval plus later refusal.
The published `SignerClosedError` has code `ceremony-cancelled`; closure is not a new public error.
This lane does not combine browser signing with a native proof. Real providers, restoration,
production signer UI and full Lace compatibility remain unqualified. Wrong source/target/flow,
concurrent open, navigation and reconnect need their additional browser cases in #258; earlier
simulated-window protocol evidence does not establish these browser boundaries.

## Recipe

Use the existing authenticated external host consumer from the
[consumer guide](../../site/consumer-integration.md). Build a **fresh** public signer root with
`qualify-public-signer.mjs prepare`; the browser needs the builder's public session-key-source
export. Earlier native source/bundle receipts retain their earlier recipe and hashes.

Create a separate private supplemental dependency root with exact `events@3.3.0`, `assert@2.1.0`
and `stream-browserify@3.0.0`, install with scripts disabled, retain its lock and independently
record the lock SHA-256. This does not modify the authenticated consumer. Browser composition
uses these standard browser polyfills, the consumer's pinned `process/browser`, `buffer`, RxJS,
and the ledger package's declared browser entry. It patches no host source or crypto.
The published experimental entry loads unrelated Cardano code, so these polyfills are needed
at module initialization even for named signer imports. Initial failed probes are retained.

On the measured macOS profile, Google Chrome must exist at its standard application path.
The harness records Chrome version/binary, Playwright runtime, supplemental lock/tree, built
assets, source, prepared bundle and consumer hashes; it verifies input bytes again at completion.
No browser install belongs in required CI.

```sh
# All paths below must be absolute; choose fresh output names and externally verified hashes.
export PASSPORT_SIGNER_ROOT=/private/path/to/prepared-signer
export PASSPORT_SIGNER_SHA256=<recorded-config-sha256>
export PASSPORT_SIGNER_BROWSER_ROOT=/private/path/to/consumer/signer-browser-new
export PASSPORT_SIGNER_BROWSER_POLYFILLS=/private/path/to/polyfills
export PASSPORT_SIGNER_BROWSER_POLYFILLS_SHA256=<recorded-lock-sha256>
nix develop -c pnpm qualify plan consumer-signer-browser
nix develop -c pnpm qualify run consumer-signer-browser --output /private/path/new-outer-receipt.json
```

Run only from committed clean source. Roots are never overwritten. Each case has a deadline;
owned contexts, Chrome and ephemeral static servers close in `finally`. Private credentials,
raw logs and installed trees stay outside Git/Obsidian. Failed roots are evidence, not retries
that can be renamed to a pass. The lane starts no wallet, chain, Docker or proof service.

## PR267 review corrections

The earlier seven-case receipt is historical. The updated harness pins the allowed dApp origin
independently of the referrer and adds a real third-origin opener refusal. Its unsupported-flow
case is explicitly an adapter-level refusal before a browser request, not signer-handler coverage.
The copied prepared bundle is checked directly before build and at completion. Chrome identity
now covers the full resolved framework/helper/resource tree, contained symlinks, launcher bytes
and version; a changed Current framework target also refuses the run.

The inner three-minute deadline and bounded independent cleanup fit inside the four-minute outer
scenario budget. Each cleanup result is retained independently; context closes before Chrome so cleanup does not race itself. Five five-second close limits leave room within the outer budget. Failure receipts include the stage
and completed cases, never partial success output. A flushed attempt-start record exists before
building. Forced process-group termination can still prevent a final receipt; an incomplete start
record is unqualified evidence, never a passed run. `PASSPORT_SIGNER_BROWSER_FAULT=interrupt-after-launch`
is an opt-in owned-process SIGTERM control and must produce a failed receipt with cleanup results.

Timing-option guards bound accepted numeric values. They do not impose an I/O timeout on injected
chain/wallet calls or establish a well-behaved injected clock; host deadlines remain required under
#234. This is separate from the browser runner's actual deadline/interrupt tests.

## Corrected exact-source acceptance

[Current receipt](receipt-v2.json), source `2c9007a6d82e3baa69a75b300d8941eaad36f966`:
**8 cases passed**, including an actual third-origin opener refusal. One case is explicitly a local
adapter refusal before any browser request. Four virtual assertions, one independently verified
fake-chain SDK call; all five owned resources closed. Chrome framework/helper/resource identity
covers315 regular files and1 contained link as well as the launcher and version.

[Owned SIGTERM control](interrupt-control.json) at the same clean signed source deliberately
returns `outcome: failed`, no success result and no completed cases; all five cleanup actions
succeed. This is a passed **failure-retention/cleanup control**, not a passed signer flow.
The runner disables Playwright's default SIGINT/SIGTERM handlers because it owns ordered cleanup.
Earlier [interruption attempts](interruption-attempts.json) preserve the cleanup race that exposed
this requirement. Their failed receipts and private logs remain retained; no attempt was relabelled.
The original seven-case receipt remains historical and does not establish the corrected cases.
