import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import { Event, ZswapInput } from '@midnightntwrk/ledger-v9';
import type { HoldingIndexer } from './holdings.js';

const HEX32 = /^[0-9a-f]{64}$/;
const ACTION = `transaction { hash }`;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export interface GraphqlHoldingIndexerOptions {
  readonly networkId: string;
  readonly url: string;
  readonly wsUrl: string;
  readonly fetch?: typeof fetch;
  readonly WebSocket?: typeof WebSocket;
  /** Inject a pinned provider for deterministic host tests. */
  readonly publicDataProvider?: Pick<PublicDataProvider, 'queryZSwapAndContractState'>;
}

/** Browser/Node GraphQL host for the chain-matched ACC holding verifier. */
export function createGraphqlHoldingIndexer(options: GraphqlHoldingIndexerOptions): HoldingIndexer {
  const fetcher = options.fetch ?? fetch;
  const Socket = options.WebSocket ?? WebSocket;
  const publicDataProvider =
    options.publicDataProvider ??
    indexerPublicDataProvider({
      queryURL: options.url,
      subscriptionURL: options.wsUrl,
    });
  const query = async (
    source: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const response = await fetcher(options.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: source, variables }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`holding indexer returned HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (
      !record(body) ||
      (Array.isArray(body.errors) && body.errors.length > 0) ||
      !record(body.data)
    )
      throw new Error('holding indexer returned an invalid GraphQL response');
    return body.data;
  };
  const hashOf = (raw: unknown): string => {
    if (
      !record(raw) ||
      !record(raw.transaction) ||
      typeof raw.transaction.hash !== 'string' ||
      !HEX32.test(raw.transaction.hash)
    )
      throw new Error('holding indexer returned an invalid ACC action');
    return raw.transaction.hash;
  };
  type HoldingEvent =
    | { kind: 'output'; contractAddress?: string; commitment: string; index: bigint }
    | { kind: 'input'; contractAddress?: string; nullifier: string };
  const eventCache = new Map<string, Promise<readonly HoldingEvent[]>>();
  const eventsOf = (txHash: string): Promise<readonly HoldingEvent[]> => {
    if (!HEX32.test(txHash)) throw new Error('invalid transaction hash');
    const existing = eventCache.get(txHash);
    if (existing) return existing;
    const pending = (async () => {
      const data = await query(
        `query($offset:TransactionOffset!){transactions(offset:$offset){hash ... on RegularTransaction{zswapLedgerEvents{raw} transactionResult{status}}}}`,
        { offset: { hash: txHash } },
      );
      if (!Array.isArray(data.transactions))
        throw new Error('holding transaction query is invalid');
      const matching = data.transactions.filter((row) => record(row) && row.hash === txHash);
      if (matching.length !== 1 || !record(matching[0]))
        throw new Error('holding transaction hash is not unique');
      const row = matching[0];
      if (!record(row.transactionResult) || row.transactionResult.status !== 'SUCCESS') return [];
      if (!Array.isArray(row.zswapLedgerEvents))
        throw new Error('holding transaction events are missing');
      return row.zswapLedgerEvents.flatMap((item): HoldingEvent[] => {
        if (!record(item) || typeof item.raw !== 'string')
          throw new Error('holding event bytes are invalid');
        const raw = item.raw.replace(/^0x/i, '');
        if (!/^(?:[0-9a-f]{2})+$/i.test(raw)) throw new Error('holding event bytes are invalid');
        const bytes = Uint8Array.from(raw.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
        const { content } = Event.deserialize(bytes);
        if (content.tag === 'zswapOutput' && 'commitment' in content)
          return [
            {
              kind: 'output',
              ...(content.contract && { contractAddress: content.contract }),
              commitment: content.commitment,
              index: content.mtIndex,
            },
          ];
        if (content.tag === 'zswapInput' && 'nullifier' in content)
          return [
            {
              kind: 'input',
              ...(content.contract && { contractAddress: content.contract }),
              nullifier: content.nullifier,
            },
          ];
        return [];
      });
    })();
    eventCache.set(txHash, pending);
    void pending.then(
      (events) => {
        if (events.length === 0) eventCache.delete(txHash);
      },
      () => eventCache.delete(txHash),
    );
    return pending;
  };
  return {
    async enumerateContractActions(account) {
      if (!HEX32.test(account)) throw new Error('invalid ACC address');
      const latest = await query(
        `query($address:HexEncoded!){contractAction(address:$address){${ACTION}}}`,
        { address: account },
      );
      if (latest.contractAction === null) return [];
      const frontier = hashOf(latest.contractAction);
      return new Promise((resolve, reject) => {
        const actions: { txHash: string }[] = [];
        const socket = new Socket(options.wsUrl, 'graphql-transport-ws');
        let finished = false;
        let drain: ReturnType<typeof setTimeout> | undefined;
        const deadline = setTimeout(
          () => finish(new Error('holding action replay timed out')),
          60_000,
        );
        const finish = (error?: Error) => {
          if (finished) return;
          finished = true;
          clearTimeout(deadline);
          if (drain) clearTimeout(drain);
          socket.close();
          if (error) reject(error);
          else resolve(actions);
        };
        socket.addEventListener('error', () =>
          finish(new Error('holding indexer websocket failed')),
        );
        socket.addEventListener('close', () => {
          if (!finished) finish(new Error('holding action replay ended before frontier'));
        });
        socket.addEventListener('open', () =>
          socket.send(JSON.stringify({ type: 'connection_init' })),
        );
        socket.addEventListener('message', (event) => {
          try {
            const message: unknown = JSON.parse(String(event.data));
            if (!record(message)) throw new Error('invalid holding websocket message');
            if (message.type === 'connection_ack') {
              socket.send(
                JSON.stringify({
                  id: 'passport-holdings',
                  type: 'subscribe',
                  payload: {
                    query: `subscription($address:HexEncoded!){contractActions(address:$address,offset:{height:0}){${ACTION}}}`,
                    variables: { address: account },
                  },
                }),
              );
            } else if (message.type === 'next') {
              if (
                !record(message.payload) ||
                (Array.isArray(message.payload.errors) && message.payload.errors.length > 0) ||
                !record(message.payload.data)
              )
                throw new Error('holding action replay returned no data');
              const txHash = hashOf(message.payload.data.contractActions);
              actions.push({ txHash });
              if (actions.length > 10_000)
                throw new Error('ACC history exceeds the holding safety cap');
              if (txHash === frontier && !drain) drain = setTimeout(() => finish(), 500);
            } else if (message.type === 'error') {
              throw new Error('holding action replay returned an error');
            } else if (message.type === 'complete') {
              if (!drain) throw new Error('holding action replay ended before frontier');
              finish();
            }
          } catch (error) {
            finish(error instanceof Error ? error : new Error('holding action replay failed'));
          }
        });
      });
    },
    async queryShieldedOutputs(txHash) {
      return (await eventsOf(txHash)).flatMap((event) => (event.kind === 'output' ? [event] : []));
    },
    async queryShieldedInputs(txHash) {
      return (await eventsOf(txHash)).flatMap((event) => (event.kind === 'input' ? [event] : []));
    },
    async coinNullifier(account, coin, index) {
      if (!HEX32.test(account) || index < 0n) throw new Error('invalid qualified ACC coin');
      setNetworkId(options.networkId);
      const chain = await publicDataProvider.queryZSwapAndContractState(account);
      if (!chain) throw new Error('ACC chain state is unavailable');
      const [zswap] = chain;
      const hex = (value: Uint8Array) =>
        Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
      return ZswapInput.newContractOwned(
        { type: hex(coin.color), nonce: hex(coin.nonce), value: coin.value, mt_index: index },
        undefined,
        account,
        zswap,
      ).nullifier;
    },
  };
}
