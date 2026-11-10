# Troubleshooting by symptom

| Symptom | First checks |
| --- | --- |
| Package install returns 401/403/404 | GitHub Packages scope, read permission, organization SSO, repository access, exact version, and user-level credential config. Do not share token values. |
| Configuration or artifact integrity fails | Independently pinned binding, manifest hash, artifact URL, network, image/package version, and service `/v1/config`. Do not trust a server to provide its own expected pin. |
| Passkey request fails | RP ID and origin, HTTPS/localhost, provider P-256/PRF capability, supported assertion profile, and actual request purpose. |
| Cannot reopen an account | Persistent record/known address, same enrolled credential, live device entry, and sealed reader. Opening by address does not restore a lost credential. |
| Holdings are absent or stale | Confirm indexer sync and reader/viewing-secret availability. The separate HD wallet balance is not ACC balance. |
| Withdrawal refuses | Check owner/grant authority, exact consent, value port, grant scope/expiry, verified holdings, and proof circuit profile. Shielded partial spends are unsupported. |
| Funding returns conflict or unknown | Keep the same request ID and inspect durable reservation plus chain credit before retrying. Funding and sponsorship wallets differ. |
| Submission times out | Preserve original operation/job/transaction IDs and inspect chain state. Cancellation does not undo a possible send. |

The [tagged detailed troubleshooting guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc9/docs/site/troubleshooting.md) has service-specific diagnostics. Report public version, binding, network, manifest, operation IDs, and redacted logs; omit tokens, PRF output, owner/reader keys, viewing secrets, wallet seeds, witnesses, and grant openings.
