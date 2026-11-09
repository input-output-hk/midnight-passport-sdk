# Keep intent and results across interruption

An account record stores public account/device metadata; it is not a recovery journal, vault, or proof of chain settlement. Your host separately owns pending creation/enrollment, grant openings, transaction IDs, exact reviewed intent, and any protected intermediate output. The library exposes optional durability/background contracts, but it does not silently persist secrets, start a worker, or choose a storage policy.

| State | Host responsibility |
| --- | --- |
| Account record and directory hint | Persist and validate network, binding, address, credential ID, and local use counter. A hint never authenticates. |
| Private owner/reader/PRF material | Keep only for an approved lifetime, use a host-controlled key source, and clear on lock/exit. Plaintext browser persistence requires explicit opt-in. |
| Grant opening and pending operation | Protect the opening and preserve original IDs, scope, expiry, sealed reader, and possible send status. |
| Public receipt | Retain transaction references even when a local session expires. |

Before retrying an unknown result, inspect the chain and service job under the **same original ID**. A missing local record or service job ID does not prove no transaction was submitted. Cancellation prevents future local work where possible; it cannot undo a send. A background worker may process non-secret tasks, but credential access and owner approval remain explicit host decisions.

For a browser, the demo's [Activity and Audit](/demo/signing-activity) are one host implementation. For an operator, [durable service jobs](/operations/services) require protected server state and authenticated access.
