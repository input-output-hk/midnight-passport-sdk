import type { P256ReadinessHost } from './p256-readiness-types.js';
import type { P256Hint } from './p256-device.js';
import { p256 } from './p256-device.js';
import type { AccLedgerView } from './ports/index.js';
import { PassportConnectorError } from './errors.js';
import { fromHex } from './codec.js';
import type { Flow } from './flow.js';
export function createP256Observation(
  host: Pick<P256ReadinessHost, 'binding' | 'chain' | 'viewingKey'>,
  RESCAN_LIMIT: number,
) {
  const { binding, chain, viewingKey } = host;
  const readAccount = async (record: P256Hint): Promise<AccLedgerView> => {
    const view = await (
      await chain()
    ).readAccount(record.address, {
      includeInbox: viewingKey !== undefined,
    });
    if (!view)
      throw new PassportConnectorError('AccountNotFound', `No contract at ${record.address}.`);
    return view;
  };
  const readView = (flow: Flow, record: P256Hint) =>
    flow.step('chain.read', () => readAccount(record));

  /** The 0..RESCAN_LIMIT-1 counter scan: the counter of this passkey's live entry, if any. */
  const findCounter = (flow: Flow, record: P256Hint, view: AccLedgerView) =>
    flow.step('counter.scan', async (): Promise<bigint | undefined> => {
      const { pureCircuits } = await binding();
      const self = { bytes: fromHex(record.address) };
      for (let k = 0n; k < BigInt(RESCAN_LIMIT); k++) {
        const entry = pureCircuits.derive_device_entry_with_p256(
          self,
          p256(record.publicKey),
          record.policy,
          view.deviceEpoch,
          k,
        );
        if (view.hasEntry(entry)) return k;
      }
      return undefined;
    });

  const notHeld = (record: P256Hint) =>
    new PassportConnectorError(
      'AccountNotFound',
      `The account at ${record.address} does not hold this passkey.`,
    );

  const useCounter = async (
    flow: Flow,
    record: P256Hint,
  ): Promise<{ counter: bigint; authNonce: bigint }> => {
    const view = await readView(flow, record);
    const counter = await findCounter(flow, record, view);
    if (counter === undefined) {
      throw new PassportConnectorError(
        'AccountNotFound',
        'This passkey has no live entry on the account.',
      );
    }
    return { counter, authNonce: view.authNonce };
  };

  return { readAccount, readView, findCounter, notHeld, useCounter };
}
