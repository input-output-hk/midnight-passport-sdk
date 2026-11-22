# Try the demo in learning order

The [application setup](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/README.md) is the source for exact commands and service configuration. These scenarios explain what to observe once the local stack is healthy.

For the local `.night` walkthrough, run the [Midnames launcher](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/README.md#open-the-local-passport-and-midnames-demo)
first. It attaches to a compatible running Ledger 9 stack or starts its own
fallback project, verifies the claimed name and ACC, then opens the opt-in
JubJub page. A fresh chain begins in account setup mode and needs a separate
registry bootstrap and name claim.

For the experimental Compact 0.36.1 key-generation ACC, use the
[explicit local candidate profile](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/README.md#provisional-acc-local-demo-profile)
with verified assets and a dedicated browser profile. Its build, reader and
named NIGHT guards admit only the exact local candidate pin. The combined
account creation, paid claim and named payment are not yet one qualified demo
run; follow the separate evidence limits below.

1. **Create an ACC:** choose a supported P-256 or JubJub route, review maintenance-authority retirement and the actual passkey request, then wait for a confirmed address. Note the binding and network.
   On the opt-in standalone Midnames profile, **Register a .night name** on Balances is optional after activation; you can return later. Enter a local name for this ACC and select **Continue registration** to see the four-minute quote. **Approve with passkey** prepares the claim and displays the payment terms; **Confirm payment and register** sends it. Continuing after an expired unsent or unprepared attempt runs the sponsor's safety checks and archives that original when safe. Receipts and manual recovery controls remain under **Receipt and recovery details**. Registration is complete only when the original transaction and registry binding match the ACC.
2. **Reopen it:** use the enrolled credential and stored record, or a known address where the route is supported. Observe that login does not automatically connect a wallet or enroll a full owner.
   For a local `.night` claim, reopening the same ACC with another credential does not inherit the first credential's retained receipt. The panel reports that local claim conflict and asks for the original credential and receipt.
3. **Compare balances:** view ACC holdings and separately connect or refresh the person's HD wallet. They have different addresses and balances.
4. **Deposit:** use the separately enabled local funding path or an asset-holding wallet. Observe the funding transaction and later ACC balance. The sponsor pays fees only. An uncertain local funding request remains reserved until operator reconciliation; the legacy NIGHT gas-rejection recovery is described in the [funding operations guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-funding-service/README.md).
   For the local `.night` receive use case, the separate [sender example](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/examples/midnames-local#review-the-named-deposit-in-the-sender-browser) shows the resolved ACC and shielded deposit on a localhost review page before dispatch. Its automated isolated `undeployed` run at signed `b87ed6c` finalized one deposit and verified the owner's held coin. A later [shared-chain run](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/shared-ledger9-paidfix-deposit-20261118.json) on signed `8165c73` sent to an existing claimed name and ACC; the saved mock-passkey owner opened that same account and read the exact chain-verified 10-unit holding. A human-run sender journey, real authenticator and online `passport.night` remain unqualified.
5. **Withdraw with an owner:** review exact asset, amount, destination, route and credential purpose. A value-capable call path is required. For shielded value, select an exact-value coin; partial shielded withdrawal is refused.
   The local [named NIGHT owner example](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/examples/midnames-local#review-the-two-leg-night-payment-in-the-owner-browser) reviews both ACC operations in a separate browser page before a synthetic owner signature. Its automated `undeployed` run at signed `ec83ce9` completed withdrawal, original-intent recovery and deposit with 10/0 → 6/0 → 6/4 ACC balances. The opt-in Passport demo send page has since completed one connected local Ledger 9 payment to a claimed name: its original withdrawal and deposit both finalized, and browser recovery checked those same IDs after reload. This later run used a local mock JubJub credential; real-provider and online-name acceptance remain open.
6. **Issue and use a bounded grant:** approve scope, await publication, then make a matching withdrawal. Compare the grantee route with a full-owner route. Revoke on-chain rather than merely clearing a local key.
7. **Inspect Activity and Audit:** retain a public operation reference even after cancellation or uncertainty. A new click is not safe until the prior result is reconciled.

Some scenarios require real provider capability, complete rosters, sufficient funding, and a compatible localnet. A synthetic browser test or source check does not establish all of these. [Testing and qualification](/operations/quality) identifies the evidence tier and remaining limits.
