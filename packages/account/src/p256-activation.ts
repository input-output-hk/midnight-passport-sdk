import { PassportConnectorError } from './errors.js';
import type { Flow } from './flow.js';
import { p256, type P256Hint } from './p256-device.js';
import type { P256ReadinessHost } from './p256-readiness-types.js';
import type { AccLedgerView } from './ports/index.js';

/** Records an acknowledged chain state even when cancellation has already arrived. */
export const writeActiveHint = (host: P256ReadinessHost, flow: Flow, record: P256Hint) =>
  flow.step('directory.write', async () => host.directory?.put(host.networkId, record), 'always');

/** Four idempotent attempts protect the original activation salt after deployment. */
export const recordDeployedHint = (
  host: P256ReadinessHost,
  flow: Flow,
  record: P256Hint,
  retries: number,
) =>
  flow.step(
    'directory.write',
    async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await host.directory?.put(host.networkId, record);
        } catch (cause) {
          if (attempt >= retries)
            throw new PassportConnectorError(
              'InternalError',
              `The account at ${record.address} is deployed, but the registry did not record it after ${attempt + 1} attempts: ${cause instanceof Error ? cause.message : String(cause)}`,
              { cause },
            );
          await host.sleep(200 * 2 ** attempt);
        }
      }
    },
    'always',
  );

export const submitInitialActivation = (host: P256ReadinessHost, flow: Flow, record: P256Hint) =>
  flow.step('activate', async () =>
    (await host.chain()).call({
      address: record.address,
      circuit: 'activate_initial_device_with_p256',
      args: [p256(record.publicKey), record.salt, record.policy],
      ...flow.ports,
    }),
  );

/** Fresh legacy creation preserves its original activation-then-persist contract. */
export async function activateCreatedAccount(
  host: P256ReadinessHost,
  flow: Flow,
  record: P256Hint,
): Promise<P256Hint> {
  await submitInitialActivation(host, flow, record);
  const active: P256Hint = { ...record, status: 'active' };
  await writeActiveHint(host, flow, active);
  return active;
}

/** An already booted pending account is adopted; an activation is never replayed blindly. */
export async function finishPendingActivation(
  host: P256ReadinessHost,
  flow: Flow,
  record: P256Hint,
  view: AccLedgerView,
): Promise<P256Hint> {
  if (!view.booted) {
    await submitInitialActivation(host, flow, record);
    const after = await host.readView(flow, record);
    if ((await host.findCounter(flow, record, after)) === undefined) throw host.notHeld(record);
  }
  const active: P256Hint = { ...record, status: 'active' };
  await writeActiveHint(host, flow, active);
  return active;
}
