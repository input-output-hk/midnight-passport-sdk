/** Private holdings projection, separate from signer and account composition. */
import type { FlowOptions } from '@input-output-hk/mn-passport-protocol';
import type {
  AccBinding,
  AccLedgerView,
  Authoriser,
  AccountViewingKey,
  Chain,
  JubjubPureCircuits,
  PassportPorts,
} from './ports/index.js';
import type { Flow } from './flow.js';
import type { JubjubHint } from './jubjub-rotation-types.js';
import type { InboxLedgerView } from './inbox-view.js';
import { readVerifiedHoldings } from './holdings.js';
import { PassportConnectorError } from './errors.js';
import { requirePure, samePoint } from './jubjub-binding.js';
interface HoldingsContext {
  readonly ports: PassportPorts;
  readonly networkId: string;
  readonly network: PassportPorts['network'];
  readonly viewingKey: AccountViewingKey;
  readonly authoriser: Authoriser;
  readonly recordPure: WeakMap<JubjubHint, JubjubPureCircuits>;
  read(record: JubjubHint): Promise<InboxLedgerView>;
  readBinding(): Promise<AccBinding>;
  readChain(): Promise<Chain>;
  findCounter(record: JubjubHint, view: AccLedgerView): bigint | undefined;
  run<T>(options: FlowOptions, work: (flow: Flow) => Promise<T>): Promise<T>;
}
function holdingSource(ports: Pick<PassportPorts, 'holdings'>) {
  if (!ports.holdings)
    throw new PassportConnectorError('BindingUnsupported', 'The holding source is unavailable.');
  return ports.holdings;
}
export function readJubjubHoldings(
  context: HoldingsContext,
  record: JubjubHint,
  options: FlowOptions = {},
) {
  const {
    ports,
    networkId,
    network,
    viewingKey,
    authoriser,
    recordPure,
    read,
    readBinding,
    readChain,
    findCounter,
    run,
  } = context;
  return run(options, async (flow) => {
    if (!ports.holdings)
      throw new PassportConnectorError(
        'BindingUnsupported',
        'Reading shielded holdings requires a chain-backed holding source.',
      );
    const view = await flow.step('chain.read', () => read(record));
    if (!view.booted || record.status !== 'active')
      throw new PassportConnectorError('AccountNotFound', 'The JubJub ACC is not active.');
    if (view.specVersion !== 3)
      throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
    const pure = requirePure((await readBinding()).pureCircuits);
    recordPure.set(record, pure);
    if (findCounter(record, view) === undefined)
      throw new PassportConnectorError('NotAuthorised', 'This device has no live ACC entry.');
    // The pinned Lace v1 coin-description format is 192 bytes with the 01 01 prefix.
    // Device envelopes and grant records need no owner key ceremony for an empty read.
    if (
      !view.inboxEntries.some((entry) => entry.length === 192 && entry[0] === 1 && entry[1] === 1)
    )
      return [];
    const routine = ports.routineViewingKey?.({
      account: record.address,
      networkId,
      bindingId: network.bindingId,
      credentialId: Uint8Array.from(record.credentialId),
    });
    if (routine)
      return readVerifiedHoldings(
        {
          account: record.address,
          keyring: {
            account: record.address,
            encKey: view.encKey,
            envelopes: [...view.inboxEntries].reverse(),
          },
        },
        {
          networkId,
          chain: await readChain(),
          authoriser: { withKeySession: async (work) => work() },
          viewingKey: routine,
          holdings: holdingSource(ports),
        },
      );
    const session = authoriser.withKeySession;
    if (!session)
      throw new PassportConnectorError(
        'BindingUnsupported',
        'The owner key session is unavailable.',
      );
    return session.bind(authoriser)(
      async () => {
        const pk = await authoriser.devicePublicKey();
        if (!samePoint(pk, record.publicKey))
          throw new PassportConnectorError(
            'NotAuthorised',
            'The selected device does not own this ACC.',
          );
        return readVerifiedHoldings(
          {
            account: record.address,
            keyring: {
              account: record.address,
              encKey: view.encKey,
              envelopes: [...view.inboxEntries].reverse(),
            },
          },
          {
            networkId,
            chain: await readChain(),
            authoriser,
            viewingKey,
            holdings: holdingSource(ports),
          },
        );
      },
      { kind: 'read-holdings' },
    );
  });
}
