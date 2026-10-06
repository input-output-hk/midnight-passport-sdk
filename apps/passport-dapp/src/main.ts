// Entry point. The Buffer polyfill comes first (the SDK chunks read it at load time, the mock's
// adapter import included); then, in dev only, the mock passkey replaces navigator.credentials
// before the app loads. Vite replaces `import.meta.env.DEV` with false in production builds, so the
// mock's dynamic import is dropped and its code never ships.
import './polyfills.js';

if (import.meta.env.DEV && new URLSearchParams(location.search).has('mockPasskey')) {
  const { installMockPasskey, MOCK_PASSKEY_STORAGE_KEY } = await import('./dev/mock-passkey.js');
  installMockPasskey();
  const banner = document.getElementById('mock-banner');
  if (banner) {
    banner.textContent =
      `MOCK PASSKEY — dev only. A software passkey stands in for your authenticator; its private ` +
      `keys and PRF secrets are kept in this browser's localStorage ("${MOCK_PASSKEY_STORAGE_KEY}") ` +
      `so that "Open with passkey" works after a reload. Never use it for anything real.`;
    banner.hidden = false;
  }
}
await import('./app.js');
