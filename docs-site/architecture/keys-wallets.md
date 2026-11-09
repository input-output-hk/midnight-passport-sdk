# Keys, wallets, and trust boundaries

| Material or actor | Can do | Cannot be assumed to do |
| --- | --- | --- |
| P-256 passkey signature | Authorize supported ACC calls through an enrolled P-256 owner | Derive a JubJub key or approve an unrelated action |
| Passkey PRF output | Feed domain-separated secret derivation for supported JubJub, reader, and wallet-seed recipes | Act as a P-256 signature or on-chain grant by itself |
| Full-owner JubJub key | Sign supported owner circuits after enrollment | Become a bounded permission merely because the host calls it a session |
| Bounded grant signer | Act within an issued on-chain recipient/asset/cap/expiry scope | Change devices, exceed scope, or become full owner |
| Reader key | Open a sealed device envelope | Authorize spending |
| ACC viewing secret | Open matching encrypted ACC records/holdings | Serve as a wallet seed or owner signature |
| Person's HD wallet seed | Control a separate Midnight wallet and its balance | Give ACC owner rights automatically |
| Sponsor wallet | Pay eligible transaction fees | Supply deposited assets or spend the person's ACC balance |
| Funding wallet | Send allowed assets into a deployed ACC | Pay every account fee or become ACC owner |
| ZKIR, prover and verifier keys | Prepare or verify proofs for the pinned public circuit | Reveal a user's owner, reader, or wallet seed |

The application decides when to ask for credential access and consent. The SDK can check an enrolled credential, prepare circuits, call a proof service, and use chain ports. The chain and deployed ACC determine final authority. A remote proof service handles operation witness data and needs appropriate confidentiality and access controls. Independent binding and artifact pins protect against substituting a different contract or public proving set.

The demo keeps some derived material in memory for a reviewed local lifetime. That timer limits **local access only**. It does not revoke a registered owner or an issued grant. An on-chain removal or revocation needs confirmed settlement. [Authentication and consent](/guides/authorization) details the decision points.

If a credential is lost, opening by address works only with another already enrolled credential. Reader envelopes and a wallet seed do not reconstruct owner authority. [Account lifecycle](/guides/account-lifecycle) has the supported recovery boundary.
