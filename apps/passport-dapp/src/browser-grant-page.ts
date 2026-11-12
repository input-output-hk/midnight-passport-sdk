import './polyfills.js';
import './browser-grant-page.css';
import { grantPage } from './browser-grant-demo-config.js';

const main = document.querySelector<HTMLElement>('#grant-main');
if (!main) throw new Error('Missing grant workspace.');
const pins = __PASSPORT_GRANT_ORIGINS__;
const origin = location.origin;
const fragment = location.hash;
const href = location.href;
const role =
  pins && (origin === pins.issuer ? 'issuer' : origin === pins.holder ? 'holder' : undefined);

if (fragment) history.replaceState(history.state, '', location.pathname + location.search);

try {
  if (!pins || window.top !== window || location.pathname !== grantPage || location.search || !role)
    throw new Error('This browser grant origin is unavailable.');
  if (role === 'issuer') {
    const { mountIssuerPage } = await import('./browser-grant-issuer-page.js');
    mountIssuerPage(main, pins.issuer, pins.holder, fragment);
  } else {
    // Capture before loading the page ports or rendering the callback UI.
    const { captureDemoBrowserGrantCallback } = await import('./browser-grant-holder-journey.js');
    let callback: ReturnType<typeof captureDemoBrowserGrantCallback> | undefined;
    if (fragment) {
      try {
        callback = captureDemoBrowserGrantCallback(href);
      } catch {
        /* A wrong callback cannot consume pending state. */
      }
    }
    const { mountHolderPage } = await import('./browser-grant-holder-page.js');
    mountHolderPage(main, pins.issuer, Boolean(fragment), callback);
  }
} catch {
  if (location.hash) history.replaceState(history.state, '', location.pathname);
  main.textContent = 'The withdrawal permission page is unavailable on this origin.';
}
