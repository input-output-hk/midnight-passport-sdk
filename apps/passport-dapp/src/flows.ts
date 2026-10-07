// What each demo action is, how many passkey prompts it asks for and which stages it goes
// through. Data only, no DOM: ui.ts renders it and event-log.ts times it.

export type ActionId = 'create' | 'open' | 'rotate' | 'wallet';

/** A prompt count, or a range when it depends on the passkey provider. */
export type PromptCount = number | readonly [min: number, max: number];

/**
 * Passkey prompts per action: the one place to change them.
 * - Create: 2 (create, verify) when the provider returns PRF at creation, as Google Password
 *   Manager is expected to; otherwise 3 (create, verify, PRF).
 * - Wallet: 1 with an account open (pinned to its passkey), 2 without (pick, then PRF).
 */
export const PASSKEY_PROMPTS = {
  create: [2, 3],
  open: 1,
  rotate: 1,
  walletWithAccount: 1,
  walletWithoutAccount: 2,
} as const satisfies Record<string, PromptCount>;

export const promptsFor = (action: ActionId, accountOpen: boolean): PromptCount =>
  action === 'wallet'
    ? accountOpen
      ? PASSKEY_PROMPTS.walletWithAccount
      : PASSKEY_PROMPTS.walletWithoutAccount
    : PASSKEY_PROMPTS[action];

/** Durations measured in the recorded runs (experiments/acc-0.35/results/x9-*). */
export const DEPLOY_ESTIMATE_S = 180;
export const ACTIVATION_ESTIMATE_S = 25;
export const ROTATION_ESTIMATE_S = 60;

export interface StageDef {
  readonly id: string;
  readonly label: string;
  /** Known duration: the progress bar fills against it. Without one the stage is indeterminate. */
  readonly estimateMs?: number;
}

export interface FlowDef {
  readonly title: string;
  readonly summary: string;
  readonly stages: readonly StageDef[];
}

const read: StageDef = { id: 'read', label: 'Read the account from the chain' };

export const FLOWS: Record<ActionId, FlowDef> = {
  create: {
    title: 'Create account',
    summary: `Creates a passkey, deploys a Passport account for it (about ${DEPLOY_ESTIMATE_S / 60} min, fees sponsored) and installs the passkey as its first device.`,
    stages: [
      { id: 'passkey', label: 'Create and verify the passkey' },
      { id: 'prf', label: 'Derive the encryption key (PRF)' },
      {
        id: 'deploy',
        label: 'Deploy the account (10 waves)',
        estimateMs: DEPLOY_ESTIMATE_S * 1000,
      },
      {
        id: 'activate',
        label: 'Activate the first device',
        estimateMs: ACTIVATION_ESTIMATE_S * 1000,
      },
      read,
    ],
  },
  open: {
    title: 'Open with passkey',
    summary: "Reopens this passkey's account and checks the registry's record against the chain.",
    stages: [{ id: 'identify', label: 'Choose the passkey and check the registry' }, read],
  },
  rotate: {
    title: 'Rotate encryption key',
    summary: `A passkey-signed call, proved on the service (about ${ROTATION_ESTIMATE_S} s) and sponsored.`,
    stages: [
      {
        id: 'prove',
        label: 'Sign with the passkey, prove and submit',
        estimateMs: ROTATION_ESTIMATE_S * 1000,
      },
      read,
    ],
  },
  wallet: {
    title: 'Connect built-in wallet',
    summary:
      "A read-only wallet seeded from the passkey's PRF, connected through the DApp Connector API.",
    stages: [
      { id: 'config', label: 'Read the service configuration' },
      { id: 'seed', label: 'Confirm the passkey and derive the wallet seed (PRF)' },
      { id: 'sync', label: 'Start the wallet and read its addresses' },
      { id: 'balances', label: 'Wait for sync and read balances' },
    ],
  },
};

/**
 * The connector's `onProgress` steps, mapped to the create stage that starts with them. `null`
 * means the step starts no new stage (it is noted on the running one). A step not listed starts
 * an ad-hoc stage named after it, so a new connector step still shows up.
 */
export const CREATE_STEP_STAGE: Readonly<Record<string, string | null>> = {
  'passkey-created': 'prf',
  deploying: 'deploy',
  deployed: null,
  activating: 'activate',
  active: 'read',
};

export const promptCountText = (n: PromptCount): string =>
  typeof n === 'number' ? String(n) : n[0] === n[1] ? String(n[0]) : `${n[0]}–${n[1]}`;

export const promptLabel = (n: PromptCount): string => {
  const max = typeof n === 'number' ? n : n[1];
  if (max === 0) return 'No passkey prompt';
  return `${promptCountText(n)} passkey prompt${max === 1 ? '' : 's'}`;
};

export interface PlainError {
  readonly code: string;
  readonly message: string;
  /** What it means for the person at the demo, in plain language. */
  readonly hint: string;
}

const HINTS: Readonly<Record<string, string>> = {
  UserCancelled: 'The passkey step did not complete. Nothing was submitted.',
  UnsupportedAuthenticator:
    'This passkey cannot derive keys (no PRF support). Use a passkey saved in Google Password Manager or iCloud Keychain.',
  AccountNotFound:
    'No Passport account for this passkey on this network. After a chain reset the registry may be stale.',
  ArtefactIntegrity:
    "The service's contract artefacts do not match the ones this page was built for. Restart both with the same manifest.",
  ProverUnavailable:
    'The proving service did not answer in time. It may be busy with a deployment; wait, then retry.',
  SponsorRejected: 'The service refused to sponsor the transaction.',
  NetworkMismatch: 'The service is on a different network from this page.',
  InternalError: 'Something went wrong inside the connector.',
};

/** Turns anything thrown into a code, the raw message and a plain-language hint. */
export function plainError(e: unknown, serviceUrl: string): PlainError {
  // A thrown null or undefined is a value too: narrow it to an empty object.
  const err = (e ?? {}) as { code?: unknown; message?: unknown; name?: unknown };
  const code =
    typeof err.code === 'string' ? err.code : typeof err.name === 'string' ? err.name : 'Error';
  const message = typeof err.message === 'string' && err.message ? err.message : String(e);
  // An unreachable service reads as an internal error from the connector: say what it is.
  const unreachable = /unreachable|failed to fetch|networkerror|load failed/i.test(message);
  const hint = unreachable
    ? `Could not reach the Passport service at ${serviceUrl}. Is it running, and is this page at http://localhost:5173?`
    : (HINTS[code] ?? 'Unexpected error; see the message below.');
  return { code, message, hint };
}

export const formatDuration = (ms: number): string => {
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
};

export const formatClock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
