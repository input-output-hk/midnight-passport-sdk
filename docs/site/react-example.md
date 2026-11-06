---
layout: default
title: Optional React host example
permalink: /react-example/
---

**Local source after RC7, browser development example only.** This is not a new
published UI package, `lace-sdk` integration, SSR support or React Native
qualification. The nine SDK packages stay independent of React. React/ReactDOM
19.3.1 and types 19.3.0 are private **app dev dependencies**; the dependency
cooldown and integrity policy remain enabled.

## Run

With the current demo running, open
`http://localhost:5173/examples/react-activity.html`, or **Settings → Advanced ·
Developer tools → Optional React host example**. The link and optional entry are
development examples, outside the production demo entry. Synthetic public data
requires no account, wallet, passkey, sponsor, proof server or Docker.

For a frontend-only checkout:

```sh
nix develop -c pnpm install --frozen-lockfile
nix develop -c pnpm run build
PASSPORT_MANIFEST_SHA256=77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f \
  nix develop -c pnpm --filter passport-dapp dev --port 5178 --strictPort
```

Open `http://localhost:5178/examples/react-activity.html` in this case. Choose a free
port; retain existing stacks. This alternate port is only for the synthetic
example. Actual Passport/passkey flows require their canonical configured origin.
Install the **whole** frozen workspace after dependency changes: a filtered
addition can leave sibling peer-context links stale until that install completes.

## Exercise the boundary

Two themes/layouts consume one immutable public snapshot. Host A puts operation
first; Host B uses the alternative slot order. The main prototype keeps its
approved operation-first Activity layout.

**Publish synthetic unknown observation** updates presentation data with the
original synthetic intent. Unmount/remount Host A leaves Host B, the store and
its revision intact. Audit buttons invoke only a host-owned local callback.
**Simulate a verified observation** changes example data; it does not query or
reconcile a real transaction. StrictMode is enabled. Render/effect replay never
opens a credential, derives a key or calls the account API.

| File in `apps/passport-dapp/src/examples/` | Responsibility |
| --- | --- |
| `react-store.ts` | Thin `usePassportActivity` hook over public store reads/subscriptions. No DOM, controller construction, timer or account command on import. |
| `react-controls.ts` | Optional HTML `OperationStatus`, `Journey`, slotted `ActivityPanel`. Import does not mount an app. |
| `react-activity.ts` | Synthetic host composition, shared store lifetime, explicit example commands, browser `createRoot` and StrictMode. |

Create the controller outside renderer execution. Pass stable `subscribe` and
`getSnapshot` functions. Replace observations only in explicit host commands or
event handlers. A real account action still needs its transaction guard, durable
journal, exact scope review and blocking consent before each credential request.
The presentation hook supplies none of that authority.

The SDK's cached immutable snapshots and subscription cleanup follow React's
external-store contract. StrictMode repeats development rendering/effect setup,
so commands and shared controller disposal must stay outside those paths.
[External-store reference](https://react.dev/reference/react/useSyncExternalStore),
[StrictMode reference](https://react.dev/reference/react/StrictMode).

The hook omits `getServerSnapshot` for this browser entry. SSR/hydration needs a
consistent explicit server snapshot. React Native needs qualified platform
adapters and native renderers; HTML components are not native controls.

## Checks

```sh
nix develop -c pnpm --filter passport-dapp exec tsc --noEmit -p .
nix develop -c pnpm test:demo-browser
```

Node tests import the hook/renderers without a browser. Actual Chromium exercises
StrictMode, both slot orders, shared updates, remounting, stable revisions and
original IDs. A credential-access refusal probe is installed before the entry
runs. No real clipboard or native credential is used. Receipt fingerprints cover
example HTML/source, physical React/ReactDOM/scheduler JavaScript and the lockfile.
This does not qualify real account flows in React, SSR, native mobile or full Lace.

[Interaction API]({{ '/interaction/' | relative_url }}),
[demo composition]({{ '/demo-ui/' | relative_url }}),
[issue #292](https://github.com/input-output-hk/midnight-passport-sdk/issues/292).
