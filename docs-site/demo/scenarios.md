# Try the demo in learning order

The [application setup](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/README.md) is the source for exact commands and service configuration. These scenarios explain what to observe once the local stack is healthy.

1. **Create an ACC:** choose a supported P-256 or JubJub route, review maintenance-authority retirement and the actual passkey request, then wait for a confirmed address. Note the binding and network.
2. **Reopen it:** use the enrolled credential and stored record, or a known address where the route is supported. Observe that login does not automatically connect a wallet or enroll a full owner.
3. **Compare balances:** view ACC holdings and separately connect or refresh the person's HD wallet. They have different addresses and balances.
4. **Deposit:** use the separately enabled local funding path or an asset-holding wallet. Observe the funding transaction and later ACC balance. The sponsor pays fees only.
5. **Withdraw with an owner:** review exact asset, amount, destination, route and credential purpose. A value-capable call path is required. For shielded value, select an exact-value coin; partial shielded withdrawal is refused.
6. **Issue and use a bounded grant:** approve scope, await publication, then make a matching withdrawal. Compare the grantee route with a full-owner route. Revoke on-chain rather than merely clearing a local key.
7. **Inspect Activity and Audit:** retain a public operation reference even after cancellation or uncertainty. A new click is not safe until the prior result is reconciled.

Some scenarios require real provider capability, complete rosters, sufficient funding, and a compatible localnet. A synthetic browser test or source check does not establish all of these. [Testing and qualification](/operations/quality) identifies the evidence tier and remaining limits.

## Reopen a named standalone account

With a pinned Midnames registry configured, use **Name service** under
**Settings → Developer tools** to look up the exact name. Copy the returned
ACC address, then use
**Log in with an account address** and approve the enrolled passkey. If the
name was recently changed, look it up again before reviewing the address.
Use a known registry and verify the address with the account owner.
