---
layout: default
title: Prototype service API
permalink: /service/
---

The prototype service runs on `127.0.0.1:8787` by default. It is a development composition, not an authenticated public API. Its wire types are in [`packages/protocol/src/service.ts`](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/packages/protocol/src/service.ts), and the handlers are in [`apps/passport-service/src/routes`](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/apps/passport-service/src/routes).

| Route                                | Role                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /config`                        | Reports network, binding, manifest and endpoint configuration. The app checks the manifest against its own build-time pin. |
| `GET /zk/acc/*`                      | Serves the compiled ACC artefacts used by the browser and prover.                                                          |
| `POST /prove-tx`                     | Proves an unproven Midnight transaction with service-held keys.                                                            |
| `POST /sponsor/balance`              | Adds fee inputs only after the sponsor policy accepts the call.                                                            |
| `POST /sponsor/submit`               | Submits a finalised transaction.                                                                                           |
| `POST /deploy`                       | Deploys the ACC in waves and returns its address and submission IDs. This may take minutes.                                |
| `/accounts/:networkId/:credentialId` | Stores or reads a passkey-to-account hint. The connector checks it against chain state.                                    |

The sponsor pays **calls to accounts this service deployed and registered**. It refuses offers, Dust actions, non-fee imbalance and deploy or maintenance actions on its public sponsor route. Deployment uses the service's own reference wallet path. The proof preimage reaches the service; a production deployment needs TLS, authentication, rate limits and spending controls. See [prototype limitations](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/prototype/limitations.md).

Long operations currently hold the HTTP request open. The packaging design replaces this with jobs and polling; clients should not treat the current route timing as a stable published contract.
