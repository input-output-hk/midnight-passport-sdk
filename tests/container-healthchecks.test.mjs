import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const interfaceAddress = Object.values(networkInterfaces())
  .flat()
  .find((a) => a?.family === 'IPv4' && !a.internal)?.address;
for (const [app, prefix] of [
  ['service', 'SERVICE'],
  ['funding-service', 'FUNDING'],
]) {
  const dockerfile = readFileSync(
    new URL(`../apps/passport-${app}/Dockerfile`, import.meta.url),
    'utf8',
  );
  const script = /^\s*CMD node -e "(.+)"$/m.exec(dockerfile)?.[1];
  assert.ok(script, 'image healthcheck must be present');
  for (const host of ['0.0.0.0', ...(interfaceAddress ? [interfaceAddress] : []), '::1']) {
    test(
      `${app} healthcheck reaches configured bind host ${host} and custom port`,
      { timeout: 10_000 },
      async (t) => {
        const server = createServer((_request, response) => response.writeHead(200).end());
        try {
          await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen({ host, port: 0, ipv6Only: host === '::1' }, () => resolve(undefined));
          });
        } catch (error) {
          if (
            host === '::1' &&
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'EAFNOSUPPORT'
          ) {
            t.skip('IPv6 unavailable');
            return;
          }
          throw error;
        }
        t.after(() => new Promise((resolve) => server.close(resolve)));
        const address = server.address();
        assert.ok(address && typeof address === 'object');
        await run(process.execPath, ['-e', script], {
          timeout: 5_000,
          env: {
            ...process.env,
            [`PASSPORT_${prefix}_HOST`]: host,
            [`PASSPORT_${prefix}_PORT`]: String(address.port),
          },
        });
      },
    );
  }
}
