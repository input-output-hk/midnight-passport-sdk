# Glossary

| Term | Plain meaning |
| --- | --- |
| ACC | Account Custody Contract: the deployed contract that holds account assets and enforces enrolled key/grant authority. |
| Binding | Versioned generated contract module and public artifact manifest used to call a particular ACC revision. |
| Passkey | Provider-managed WebAuthn credential. Its P-256 signature and PRF output have distinct roles. |
| PRF | Pseudorandom function output from an eligible passkey request, used as secret-derivation input. |
| JubJub | Elliptic curve used by the supported derived account-owner and grant signing paths. |
| Reader key | Private key that opens an account viewing-secret envelope; it cannot spend. |
| Viewing secret | ACC secret used to open encrypted account records; separate from an HD wallet seed. |
| HD wallet | Hierarchical deterministic wallet with its own seed, address, and balance. |
| Grant | On-chain bounded authority for a separate signer, with exact scope and expiry. |
| ZKIR | Public zero-knowledge intermediate representation from which prover keys can be restored. |
| Prover key | Public circuit artifact used to produce a proof; large and cached separately from npm. |
| Sponsor | Fee-paying service wallet for an eligible transaction; does not deposit assets. |
| Funding wallet | Service wallet that sends allowed assets into an ACC through a separate funding path. |
| Host | Application or wallet integrating SDK ports, UI, consent, credentials, storage, and infrastructure. |

Use [Getting started](/getting-started/) for the system view and [Keys and wallets](/architecture/keys-wallets) for authority and custody boundaries.
