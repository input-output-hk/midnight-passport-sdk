import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import {
  sessionContainer,
  sessionProject,
  sessionDependencyIdentity,
  SESSION_ENDPOINTS,
} from '../scripts/qualification/session-profile.mjs';
import { dedicatedIndexerReadiness } from '../scripts/qualification/indexer-readiness.mjs';
import { planSuite } from '../scripts/qualification/runner.mjs';
const project = sessionProject('123456789abcdef0');
const id = 'ab'.repeat(32),
  image = 'sha256:' + 'cd'.repeat(32);
/** @returns {any} */
function container() {
  const ports = { '8088/tcp': [{ HostIp: '127.0.0.1', HostPort: '18108' }] };
  return {
    Id: id,
    Image: image,
    Name: '/' + project + '-indexer',
    Config: {
      Labels: { 'passport.session.project': project, 'passport.session.service': 'indexer' },
    },
    State: { Running: true },
    HostConfig: { PortBindings: structuredClone(ports) },
    NetworkSettings: {
      Ports: structuredClone(ports),
      Networks: { [project]: { IPAddress: '172.30.0.2' } },
    },
    Mounts: [{ Type: 'volume', Name: project + '-indexer-data', Destination: '/data' }],
  };
}
test('native session controls reject retained/shared resources and detached live endpoints', () => {
  assert.equal(sessionContainer(container(), project, 'indexer', image), id);
  for (const mutate of /** @type {Array<(c:any)=>void>} */ ([
    (c) => (c.Config.Labels['passport.session.project'] = 'mn-passport-qual-20261023'),
    (c) => (c.Name = '/mn-passport-sdk-localnet-indexer-1'),
    (c) => (c.Image = 'sha256:' + 'ee'.repeat(32)),
    (c) => (c.HostConfig.PortBindings['8088/tcp'][0].HostPort = '18098'),
    (c) => (c.NetworkSettings.Ports = {}),
    (c) => (c.NetworkSettings.Networks = {}),
    (c) => (c.Mounts[0].Name = 'mn-passport-qual-20261023_indexer-data'),
    (c) => (c.Mounts[0].Destination = '/different'),
    (c) => c.Mounts.push({ Type: 'bind', Source: '/private', Destination: '/secret' }),
  ])) {
    const c = container();
    mutate(c);
    assert.throws(() => sessionContainer(c, project, 'indexer', image));
  }
  assert.throws(() => sessionProject('../retained'));
  const stopped = container();
  stopped.State.Running = false;
  stopped.NetworkSettings.Ports = {};
  assert.equal(sessionContainer(stopped, project, 'indexer', image, false), id);
});
test('isolated readiness uses only its supplied endpoints and still requires canonical finality', async () => {
  const calls = /** @type {string[]} */ ([]),
    hash = 'a'.repeat(64),
    time = 1793910000000;
  const ready = await dedicatedIndexerReadiness({
    ...SESSION_ENDPOINTS,
    now: () => time,
    fetch: async (url, options) => {
      calls.push(String(url));
      const body = JSON.parse(String(options?.body));
      const value =
        body.method === 'chain_getFinalizedHead'
          ? { result: '0x' + hash }
          : body.method === 'chain_getHeader'
            ? { result: { number: '0x10' } }
            : { data: { block: { hash, height: 16, timestamp: time - 12000 } } };
      return new Response(JSON.stringify(value));
    },
  });
  assert.equal(ready.ready, true);
  assert.deepEqual(calls, [
    SESSION_ENDPOINTS.nodeUrl,
    SESSION_ENDPOINTS.nodeUrl,
    SESSION_ENDPOINTS.indexerUrl,
  ]);
  assert.equal(
    calls.some((url) => /18098|18088|19954/.test(url)),
    false,
  );
});
test('native session suite is opt-in and accurately declares its proof/provider boundaries', () => {
  const [plan] = planSuite('consented-sessions-native', {});
  assert.equal(plan?.tier, 'proof-localnet');
  assert.ok(plan.missing.includes('PASSPORT_SESSION_NATIVE'));
  assert.ok(plan.missing.includes('PASSPORT_SESSION_ROOT'));
  assert.match(plan.establishes, /No retained\/default stack control/);
  assert.deepEqual(plan.command.slice(1), ['scripts/qualification/live-sessions.mjs']);
});

test('native session dependency pins detect executable drift and refuse arbitrary external links', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-dependency-test-'));
  try {
    const modules = join(root, 'node_modules');
    mkdirSync(modules);
    writeFileSync(join(modules, 'runtime.js'), 'export const version = 1;');
    const first = sessionDependencyIdentity(root);
    writeFileSync(join(modules, 'runtime.js'), 'export const version = 2;');
    assert.notEqual(sessionDependencyIdentity(root).treeSha256, first.treeSha256);
    symlinkSync(tmpdir(), join(modules, 'outside'));
    assert.throws(() => sessionDependencyIdentity(root), /escapes the frozen workspace/);
    rmSync(join(modules, 'outside'));
    const pkg = join(root, 'packages', 'account');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({ name: '@input-output-hk/mn-passport-account' }),
    );
    symlinkSync('../packages/account', join(modules, 'workspace'));
    assert.equal(sessionDependencyIdentity(root).workspaceLinks, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
