import { request } from 'node:http';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releasePlan } from '../scripts/release/plan.mjs';
import { mountedPlan } from '../scripts/release/mounted-plan.mjs';
import { preflightMounted } from '../scripts/release/mounted-preflight.mjs';
import { fundingTransactionIdentity, repeatedFunding } from '../scripts/release/mounted-client.mjs';
import { installedFence, imageInterval } from '../scripts/release/fences.mjs';
import { admitSyntheticFixture } from '../scripts/rc-qualification-private.mjs';
import { loggedCommand, probeEnvironment } from '../scripts/release/process.mjs';
import {
  admitPagesWorkflow,
  canonicalPages,
  verifyRenderedInstructions,
} from '../scripts/release/pages-policy.mjs';
import { samePlatformArchives } from '../scripts/release/reproducibility.mjs';
import { ResourceOwner } from '../scripts/release/resources.mjs';
import { imageCase } from '../scripts/release/image-runtime.mjs';
import { verifyImage } from '../scripts/release/images.mjs';
import { sha256 } from '../scripts/release/files.mjs';
import { createServer } from '../packages/service/dist/index.js';
import { FakeDocker } from './fixtures/release-docker.mjs';

const release = JSON.parse(
  readFileSync(new URL('../scripts/release/plan.example.json', import.meta.url), 'utf8'),
);
const mounted = JSON.parse(
  readFileSync(new URL('../scripts/release/mounted-plan.example.json', import.meta.url), 'utf8'),
);
test('closed plans preserve distinct SDK/publisher/docs identities and reject additions/substitution/duplicates', () => {
  const plan = releasePlan(release);
  assert.notEqual(plan.source, plan.publisher.source);
  assert.notEqual(plan.source, plan.pages.head);
  assert.throws(() => releasePlan({ ...release, token: 'forbidden' }));
  assert.throws(() =>
    releasePlan({ ...release, images: [release.images[0], release.images[0], release.images[2]] }),
  );
  assert.throws(() =>
    releasePlan({
      ...release,
      sourceAttestation: { ...release.sourceAttestation, source: 'a'.repeat(40) },
    }),
  );
  assert.throws(() => mountedPlan({ ...mounted, servicePort: 8787 }));
  assert.throws(() =>
    mountedPlan({
      ...mounted,
      chainImages: [...mounted.chainImages.slice(0, 2), mounted.chainImages[0]],
    }),
  );
  assert.equal(mountedPlan(mounted).images.length, 2);
});

test('read-only mounted preflight refuses missing image/occupied descriptor before any allocation', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mounted-preflight-'))),
    output = join(root, 'new');
  const plan = mountedPlan({ ...mounted, contract: root + '/contract' });
  mkdirSync(plan.contract);
  mkdirSync(root + '/repository');
  /** @type {string[][]} */ const calls = [];
  const engine = {
    info: { MemTotal: 48 * 1024 ** 3 },
    docker: (/** @type {string[]} */ args) => {
      calls.push(args);
      return {
        stdout: JSON.stringify(
          args[0] === 'volume' ? [{ Name: plan.linuxDependencies.volume }] : [],
        ),
        stderr: '',
        status: 0,
      };
    },
  };
  try {
    await assert.rejects(() =>
      preflightMounted(root + '/repository', plan, output, engine, {
        source: async () => {},
        freePort: async () => {},
        diskBytes: () => 30n * 1024n ** 3n,
      }),
    );
    assert.ok(calls.every((args) => args.includes('inspect')));
    assert.ok(calls.length >= 2);
    writeFileSync(output, 'original descriptor');
    calls.length = 0;
    await assert.rejects(() =>
      preflightMounted(root + '/repository', plan, output, engine, {
        source: async () => {},
        freePort: async () => {},
        diskBytes: () => 30n * 1024n ** 3n,
      }),
    );
    assert.equal(calls.length, 0);
    assert.equal(readFileSync(output, 'utf8'), 'original descriptor');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('consumer fence runs after a failed probe and records independent drift/failure state', async () => {
  let captures = 0;
  /** @type {unknown} */ let receipt;
  await assert.rejects(
    () =>
      installedFence(
        () => ({ graph: captures++ === 0 ? 'before' : 'after' }),
        async () => {
          throw Error('probe failed');
        },
        (value) => {
          receipt = value;
        },
      ),
    /graph changed/,
  );
  assert.equal(captures, 2);
  assert.deepEqual(receipt, { checked: true, inputsUnchanged: false });
  await assert.rejects(
    () =>
      installedFence(
        () => 'same',
        async () => {
          throw Error('probe failed');
        },
        (value) => {
          receipt = value;
        },
      ),
    /probe failed/,
  );
  assert.deepEqual(receipt, { checked: true, inputsUnchanged: true });
});
test('image coordinator reports unresolved cleanup when daemon identity verification fails', async () => {
  const fake = new FakeDocker(),
    owner = new ResourceOwner('a'.repeat(16), fake.run, () => {});
  /** @type {unknown} */ let complete;
  await assert.rejects(
    () =>
      imageInterval(
        owner,
        () => {
          throw Error('daemon replaced');
        },
        async () => {
          const image = 'sha256:' + 'a'.repeat(64),
            row = owner.create('container', 'passport-coordinator-test', [image], image);
          owner.start(row);
          return 'passed work';
        },
        (value) => {
          complete = value;
        },
      ),
    /daemon replaced/,
  );
  assert.equal(complete, false);
  assert.equal(owner.resources[0]?.startAttempted, true);
});

test('only the public-key restore helper may fetch SRS; backend probes stay offline', () => {
  const pin = release.images.find((/** @type {{role:string}} */ image) => image.role === 'keys');
  const image = verifyImage(
    {
      Id: 'sha256:' + 'a'.repeat(64),
      Os: 'linux',
      Architecture: 'amd64',
      RepoDigests: [pin.repository + '@' + pin.digest],
      Config: { User: '10001:10001', Cmd: ['node'] },
    },
    pin,
  );
  const fake = new FakeDocker(),
    owner = new ResourceOwner('a'.repeat(16), fake.run, () => {});
  imageCase(owner, image, 'key-restore', [], [], undefined, undefined, undefined, 'bridge');
  const create = fake.calls.find((args) => args[0] === 'create');
  assert.ok(create);
  assert.equal(create[create.indexOf('--network') + 1], 'bridge');
  assert.throws(
    () =>
      imageCase(
        owner,
        { ...image, role: 'service' },
        'service-probe',
        [],
        [],
        undefined,
        undefined,
        undefined,
        'bridge',
      ),
    /Only public-key/,
  );
  assert.equal(owner.resources.length, 1);
  imageCase(owner, { ...image, role: 'service' }, 'service-offline', []);
  const offline = fake.calls.filter((args) => args[0] === 'create').at(-1);
  assert.ok(offline);
  assert.equal(offline[offline.indexOf('--network') + 1], 'none');
});

test('fixture/evidence and temporary-record aliases refuse before dispatch', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'synthetic-fixture-'))),
    evidence = join(root, 'evidence');
  try {
    admitSyntheticFixture(evidence, join(root, 'owner'));
    for (const fixture of [evidence, evidence + '.tmp'])
      assert.throws(() => admitSyntheticFixture(evidence, fixture), /overlap/);
    assert.throws(() => admitSyntheticFixture(evidence + '.record', evidence), /overlap/);
    writeFileSync(join(root, 'owner'), 'retained');
    assert.throws(() => admitSyntheticFixture(evidence, join(root, 'owner')), /Preserve/);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('timed-out actual command retains redacted partial bytes and probes drop auth/preload overrides', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-partial-log-'));
  try {
    const secret = 'synthetic-auth-token';
    assert.throws(
      () =>
        loggedCommand(
          root,
          'partial.log',
          process.execPath,
          [
            '-e',
            "process.stdout.write(process.env.GITHUB_TOKEN+' https://pkg-npm.githubusercontent.com/a?sig=secret');setInterval(()=>{},1000)",
          ],
          { timeout: 200, env: { ...process.env, GITHUB_TOKEN: secret } },
        ),
      /partial output retained/,
    );
    const bytes = readFileSync(join(root, 'partial.log'));
    assert.ok(bytes.includes('[REDACTED]'));
    assert.ok(!bytes.includes(secret));
    assert.ok(!bytes.includes('sig='));
    const result = loggedCommand(root, 'exact.log', process.execPath, [
      '-e',
      "process.stdout.write('no newline')",
    ]);
    assert.equal(result.log.sha256, sha256(readFileSync(join(root, 'exact.log'))));
    const env = probeEnvironment();
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.GH_TOKEN, undefined);
    assert.equal(env.NODE_OPTIONS, undefined);
  } finally {
    rmSync(root, { recursive: true });
  }
});

const tx = '0x' + 'a'.repeat(64),
  secondTx = '0x' + 'b'.repeat(64);
test('funding identifiers preserve tagged ledger bytes and normalize only hex display wrappers', () => {
  const tagged = '00' + 'a'.repeat(64);
  assert.equal(fundingTransactionIdentity(tagged), tagged);
  assert.equal(fundingTransactionIdentity('0x' + tagged), tagged);
  assert.notEqual(fundingTransactionIdentity('01' + 'a'.repeat(64)), tagged);
  assert.equal(fundingTransactionIdentity('ledger:opaque/id'), 'ledger:opaque/id');
  for (const value of [undefined, null, {}, '', 'a'.repeat(257), 'id\n', 'id secret'])
    assert.throws(() => fundingTransactionIdentity(value));
});
function originalFunding() {
  const request = {
    requestId: 'original-id',
    accountAddress: 'c'.repeat(64),
    color: '00'.repeat(32),
    amount: '10',
  };
  const funded = { requestId: request.requestId, txId: tx, creditedBalance: '10' };
  return {
    before: { night: '0' },
    after: { night: '10' },
    account: request.accountAddress,
    request,
    funded,
    replay: { ...funded },
  };
}
for (const variant of [
  'valid',
  'tagged-ledger-id',
  'nonzero-baseline',
  'wrong-first-credit',
  'different-replay',
  'missing-second-tx',
  'reused-tx',
  'prefix-reused-tx',
  'no-second-credit',
  'inventory-catchup',
  'preflight-mismatched-id',
  'preflight-unknown-submission',
  'preflight-transport-error',
  'preflight-terminal',
  'inventory-aborted',
  'inventory-expired',
  'inventory-wrong-binding',
  'inventory-duplicate-assets',
  'refusal-missing-id',
  'refusal-mismatched-id',
])
  test(`production repeated-funding assertions: ${variant}`, async (t) => {
    const result = originalFunding();
    if (variant === 'tagged-ledger-id') {
      result.funded.txId = '00' + 'a'.repeat(64);
      result.replay.txId = result.funded.txId;
    }
    if (variant === 'nonzero-baseline') result.before.night = '10';
    if (variant === 'wrong-first-credit') result.after.night = '20';
    if (variant === 'different-replay') result.replay.txId = secondTx;
    /** @type {unknown[]} */ const retained = [];
    /** @type {Record<string,unknown>[]} */ const submissions = [];
    let refusedOnce = false;
    let now = 0;
    if (variant === 'inventory-expired') t.mock.method(performance, 'now', () => now);
    t.mock.method(
      globalThis,
      'fetch',
      async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
        let status = 200,
          body;
        if (url.includes('/assets')) {
          status = new Headers(init.headers).has('Authorization') ? 200 : 403;
          const catchingUp =
            ['inventory-catchup', 'inventory-aborted'].includes(variant) && !refusedOnce;
          if (status === 200) {
            refusedOnce = true;
            if (variant === 'inventory-expired') now = 180_000;
          }
          body = {
            networkId: 'undeployed',
            bindingId: variant === 'inventory-wrong-binding' ? 'different' : 'acc-s3r1.1',
            manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
            assets: [
              {
                color: '00'.repeat(32),
                amount: '10',
                availability: catchingUp ? 'unavailable' : 'available',
              },
              {
                color: (variant === 'inventory-duplicate-assets' ? '00' : 'ab').repeat(32),
                amount: '10',
                availability: catchingUp ? 'unavailable' : 'insufficient',
              },
            ],
          };
        } else if (url.includes('/fund')) {
          const request = JSON.parse(String(init.body));
          submissions.push(request);
          if (variant === 'preflight-transport-error') throw new Error('lost reply');
          if (variant.startsWith('preflight-')) {
            status = 503;
            body = {
              code: 'FundingWalletUnavailable',
              submission: variant === 'preflight-unknown-submission' ? 'unknown' : 'not-started',
              requestId: variant === 'preflight-mismatched-id' ? 'different-id' : request.requestId,
            };
          } else if (request.color === 'ab'.repeat(32)) {
            status = 409;
            body = {
              code: 'FundingAssetUnavailable',
              submission: 'not-started',
              ...(variant === 'refusal-missing-id'
                ? {}
                : {
                    requestId:
                      variant === 'refusal-mismatched-id' ? 'different-id' : request.requestId,
                  }),
            };
          } else
            body = {
              requestId: request.requestId,
              creditedBalance: variant === 'no-second-credit' ? '10' : '20',
              ...(variant === 'missing-second-tx'
                ? {}
                : {
                    txId:
                      variant === 'reused-tx'
                        ? tx
                        : variant === 'prefix-reused-tx'
                          ? tx.slice(2)
                          : variant === 'tagged-ledger-id'
                            ? '00' + 'b'.repeat(64)
                            : secondTx,
                  }),
            };
        } else body = { night: variant === 'no-second-credit' ? '10' : '20' };
        return new Response(JSON.stringify(body), { status });
      },
    );
    const run = repeatedFunding(
      'synthetic-token',
      result,
      (value) => retained.push(value),
      () => {
        assert.ok(!(variant === 'inventory-aborted' && refusedOnce), 'operator interrupted');
      },
    );
    if (variant === 'valid' || variant === 'tagged-ledger-id' || variant === 'inventory-catchup') {
      assert.equal((await run).repeatedDepositBalance, '20');
      assert.equal(retained.length, variant === 'inventory-catchup' ? 7 : 6);
      assert.equal(submissions.length, 2);
      assert.ok(submissions[0] && submissions[1]);
      assert.notEqual(submissions[0].requestId, submissions[1].requestId);
    } else {
      await assert.rejects(run);
      if (variant.startsWith('inventory-')) assert.equal(submissions.length, 0);
      if (variant.startsWith('preflight-') || variant.startsWith('refusal-'))
        assert.equal(submissions.length, 1);
    }
  });

test('Pages workflow identity and active rendered release selection cannot pass from historical mention', () => {
  const head = 'a'.repeat(40),
    good = {
      path: '.github/workflows/docs-pages.yml',
      head_sha: head,
      status: 'completed',
      conclusion: 'success',
      event: 'push',
    };
  admitPagesWorkflow(good, head);
  assert.throws(() =>
    admitPagesWorkflow({ ...good, path: '.github/workflows/pr-checks.yml' }, head),
  );
  assert.throws(() => admitPagesWorkflow({ ...good, head_sha: 'b'.repeat(40) }, head));
  assert.equal(canonicalPages('0.1.0-rc9').length, 15);
  const stale =
    '<main><p>The current preview is <code>0.1.0-rc8</code>.</p><p>Historical reference: 0.1.0-rc9.</p></main>';
  assert.throws(
    () =>
      verifyRenderedInstructions(
        stale,
        'getting-started/installation.html',
        '0.1.0-rc9',
        release.images,
      ),
    /older release/,
  );
  verifyRenderedInstructions(
    stale.replace('current preview is <code>0.1.0-rc8', 'current preview is <code>0.1.0-rc9'),
    'getting-started/installation.html',
    '0.1.0-rc9',
    release.images,
  );
  verifyRenderedInstructions(
    '<main><p><span id="legacy-anchor"></span></p><p><code>0.1.0-rc9</code> is published.</p></main>',
    'getting-started/installation.html',
    '0.1.0-rc9',
    release.images,
  );
  assert.throws(
    () => samePlatformArchives([{ name: 'a', sha256: 'before' }], [{ name: 'a', sha256: 'after' }]),
    /not reproducible/,
  );
});

test('actual HTTP Host guard refuses translated application port before funding/SDK routing', async () => {
  let routed = 0;
  const server = createServer({ host: '127.0.0.1', corsOrigin: 'http://localhost:5173' }, [
    async (_request, response) => {
      routed++;
      response.writeHead(200).end('ok');
      return true;
    },
  ]);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const bad = await new Promise((resolve, reject) => {
      const client = request(
        {
          host: '127.0.0.1',
          port: address.port,
          path: '/healthz',
          headers: { Host: '127.0.0.1:8787' },
        },
        (reply) => {
          reply.resume();
          reply.on('end', () => resolve(reply.statusCode));
        },
      );
      client.setTimeout(3_000, () => client.destroy(Error('Request timeout')));
      client.on('error', reject);
      client.end();
    });
    assert.equal(bad, 421);
    assert.equal(routed, 0);
    const good = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    assert.equal(good.status, 200);
    await good.text();
    assert.equal(routed, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
