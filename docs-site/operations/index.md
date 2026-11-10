# Operate the Passport services

The reference stack has three distinct backend responsibilities:

| Component | Purpose | Owner supplies |
| --- | --- | --- |
| Passport service | Checked configuration, directory/deployment, proof jobs, fee sponsorship and submission | Chain/indexer, compatible binding, proof backend, sponsor wallet, protected ingress and durable state |
| Key service | Restore and HTTP-serve pinned **public** proving artifacts | Compatible Compact toolchain, persistent verified cache and artifact URL |
| Funding service | Send allowlisted assets from a separate wallet into deployed ACCs | Dedicated funded wallet, authentication, asset limits and durable reservations |

The published RC9 images are public Linux/amd64 artifacts; the npm libraries are private. Choose exact image digests from the [signed release receipt](https://github.com/input-output-hk/midnight-passport-sdk/releases/download/sdk-v0.1.0-rc9/rc9-publication-receipt.json). The source [Passport service](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-service/README.md), [key service](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-key-service/README.md), and [funding service](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-funding-service/README.md) guides own exact configuration.

Read [artifacts](/operations/artifacts) before serving keys and [proof, sponsorship and funding](/operations/services) before exposing endpoints. The [reference demo](/demo/) is a consumer of these services, not their security policy.
