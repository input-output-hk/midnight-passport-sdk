# Review adjudication — 2026/10/26

Read-only Claude follow-ups reviewed foundation9e960ff, host7a22491 and upper2ba945e.
They reported no blocking SDK/fund-safety finding. Each material follow-up was
checked against source; reviews did not run tests or authorize a merge themselves.

| Finding | Disposition |
| --- | --- |
| Empty/skipped receipts or ambient Node context/options can undermine test evidence | Foundation fixes positive counts and repeat validation, pins every TAP reporter, and tests independent children with an early-exit preload/excluding shard. Direct-child isolation is not a hermetic wrapper/operator sandbox |
| Stale call preparation producer or implicit replacement | Original input/new CAS fence retained; native call prepare decodes saved bytes only. Generic drivers must satisfy that deterministic contract. Explicit preparing-call reconcile may dispatch under original approval; uncertain-broadcast polls remain lookup-only |
| Host race/HTTP coverage is not exhaustive | Remaining held-successor, preparation-expiry and HTTP combinations remain #230 work; no exhaustive race acceptance claimed |
| Refusal effect counter excludes ceremonies/key-origin operations | Wording narrowed to tracked transport and profile writes. No zero-prompt/key-draw claim. Injected write control currently generated JubJub only |
| Parent accepts counts without exact grant case/circuit inventory | Fixed exact assertions, positive profile writes, exactly one completion and the full ordered seventeen-call profile (including append count); negative regression tests and read-only validation of retained summaries |
| Recheck copies preserve symlinks | Fixed regular-file/directory checks before and after fresh copy, before any worker. Atomic destination reservation also refuses existing empty/stale directories. Regression checks aliases and source/copy independence; retained original survivor trees pass the read-only check |
| Failed verify worker could leave host alive | Outer `finally` already kills all tracked child groups. No removal of that cleanup or claim that cleanup is absent |
| Exact fault codes added after historical native runs | Current source assertions remain unqualified at each native outage boundary; old combined/survivor receipts are not relabelled. Additional outage qualification remains open |
| JubJub finish record persistence/second counter lookup | Single-account grant path matches existing P-256/address-open pattern. Multi-account/durable-final-record conflicts safely refuse and are not accepted by this slice; duplicate lookup optimisation deferred to preserve tested SDK bytes |
| Native holding comparison is literal seven units | Deliberate declared fixture scope; no arbitrary-value holding claim |
| Synthetic worker timer comment implies CPU budget | Corrected to eighty seconds of wall time per worker; no CPU/performance qualification claimed |
| Local HTTP fixture fetch failed at a fresh server | Test-only connections no longer reuse pooled sockets across teardown; teardown awaits close. Production HTTP unchanged; failed gate log retained |

The final corrections affect qualification/tests/docs, not the SDK, native grant
worker, shared grant case or compiled binding. The input comparison lists exact
hashes. Retained summaries passing a newer validator are read-only evidence, not
a rerun at a new source. All real-provider, full Lace, total-loss and release flags
remain false. No issue is automatically closed.


Summary flags describe completed worker assertions; validating them is not an
independent proof of those assertions. The parent additionally validates measured
case/circuit/write data. Existing native summaries pass the stricter ordered
seventeen-call inventory read-only. The direct GET in the chain test also disables
connection reuse; no claim is made that every other HTTP fixture was audited.


Pinned Node's `cp(..., errorOnExist:true)` did reject an existing empty root in the
local regression, contrary to the review's portability assumption. The explicit
helper now reserves the root with exclusive `mkdir` and copies fresh children,
so empty/stale destination refusal is tested directly and does not depend on
root-directory `cp` behaviour. The diagnostic failed gate remains retained.
