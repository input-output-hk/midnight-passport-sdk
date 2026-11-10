# First browser integration

This tutorial creates or reopens a P-256 passkey-controlled ACC with the **published `0.1.0-rc9`** exports. It uses the same pinned `acc-s3r1.1` binding as the release. Both TypeScript modules below are compiled by the repository's documentation check. They form a localnet evaluation application; add your product's accessible UI, error display, and durable operation journal around them.

## Prepare the environment

1. Obtain read access to the **private GitHub Packages** scope. Put a package-read token in your user-level npm configuration, outside the repository:

   ```ini
   @input-output-hk:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
   ```

2. Install exact, matching package versions and keep the lockfile:

   ```sh
   npm install --save-exact \
     @input-output-hk/mn-passport-account@0.1.0-rc9 \
     @input-output-hk/mn-passport-protocol@0.1.0-rc9 \
     @input-output-hk/mn-passport-adapter-browser@0.1.0-rc9 \
     @input-output-hk/mn-passport-adapter-service@0.1.0-rc9 \
     @input-output-hk/mn-passport-contract@0.1.0-rc9
   ```

3. Supply a running, compatible chain/indexer and a Passport service at `http://127.0.0.1:8787`. The service must expose `/healthz`, `/v1/config`, deployment, directory, proving, fee sponsorship, and submission. Its binding must be `acc-s3r1.1` on network `undeployed`. The module obtains the manifest pin from the **installed contract package**, then checks the service response; do not derive the trusted pin from the service being checked. For an evaluation stack, follow [demo setup](/demo/). An install does not create these services or their wallets.

4. Run your browser app at `http://localhost:5173` with a compatible WebAuthn provider. The RP ID, origin, and ACC WebAuthn policy must agree. Configure the pinned Midnight WASM/Buffer/polyfill support shown in the [release demo's Vite setup](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc9/apps/passport-dapp/vite.config.ts) and [polyfill entry](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc9/apps/passport-dapp/src/polyfills.ts). The reference backend must have a funded **fee sponsor**; that does not fund the user's ACC.

## Add the account module

The module creates a persistent public **account record** in browser storage, preserving `credentialId` as bytes and `localUseCounter` as a bigint when read back. It stores neither a wallet seed nor a PRF output. Its `beforeCeremony` callback lets the host review every actual passkey request, including retries. Use a transactional host store when coordinating multiple tabs or devices. A real product also needs durable pending-operation records; the account record alone does not solve interrupted submission.

<<< ../../docs/examples/browser-first-integration.ts

For a minimal browser host, place that module at `src/browser-first-integration.ts`, put the following UI module at `src/browser-first-app.ts`, and use this page's HTML in `index.html`. The UI prompts are deliberately simple local-evaluation reviews; replace them with your product's accessible, exact-intent consent flow. It calls `create` or `open` **only from explicit user actions** and asks again before every credential ceremony. The [authorization guide](/guides/authorization) explains the full review contract.

```html
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Passport first account</title></head>
  <body>
    <main>
      <label>Account name <input id="user-name" autocomplete="off"></label>
      <label><input id="retire" type="checkbox"> Permanently retire maintenance authority</label>
      <button id="create" type="button">Create account</button>
      <button id="open" type="button">Open saved account</button>
      <output id="status" aria-live="polite"></output>
    </main>
    <script type="module" src="/src/browser-first-app.ts"></script>
  </body>
</html>
```

<<< ../../docs/examples/browser-first-app.ts

The UI waits for the returned account, reads chain state, and displays the address. Keep public progress events and transaction IDs; redact key material and provider causes. A cancelled or uncertain send can still have reached the chain. This sample does not enable asset movement, administration, or automatic full-owner enrollment.

## Recognize success and diagnose failure

Success means the returned account address is deployed and the same enrolled credential can reopen it and read state. The ACC balance can still be zero. Connecting a separate HD wallet or depositing assets are later actions.

| Symptom | Investigate |
| --- | --- |
| Package install returns 401, 403, or 404 | Verify scope registry, token permission, package access, and any required organization SSO. Do not paste credentials into logs. |
| `ArtefactIntegrity` or `NetworkMismatch` | Compare exact package versions, binding, independently pinned manifest/URL, and `/v1/config`. Do not bypass the pin with the server's answer. |
| Passkey or PRF refusal | Check origin/RP ID, provider capability, and supported P-256 assertion profile. A provider may not support the required PRF path. |
| Account creation or open stalls | Inspect service health, proof job, indexer lag, and public operation IDs. Deployment can take several waves. |
| Open cannot find an account | Check the durable record and enrolled credential. [Opening by known address](/guides/account-lifecycle) is available where supported; it is not lost-credential recovery. |
| An outcome is unknown | Preserve the original operation and transaction IDs; reconcile chain state before another send. [Durability guide](/guides/durability). |

Next, read [holdings and transfers](/guides/assets) before enabling value operations, or [package selection](/packages/) to replace the reference service with your own host ports.
