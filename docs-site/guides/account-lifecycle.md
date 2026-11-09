# Create, reopen, and recover an account

## Create an ACC deliberately

Choose the `acc-s3r1.1` binding and network from trusted configuration. Supply a persistent account-record store, credential/key source, deployer, prover, sponsor, submitter, and chain/indexer access. `createAccount` can enroll a supported P-256 passkey or PRF-derived JubJub owner. The host must show the maintenance-authority retirement decision **before** credential creation. Creation can span multiple on-chain waves; retain original IDs until a confirmed address is known. [The first integration](/getting-started/first-integration) shows a P-256 browser composition.

## Reopen an enrolled account

`openAccount` uses the host's record/directory path and an enrolled credential. `openAccountAt(address)` is an optional route when the host knows the ACC address and that credential is already enrolled. It verifies live ACC state and the device envelope; it does not search for an unknown account or restore a lost passkey. Login authenticates access to one credential. It does not automatically enroll a full owner, connect a wallet, or issue a grant.

## Understand recovery limits

A synced passkey may be available on a replacement device **if its provider restores the same credential and required PRF outputs**. Another enrolled device can remove a lost device and rotate viewing material when the host supplies complete live device, grant, and verified holding sources. If all authorizing credentials are lost, an account record, reader envelope, or wallet seed alone cannot recover on-chain owner authority. The [upstream recovery proposal](/architecture/standards) is a design reference, not a promise that this SDK can recover every account.

Keep the ACC address, network, binding, original operation IDs, and public receipt during an interrupted create or removal. Do not create a replacement account or replay a pending enrollment just because the UI lost its local state. [Durability](/guides/durability) describes reconciliation.
