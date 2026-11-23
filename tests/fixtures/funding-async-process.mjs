import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createFileFundingStore,
  createServer,
  fundingRoute,
} from '../../packages/service/dist/index.js';

const [mode, root] = process.argv.slice(2);
if (!['hold', 'reopen'].includes(mode ?? '') || !root)
  throw new Error('invalid funding process fixture');
const color = 'cd'.repeat(32);
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
      async fund() {
        await writeFile(join(root, mode === 'hold' ? 'started' : 'forbidden-redispatch'), '1');
        if (mode === 'reopen') throw new Error('reopened worker must not dispatch');
        return new Promise(() => {});
      },
    },
    now: () => new Date('2026-10-15T12:00:00Z'),
    log: () => {},
  }),
]);
server.listen(0, '127.0.0.1', () => {
  const bound = server.address();
  if (!bound || typeof bound === 'string') throw new Error('fixture failed to bind');
  process.stdout.write(`${JSON.stringify({ port: bound.port })}\n`);
});
