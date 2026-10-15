import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fund, manifestStatus, parseArgs } from '../scripts/demo.mjs';
import binding from '../packages/contract/acc-binding-v2.generated.json' with { type: 'json' };

test('demo CLI chooses up by default and parses explicit setup options', () => {
  assert.deepEqual(parseArgs([]), {
    command: 'up',
    arm: 'p256',
    keyService: true,
    funding: false,
    open: false,
    mockPasskey: false,
  });
  const args = ['setup', '--passport-repo', '.', '--no-key-service'];
  const parsed = parseArgs(args);
  assert.equal(parsed.command, 'setup');
  assert.equal(parsed.passportRepo, process.cwd());
  assert.equal(parsed.keyService, false);
  assert.equal(parseArgs(['up', '--funding']).funding, true);
  assert.equal(parseArgs(['up', '--arm', 'jubjub']).arm, 'jubjub');
  assert.throws(() => parseArgs(['up', '--arm', 'k256']), /--arm needs/);
  assert.deepEqual(args, ['setup', '--passport-repo', '.', '--no-key-service']);
  assert.throws(() => parseArgs(['up', '--contract-dir']), /needs a directory/);
  assert.equal(parseArgs(['-h']).help, true);
  assert.throws(() => parseArgs(['reset']), /unknown command/);
});

test('demo fund command sends a pinned authenticated request with the caller idempotency key', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'passport-demo-fund-'));
  const tokenFile = join(temporary, 'token');
  writeFileSync(tokenFile, 'test-token');
  const previousToken = process.env.PASSPORT_FUNDING_TOKEN_FILE;
  const previousUrl = process.env.PASSPORT_FUNDING_URL;
  /** @type {{ requestId: string } | undefined} */
  let posted;
  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/healthz') {
      response.end(
        JSON.stringify({
          networkId: 'undeployed',
          bindingId: binding.id,
          manifestSha256: binding.manifestSha256,
        }),
      );
      return;
    }
    assert.equal(request.headers.authorization, 'Bearer test-token');
    let body = '';
    for await (const chunk of request) body += chunk;
    posted = /** @type {{ requestId: string }} */ (JSON.parse(body));
    response.end(
      JSON.stringify({ requestId: posted.requestId, txId: 'tx-1', creditedBalance: '10' }),
    );
  });
  await new Promise((resolveReady) => server.listen(0, '127.0.0.1', () => resolveReady(undefined)));
  try {
    const address = 'ab'.repeat(32);
    const color = 'cd'.repeat(32);
    const requestId = '12345678-1234-4234-9234-123456789abc';
    process.env.PASSPORT_FUNDING_TOKEN_FILE = tokenFile;
    const bound = /** @type {import('node:net').AddressInfo} */ (server.address());
    process.env.PASSPORT_FUNDING_URL = `http://127.0.0.1:${bound.port}`;
    const options = parseArgs([
      'fund',
      '--account',
      address,
      '--color',
      color,
      '--amount',
      '10',
      '--request-id',
      requestId,
    ]);
    const result = await fund(options);
    assert.equal(result.txId, 'tx-1');
    assert.deepEqual(posted, {
      requestId,
      networkId: 'undeployed',
      bindingId: binding.id,
      manifestSha256: binding.manifestSha256,
      accountAddress: address,
      color,
      amount: '10',
    });
    process.env.PASSPORT_FUNDING_URL = 'http://example.test';
    await assert.rejects(fund(options), /HTTPS or loopback HTTP/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousToken === undefined) delete process.env.PASSPORT_FUNDING_TOKEN_FILE;
    else process.env.PASSPORT_FUNDING_TOKEN_FILE = previousToken;
    if (previousUrl === undefined) delete process.env.PASSPORT_FUNDING_URL;
    else process.env.PASSPORT_FUNDING_URL = previousUrl;
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('demo setup rejects an ACC manifest that differs from its release binding', () => {
  const contract = mkdtempSync(join(tmpdir(), 'passport-demo-cli-'));
  try {
    const compiler = join(contract, 'contracts/managed/account/compiler');
    assert.equal(manifestStatus(contract), 'missing');
    mkdirSync(compiler, { recursive: true });
    const manifest = '{}';
    writeFileSync(join(compiler, 'contract-manifest.json'), manifest);
    assert.throws(
      () => manifestStatus(contract),
      new RegExp(createHash('sha256').update(manifest).digest('hex')),
    );
  } finally {
    rmSync(contract, { recursive: true, force: true });
  }
});
