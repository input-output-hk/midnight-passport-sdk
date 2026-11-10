// Linux-mounted production entrypoints, fresh per-attempt state and one genesis wallet.
import assert from 'node:assert/strict';
import { initializeMountedVolumes } from './mounted-initialize.mjs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MOUNTED_PORTS, applicationPort } from './mounted-plan.mjs';
import { object, put } from './files.mjs';

export const MANIFEST = '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f';
/** @param {string} base @param {string} path @param {string} [token] @param {unknown} [body] */
export async function mountedHttp(base, path, token, body) {
  const response = await fetch(base + path, {
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(body === undefined ? 8_000 : 600_000),
  });
  return { status: response.status, body: object(await response.json()) };
}
/** @param {()=>void} check @param {()=>Promise<boolean>} test @param {number} timeoutMs */
export async function waitMounted(check, test, timeoutMs) {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) {
    check();
    if (await test()) return;
    await delay(500);
  }
  throw Error('Mounted stage deadline expired; preserve original attempt');
}
/** @param {ReturnType<import('./mounted-plan.mjs').mountedPlan>} plan @param {import('./resources.mjs').ResourceOwner} owner @param {string} root @param {string} project @param {()=>void} check */
export function mountedServices(plan, owner, root, project, check) {
  const serviceImage = plan.images.find((row) => row.role === 'service'),
    fundingImage = plan.images.find((row) => row.role === 'funding');
  assert.ok(serviceImage && fundingImage);
  const serviceId = inspectMountedImage(owner, serviceImage),
    fundingId = inspectMountedImage(owner, fundingImage);
  /** @type {Record<string,import('./resources.mjs').Resource>} */ const volumes = {};
  /** @type {import('./resources.mjs').Resource|undefined} */ let sponsor;
  const token = randomBytes(32).toString('hex');
  put(join(root, 'funding-token.private'), token + '\n');
  const env = (/** @type {Record<string,string>} */ values) =>
    Object.entries(values).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  const mounts = [
    '--mount',
    `type=bind,src=${plan.contract},dst=/data/contract,readonly`,
    '--mount',
    `type=volume,src=${plan.linuxDependencies.volume},dst=/data/contract/node_modules,readonly,volume-nocopy`,
  ];
  const common = {
    HOME: '/data/state',
    MN_NETWORK_ID: 'undeployed',
    MIDNIGHT_NETWORK: 'local',
    MN_NODE_URL: 'http://node:9944',
    MN_INDEXER_URL: 'http://indexer:8088/api/v4/graphql',
    MN_INDEXER_WS_URL: 'ws://indexer:8088/api/v4/graphql/ws',
    MN_PROOF_SERVER_URL: 'http://proof-server:6300',
    PASSPORT_MANIFEST_SHA256: MANIFEST,
  };
  const volume = (/** @type {string} */ role) => {
    const row = owner.create('volume', `${project}-${role}`, []);
    volumes[role] = row;
    return row.name;
  };
  const health = async (
    /** @type {import('./resources.mjs').Resource} */ row,
    /** @type {'service'|'funding'} */ role,
  ) => {
    await waitMounted(
      check,
      async () => {
        assert.equal(object(owner.inspect(row).State).Running, true, 'Owned image exited');
        try {
          const r = await mountedHttp(`http://127.0.0.1:${MOUNTED_PORTS[role]}`, '/healthz');
          if (r.status !== 200 || r.body.status !== 'ready') return false;
          assert.equal(r.body.networkId, 'undeployed');
          assert.equal(r.body.bindingId, 'acc-s3r1.1');
          assert.equal(r.body.manifestSha256, MANIFEST);
          return true;
        } catch {
          return false;
        }
      },
      600_000,
    );
  };
  return {
    token,
    serviceId,
    initialize() {
      initializeMountedVolumes(owner, volume, project, serviceId, token);
    },
    async service() {
      check();
      assert.ok(volumes['service-state']);
      const values = {
        ...common,
        PASSPORT_SERVICE_PORT: String(MOUNTED_PORTS.service),
        PASSPORT_MAX_DEPLOYS: '2',
        PASSPORT_PUBLIC_NODE_URL: 'http://127.0.0.1:19964',
        PASSPORT_PUBLIC_INDEXER_URL: 'http://127.0.0.1:18108/api/v4/graphql',
        PASSPORT_PUBLIC_INDEXER_WS_URL: 'ws://127.0.0.1:18108/api/v4/graphql/ws',
        PASSPORT_PUBLIC_PROOF_SERVER_URL: 'http://127.0.0.1:16320',
      };
      sponsor = owner.create(
        'container',
        `${project}-service`,
        [
          '--platform',
          'linux/amd64',
          '--network',
          project,
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges',
          '-p',
          applicationPort(MOUNTED_PORTS.service, Number(values.PASSPORT_SERVICE_PORT)),
          ...mounts,
          '--mount',
          `type=volume,src=${volumes['service-state'].name},dst=/data/state,volume-nocopy`,
          ...env(values),
          serviceId,
        ],
        serviceId,
      );
      owner.start(sponsor);
      await health(sponsor, 'service');
      return sponsor;
    },
    async funding() {
      check();
      assert.ok(sponsor, 'Sponsor phase must precede funding');
      owner.stop(sponsor); // Fresh inspection proves stop before a second genesis wallet.
      assert.equal(object(owner.inspect(sponsor).State).Running, false);
      assert.ok(volumes['funding-state'] && volumes.config && volumes['service-state']);
      const values = {
        ...common,
        PASSPORT_FUNDING_PORT: String(MOUNTED_PORTS.funding),
        PASSPORT_FUNDING_TOKEN_FILE: '/run/passport/funding-token',
        PASSPORT_FUNDING_ASSETS_FILE: '/run/passport/funding-assets.json',
        PASSPORT_FUNDING_DEPLOYMENTS_FILE: '/data/deployments/registry.deployments.json',
      };
      const row = owner.create(
        'container',
        `${project}-funding`,
        [
          '--platform',
          'linux/amd64',
          '--network',
          project,
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges',
          '-p',
          applicationPort(MOUNTED_PORTS.funding, Number(values.PASSPORT_FUNDING_PORT)),
          ...mounts,
          '--mount',
          `type=volume,src=${volumes['funding-state'].name},dst=/data/state,volume-nocopy`,
          '--mount',
          `type=volume,src=${volumes.config.name},dst=/run/passport,readonly,volume-nocopy`,
          '--mount',
          `type=volume,src=${volumes['service-state'].name},dst=/data/deployments,readonly,volume-nocopy`,
          ...env(values),
          fundingId,
        ],
        fundingId,
      );
      owner.start(row);
      await health(row, 'funding');
      return row;
    },
  };
}

/** @param {import('./resources.mjs').ResourceOwner} owner @param {{repository:string,digest:string}} pin */
function inspectMountedImage(owner, pin) {
  const rows = JSON.parse(
    owner.docker(['image', 'inspect', `${pin.repository}@${pin.digest}`]).stdout,
  );
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.ok(row.RepoDigests?.includes(`${pin.repository}@${pin.digest}`));
  assert.ok(
    row.Os === 'linux' && row.Architecture === 'amd64' && row.Config?.User === '10001:10001',
  );
  return String(row.Id);
}
