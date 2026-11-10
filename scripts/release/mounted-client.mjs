// Source SDK client; original creation/funding intents remain private after interruption.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isolatedProcesses } from '../qualification/native-isolation-control.mjs';
import { json, object, text } from './files.mjs';
import { probeEnvironment } from './process.mjs';
import { MOUNTED_PORTS } from './mounted-plan.mjs';
import { MANIFEST } from './mounted-services.mjs';
import { mountedHttp, waitMounted } from './mounted-services.mjs';

/** @param {string} repository @param {string} root @param {()=>void} check @param {(phase:string)=>void} intent */
export function mountedClient(repository, root, check, intent) {
  const processes = isolatedProcesses();
  let closed = false,
    exit = -1;
  const evidence = join(root, 'source-client.private.json');
  return {
    stop: () => processes.stop(8_000).then((result) => !result.incomplete),
    start() {
      intent('create-account-outcome-unknown'); // No subsequent run may assume absence of this effect.
      /** @type {NodeJS.ProcessEnv} */ const env = {
        ...probeEnvironment(),
        PASSPORT_RC_LOCALNET: '1',
        MN_NETWORK_ID: 'undeployed',
        PASSPORT_SERVICE_URL: `http://127.0.0.1:${MOUNTED_PORTS.service}`,
        PASSPORT_FUNDING_URL: `http://127.0.0.1:${MOUNTED_PORTS.funding}`,
        PASSPORT_FUNDING_TOKEN_FILE: join(root, 'funding-token.private'),
        PASSPORT_RC_EVIDENCE: evidence,
        PASSPORT_RC_SYNTHETIC_FIXTURE: join(root, 'synthetic-owner.private.json'),
      };
      for (const name of ['GITHUB_TOKEN', 'GH_TOKEN', 'NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD'])
        delete env[name];
      const log = openSync(join(root, 'source-client.private.log'), 'wx', 0o600);
      try {
        const child = spawn(process.execPath, ['scripts/qualify-rc-localnet.mjs'], {
          cwd: repository,
          env,
          detached: true,
          stdio: ['ignore', log, log],
        });
        processes.register(child);
        child.once('close', (code) => {
          closed = true;
          exit = code ?? -1;
        });
      } finally {
        closeSync(log);
      }
    },
    async created() {
      await waitMounted(
        check,
        async () => {
          assert.equal(closed, false, 'Source client exited before account confirmation');
          if (!existsSync(evidence)) return false;
          const result = json(evidence);
          return result.createActivateReadReopen === 'passed';
        },
        1_800_000,
      );
      intent('create-activate-read-reopen-confirmed-funding-pending');
    },
    async funded() {
      await waitMounted(check, async () => closed, 1_800_000);
      assert.equal(exit, 0);
      const result = json(evidence);
      assert.equal(result.verdict, 'PASS');
      return result;
    },
  };
}

/** Ledger identifiers are opaque; v9 uses tagged bytes, distinct from transactionHash().
 * Normalize a hex display wrapper without discarding any ledger tag.
 * @param {unknown} value */
export function fundingTransactionIdentity(value) {
  const id = text(value, /^[a-zA-Z0-9:._~+/%=-]{1,256}$/);
  assert.equal(/\s/.test(id), false, 'Transaction identifier contains whitespace');
  return /^(?:0x)?(?:[a-f0-9]{2})+$/i.test(id) ? id.replace(/^0x/i, '').toLowerCase() : id;
}

/** Inventory is advisory: wait before dispatch, but never retry a POST refusal.
 * The durable funding store treats preflight-released IDs as terminal.
 * @param {string} base @param {string} token
 * @param {string} phase @param {(value:unknown)=>void} retain @param {()=>void} check */
async function waitFundingInventory(base, token, phase, retain, check) {
  const deadline = performance.now() + 180_000;
  for (;;) {
    check();
    assert.ok(
      performance.now() < deadline,
      'Funding wallet did not synchronize; no deposit dispatched',
    );
    const reply = await mountedHttp(base, '/v1/faucet/assets', token);
    retain({ phase: `${phase}-inventory`, response: reply });
    check();
    assert.equal(reply.status, 200);
    assert.equal(reply.body.networkId, 'undeployed');
    assert.equal(reply.body.bindingId, 'acc-s3r1.1');
    assert.equal(reply.body.manifestSha256, MANIFEST);
    assert.ok(Array.isArray(reply.body.assets));
    const assets = reply.body.assets.map(object);
    assert.equal(assets.length, 2);
    assert.deepEqual(assets.map((row) => row.color).sort(), ['00'.repeat(32), 'ab'.repeat(32)]);
    for (const row of assets) {
      assert.equal(row.amount, '10');
      assert.ok(['available', 'unavailable', 'insufficient'].includes(String(row.availability)));
    }
    assert.ok(performance.now() < deadline, 'Funding inventory deadline expired');
    if (!assets.every((row) => row.availability === 'unavailable')) {
      assert.equal(assets.find((row) => row.color === '00'.repeat(32))?.availability, 'available');
      assert.equal(
        assets.find((row) => row.color === 'ab'.repeat(32))?.availability,
        'insufficient',
      );
      return;
    }
    await delay(1_000);
  }
}

/** @param {string} token @param {Record<string,unknown>} result @param {(value:unknown)=>void} retain @param {()=>void} [check] */
export async function repeatedFunding(token, result, retain, check = () => {}) {
  assert.equal(object(result.before).night, '0', 'Fresh account must begin at zero');
  assert.equal(object(result.after).night, '10', 'First deposit must credit ten');
  const funded = object(result.funded),
    replay = object(result.replay),
    original = object(result.request);
  assert.deepEqual(replay, funded, 'Original-ID replay differs');
  assert.equal(funded.requestId, original.requestId);
  assert.equal(funded.creditedBalance, '10');
  const firstTx = fundingTransactionIdentity(funded.txId);
  assert.equal(original.accountAddress, result.account);
  assert.equal(original.color, '00'.repeat(32));
  assert.equal(original.amount, '10');
  const base = `http://127.0.0.1:${MOUNTED_PORTS.funding}`;
  assert.equal((await mountedHttp(base, '/v1/faucet/assets')).status, 403);
  const refused = { ...original, requestId: randomUUID(), color: 'ab'.repeat(32) };
  await waitFundingInventory(base, token, 'unprovisioned-token', retain, check);
  retain({ phase: 'unprovisioned-token-outcome-unknown', request: refused });
  const rejection = await mountedHttp(base, '/v1/faucet/fund', token, refused);
  retain({ phase: 'unprovisioned-token-reply', request: refused, response: rejection });
  assert.equal(rejection.status, 409);
  assert.equal(rejection.body.requestId, refused.requestId);
  assert.equal(rejection.body.submission, 'not-started');
  assert.equal(rejection.body.code, 'FundingAssetUnavailable');
  const next = { ...original, requestId: randomUUID() };
  await waitFundingInventory(base, token, 'second-night-deposit', retain, check);
  retain({ phase: 'second-night-deposit-outcome-unknown', request: next });
  const reply = await mountedHttp(base, '/v1/faucet/fund', token, next);
  retain({ phase: 'second-night-deposit-reply', request: next, response: reply });
  assert.equal(reply.status, 200);
  assert.equal(reply.body.requestId, next.requestId);
  assert.equal(reply.body.creditedBalance, '20');
  const secondTx = fundingTransactionIdentity(reply.body.txId);
  assert.notEqual(secondTx, firstTx, 'Second deposit must have a distinct confirmed transaction');
  const balance = await mountedHttp(
    base,
    `/v1/faucet/balances?accountAddress=${result.account}`,
    token,
  );
  assert.equal(balance.status, 200);
  assert.equal(balance.body.night, '20');
  return {
    createActivateReadReopen: true,
    nightDeposit: true,
    originalIdReplay: true,
    repeatedDepositBalance: '20',
    unprovisionedTokenNoSubmit: true,
    sourceSdkClient: true,
    registryInstalledNative: false,
    jobBackedImageFaults: false,
    realProvider: false,
    fullLace: false,
  };
}
