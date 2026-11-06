/** Demo presentation only. A displayed deadline or form edit never changes grant authority. */
import type { DemoSessionSnapshot } from './session.js';
import { Buffer } from 'buffer';
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';

export const sessionAssetName = (color?: string) =>
  !color ? 'Not selected' : color === '00'.repeat(32) ? 'NIGHT' : `Token ${shortId(color)}`;

const shortId = (value: string) =>
  value.length > 28 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;

/** The controller stores the canonical payload; display its address on the pinned demo network. */
export function sessionRecipientAddress(recipient: string, networkId: string): string {
  if (!/^[0-9a-f]{64}$/.test(recipient)) return recipient;
  return MidnightBech32m.encode(
    networkId,
    new UnshieldedAddress(Buffer.from(recipient, 'hex')),
  ).asString();
}

const messages: Record<DemoSessionSnapshot['status'], readonly [string, string]> = {
  locked: ['Locked on this device', 'No local signing key is available.'],
  authorizing: ['Authorizing session', 'Review the passkey requests in the consent dialog.'],
  active: [
    'Ready for quick transfers',
    'Available for matching unshielded transfers when enabled below. Each transfer needs your review.',
  ],
  spending: ['Transfer in progress', 'Wait for confirmation. Do not send a replacement transfer.'],
  revoking: ['Revoking permission', 'The local key is locked. Wait for on-chain confirmation.'],
  expired: ['Session expired locally', 'The local signing key has been disposed.'],
  blocked: [
    'Outcome needs reconciliation',
    'The local key is locked. Do not retry. Inspect the original intent in Audit and reconcile it before another transfer or session.',
  ],
  revoked: [
    'Permission revoked',
    'Revocation was confirmed on chain. Transfers already submitted are not undone.',
  ],
};

export function sessionPresentation(snapshot: DemoSessionSnapshot) {
  const [title, message] = messages[snapshot.status];
  return {
    title,
    message,
    grantNotice:
      snapshot.grantId && ['locked', 'expired'].includes(snapshot.status)
        ? 'The recorded on-chain grant may still be usable by a copied key until chain expiry or confirmed revocation. Local lock is not revocation.'
        : '',
  };
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
};

/** Exact public values stay inspectable and selectable; compact labels are never signing inputs. */
function facts(target: HTMLElement, entries: readonly (readonly [string, string])[]) {
  target.replaceChildren(
    ...entries.map(([label, value]) => {
      const row = element('div');
      row.className = 'fact';
      row.append(element('dt', label), element('dd', value));
      return row;
    }),
  );
}

export function renderSessionDraft(color: string, recipient: string) {
  const target = document.getElementById('session-target-summary')!;
  facts(target, [
    ['Asset', sessionAssetName(color)],
    ['Recipient', recipient ? shortId(recipient) : 'Choose a recipient in Passport account'],
  ]);
  const exact = document.getElementById('session-target-exact')!;
  facts(exact, [
    ['Asset identifier', color || 'Not selected'],
    ['Recipient address', recipient || 'Not selected'],
  ]);
}

export function renderSessionState(snapshot: DemoSessionSnapshot, networkId: string) {
  const status = document.getElementById('session-state')!;
  status.dataset.status = snapshot.status;
  status.dataset.intentId = snapshot.intentId ?? '';
  const presentation = sessionPresentation(snapshot);
  const heading = element('h3', presentation.title);
  const text = element('p', presentation.message);
  status.replaceChildren(heading, text);
  if (presentation.grantNotice) status.append(element('p', presentation.grantNotice));
  const scope = document.getElementById('session-current-scope')!;
  const recipient = snapshot.recipient
    ? sessionRecipientAddress(snapshot.recipient, networkId)
    : undefined;
  scope.hidden = !snapshot.color;
  facts(
    scope,
    snapshot.color
      ? [
          ['Recorded asset', sessionAssetName(snapshot.color)],
          ['Recorded recipient', recipient ? shortId(recipient) : 'Not recorded'],
          [
            'Spent / total limit',
            `${snapshot.spent} / ${snapshot.cap ?? 'Not recorded'} smallest units`,
          ],
          ['Per transfer', `${snapshot.perCallCap ?? 'Not recorded'} smallest units`],
        ]
      : [],
  );
  const details = document.getElementById('session-record')!;
  const entries: [string, string][] = [];
  for (const [label, value] of [
    ['Passport ACC', snapshot.account],
    ['Grant ID', snapshot.grantId],
    ['Original intent', snapshot.intentId],
    ['Transaction', snapshot.txHash],
    ['Asset identifier', snapshot.color],
    ['Recipient address', recipient],
    ['Recipient payload (hex)', snapshot.recipient],
    [
      'Recorded deadline (UTC)',
      snapshot.expiresAt ? new Date(snapshot.expiresAt).toISOString() : undefined,
    ],
  ])
    if (value) entries.push([label!, value]);
  details.hidden = entries.length === 0;
  facts(document.getElementById('session-identifiers')!, entries);
  updateSessionClock(snapshot);
}

export function updateSessionClock(snapshot: DemoSessionSnapshot, now = Date.now()) {
  const clock = document.getElementById('session-clock')!;
  const text = snapshot.expiresAt
    ? snapshot.status === 'active'
      ? `${Math.max(0, Math.ceil((snapshot.expiresAt - now) / 60_000))} min remaining locally`
      : `Recorded deadline: ${new Date(snapshot.expiresAt).toLocaleString()}`
    : '';
  // Do not replace a live region or exact-ID selection on every timer tick.
  if (clock.textContent !== text) clock.textContent = text;
  clock.hidden = !text;
}
