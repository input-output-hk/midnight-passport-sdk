import type { FundingContractAction } from '@input-output-hk/mn-passport-service';

const HEX32 = /^[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const ACTION_FIELDS = `
  __typename
  address
  unshieldedBalances { tokenType amount }
  ... on ContractCall { entryPoint }
  transaction {
    hash
    ... on RegularTransaction { identifiers transactionResult { status } }
  }
`;

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseAction(raw: unknown, account: string): FundingContractAction {
  if (!object(raw) || raw.address !== account || !object(raw.transaction))
    throw new Error('indexer returned an action for a different ACC');
  const tx = raw.transaction;
  if (
    !['ContractDeploy', 'ContractCall', 'ContractUpdate'].includes(String(raw.__typename)) ||
    typeof tx.hash !== 'string' ||
    !HEX32.test(tx.hash) ||
    !Array.isArray(tx.identifiers) ||
    !tx.identifiers.every((id) => typeof id === 'string' && id.length > 0) ||
    !object(tx.transactionResult) ||
    !['SUCCESS', 'PARTIAL_SUCCESS', 'FAILURE'].includes(String(tx.transactionResult.status)) ||
    !Array.isArray(raw.unshieldedBalances)
  )
    throw new Error('indexer returned an invalid ACC action');
  const balances: Record<string, string> = {};
  for (const item of raw.unshieldedBalances) {
    if (
      !object(item) ||
      typeof item.tokenType !== 'string' ||
      !HEX32.test(item.tokenType) ||
      typeof item.amount !== 'string' ||
      !DECIMAL.test(item.amount) ||
      balances[item.tokenType] !== undefined
    )
      throw new Error('indexer returned invalid or duplicate ACC balance');
    balances[item.tokenType] = item.amount;
  }
  return {
    txHash: tx.hash,
    identifiers: tx.identifiers as string[],
    status: tx.transactionResult.status as FundingContractAction['status'],
    kind: raw.__typename as FundingContractAction['kind'],
    ...(typeof raw.entryPoint === 'string' && { entryPoint: raw.entryPoint }),
    balances,
  };
}

/** Replay one ACC's complete action history through a pinned local indexer. */
export async function accountActions(
  account: string,
  indexerUrl: string,
  indexerWsUrl: string,
): Promise<readonly FundingContractAction[]> {
  if (!HEX32.test(account)) throw new Error('invalid ACC address');
  const latest = await fetch(indexerUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: `query($address: HexEncoded!) { contractAction(address: $address) { ${ACTION_FIELDS} } }`,
      variables: { address: account },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!latest.ok) throw new Error(`indexer frontier failed: HTTP ${latest.status}`);
  const body: unknown = await latest.json();
  if (!object(body) || (Array.isArray(body.errors) && body.errors.length > 0) || !object(body.data))
    throw new Error('indexer frontier query failed');
  const frontier = parseAction(body.data.contractAction, account);

  return new Promise((resolve, reject) => {
    const actions: FundingContractAction[] = [];
    const socket = new WebSocket(indexerWsUrl, 'graphql-transport-ws');
    let finished = false;
    let drain: ReturnType<typeof setTimeout> | undefined;
    const deadline = setTimeout(() => finish(new Error('indexer action replay timed out')), 60_000);
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      if (drain) clearTimeout(drain);
      socket.close();
      if (error) reject(error);
      else resolve(actions);
    };
    socket.addEventListener('error', () => finish(new Error('indexer websocket failed')));
    socket.addEventListener('close', () => {
      if (!finished) finish(new Error('indexer action replay ended before the frontier'));
    });
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'connection_init' })));
    socket.addEventListener('message', (event) => {
      try {
        const message: unknown = JSON.parse(String(event.data));
        if (!object(message)) throw new Error('invalid indexer websocket message');
        if (message.type === 'connection_ack') {
          socket.send(
            JSON.stringify({
              id: 'funding-reconcile',
              type: 'subscribe',
              payload: {
                query: `subscription($address: HexEncoded!) { contractActions(address: $address, offset: { height: 0 }) { ${ACTION_FIELDS} } }`,
                variables: { address: account },
              },
            }),
          );
        } else if (message.type === 'next') {
          if (
            !object(message.payload) ||
            (Array.isArray(message.payload.errors) && message.payload.errors.length > 0) ||
            !object(message.payload.data)
          )
            throw new Error('indexer action replay returned no data');
          const action = parseAction(message.payload.data.contractActions, account);
          actions.push(action);
          if (actions.length > 10_000) throw new Error('ACC action replay exceeds the safety cap');
          if (action.txHash === frontier.txHash && !drain) drain = setTimeout(() => finish(), 500);
        } else if (message.type === 'error') {
          throw new Error('indexer action replay returned an error');
        } else if (message.type === 'complete') {
          if (!drain) throw new Error('indexer action replay ended before the frontier');
          finish();
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error('indexer action replay failed'));
      }
    });
  });
}
