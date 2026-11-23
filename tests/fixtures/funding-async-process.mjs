import { writeFileSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createFileFundingStore,
  createServer,
  fundingRoute,
} from '../../packages/service/dist/index.js';

const [mode, root] = process.argv.slice(2);
if (
  !['hold', 'hold-after-submit', 'reopen', 'proof-fail', 'unknown-submit', 'credit'].includes(
    mode ?? '',
  ) ||
  !root
)
  throw new Error('invalid funding process fixture');
const color = '00'.repeat(32);
const server = createServer({ host: '127.0.0.1', corsOrigin: 'http://localhost:5173' }, [
  fundingRoute({
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    manifestSha256: 'ef'.repeat(32),
    assets: [{ color, maxPerRequest: 20n, maxPerUtcDay: 25n }],
    authorize: async () => true,
    eligible: async () => true,
    store: createFileFundingStore(join(root, 'reservations.json')),
    backend: {
      async fund(request, recordProgress) {
        if (mode === 'reopen') throw new Error('reopened worker must not dispatch');
        if (!recordProgress) throw new Error('fixture needs durable progress recorder');
        await appendFile(join(root, 'dispatches'), `${request.requestId}\n`);
        await recordProgress({ stage: 'balance-observed', balanceBefore: '0' });
        await recordProgress({ stage: 'prepared', preparationTxId: 'fixture-wallet-preparation' });
        if (mode === 'hold') {
          await writeFile(join(root, 'started'), '1');
          return new Promise(() => {});
        }
        if (mode === 'proof-fail') {
          await recordProgress({ stage: 'acc-not-submitted' });
          throw new Error('fixture proof failed before ACC send fence');
        }
        await recordProgress({ stage: 'submitted', txId: 'fixture-acc-deposit' });
        await appendFile(join(root, 'acc-submissions'), `${request.requestId}\n`);
        if (mode === 'hold-after-submit') {
          await writeFile(join(root, 'started'), '1');
          return new Promise(() => {});
        }
        if (mode === 'unknown-submit') throw new Error('fixture node response lost');
        return {
          requestId: request.requestId,
          txId: 'fixture-acc-deposit',
          preparationTxId: 'fixture-wallet-preparation',
          creditedBalance: '10',
        };
      },
    },
    now: () => new Date('2026-10-15T12:00:00Z'),
    log: (message) => {
      if (mode === 'unknown-submit' && JSON.parse(message).code === 'FundingOutcomeUnknown')
        writeFileSync(join(root, 'outcome-unknown'), '1');
    },
  }),
]);
server.listen(0, '127.0.0.1', () => {
  const bound = server.address();
  if (!bound || typeof bound === 'string') throw new Error('fixture failed to bind');
  process.stdout.write(`${JSON.stringify({ port: bound.port })}\n`);
});
