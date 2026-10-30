// Copied into an installed consumer before execution. Runtime imports are bare package imports;
// relative JSDoc types only check this harness when developing the SDK, never load workspace JS.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const load = (/** @type {string} */ name) => import(name);
const service = /** @type {typeof import('../../packages/service/dist/index.js')} */ (
  await load('@input-output-hk/mn-passport-service')
);
const adapter = /** @type {typeof import('../../packages/adapter-service/dist/index.js')} */ (
  await load('@input-output-hk/mn-passport-adapter-service')
);
const pins = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
};
const token = '33'.repeat(32); // Synthetic loopback operator only; no production authority.
const digest = (/** @type {string | Uint8Array} */ bytes) =>
  createHash('sha256').update(bytes).digest('hex');
const [role, directory, scheme, kind, boundary] = process.argv.slice(2);
if (!directory || !['suite', 'initial', 'recover'].includes(role ?? ''))
  throw Error('invalid installed qualification role');

/** @param {string} arm @param {string} type @param {number} n */
function descriptor(arm, type, n) {
  return {
    pins: { ...pins, scheme: /** @type {'p256-webauthn' | 'jubjub-schnorr'} */ (arm) },
    kind: /** @type {'call' | 'deploy'} */ (type),
    requestId: n.toString(16).padStart(32, '0') + ':0',
    intentSha256: 'aa'.repeat(32),
  };
}
/** @param {string} type @param {string} arm @returns {import('../../packages/adapter-service/dist/index.js').RemoteHostJobInput} */
function input(type, arm) {
  return type === 'call'
    ? {
        address: 'ab'.repeat(32),
        circuit: arm === 'p256-webauthn' ? 'append_inbox_with_p256' : 'append_inbox_with_jubjub',
        tx: '01',
      }
    : {
        boot: '11'.repeat(32),
        encKey: '22'.repeat(32),
        retireAuthority: true,
        firstArm: arm === 'p256-webauthn' ? 'p256' : 'jubjub',
      };
}

async function worker() {
  if (!scheme || !kind || !['before-host', 'after-send'].includes(boundary ?? ''))
    throw Error('invalid worker scope');
  const root = /** @type {string} */ (directory);
  const h = service.encryptedHostMutationStore(join(root, 'host'), new Uint8Array(32).fill(1));
  const j = service.encryptedHostJobStore(join(root, 'jobs'), new Uint8Array(32).fill(2));
  let forbidden = 0;
  const refuse = async () => {
    forbidden++;
    throw Error('recovery must not prepare or submit');
  };
  /** @type {Array<{identifier:string,txHash:string,succeeded:true}>} */ let ledger = [];
  try {
    ledger = JSON.parse(await readFile(join(root, 'ledger.json'), 'utf8'));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
  }
  const hold = async () => {
    process.send?.({ type: 'boundary' });
    await new Promise(() => {});
  };
  const driver = {
    prepare:
      role === 'recover'
        ? refuse
        : async () => ({ address: 'ab'.repeat(32), steps: kind === 'deploy' ? 2 : 1, context: {} }),
    prepareStep:
      role === 'recover'
        ? refuse
        : async (
            /** @type {import('../../packages/service/dist/index.js').HostMutationRecord} */ _r,
            /** @type {number} */ index,
          ) => ({ tx: '01', identifiers: [index.toString(16).padStart(64, '0')] }),
    submit:
      role === 'recover'
        ? refuse
        : async (
            /** @type {import('../../packages/service/dist/index.js').HostMutationStep} */ tx,
          ) => {
            const identifier = /** @type {string} */ (tx.identifiers[0]);
            assert.ok(
              !ledger.some((r) => r.identifier === identifier),
              'duplicate synthetic submission',
            );
            ledger.push({ identifier, txHash: digest(identifier), succeeded: true });
            const fd = await open(join(root, 'ledger.json'), 'w', 0o600);
            try {
              await fd.writeFile(JSON.stringify(ledger));
              await fd.sync();
            } finally {
              await fd.close();
            }
            if (ledger.length === (kind === 'deploy' ? 2 : 1)) await hold();
            return identifier;
          },
    lookup: async (
      /** @type {import('../../packages/service/dist/index.js').HostMutationStep} */ tx,
    ) => ledger.find((r) => r.identifier === tx.identifiers[0]),
    check: async () => true,
  };
  const host = service.createHostMutationExecutor(h, driver);
  const jobs = service.createHostMutationJobs(
    j,
    {
      ...host,
      execute:
        role === 'recover'
          ? refuse
          : async (...args) => {
              if (boundary === 'before-host') await hold();
              return host.execute(...args);
            },
    },
    { pins, completedTtlMs: 0 },
  );
  const server = service.createServer({ host: '127.0.0.1', corsOrigin: 'http://localhost:5173' }, [
    service.hostJobRoute({ jobs, pins, token: Buffer.from(token, 'hex') }),
  ]);
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  process.send?.({ type: 'ready', base: 'http://127.0.0.1:' + address.port });
  process.once('SIGTERM', async () => {
    const timeout = setTimeout(() => process.exit(2), 2000);
    try {
      jobs.stopAdmission();
      await jobs.drain();
      await new Promise((r) => {
        server.close(r);
        server.closeAllConnections();
      });
      await writeFile(join(root, 'recovery-counters.json'), JSON.stringify({ forbidden }), {
        flag: 'wx',
        mode: 0o600,
      });
      j.close();
      h.close();
      clearTimeout(timeout);
      process.disconnect?.();
    } catch {
      process.exit(2);
    }
  });
}

/** @type {Set<import('node:child_process').ChildProcess>} */ const ownedChildren = new Set();
if (role === 'suite') {
  // A wrapper deadline sends SIGTERM. Do not orphan a worker holding private journals/sockets.
  const killOwned = () => {
    for (const child of ownedChildren) child.kill('SIGKILL');
  };
  process.once('exit', killOwned);
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      if (stopping) return;
      stopping = true;
      killOwned();
      const deadline = setTimeout(() => process.exit(2), 1500);
      deadline.unref();
      Promise.all(
        [...ownedChildren].map((child) => new Promise((r) => child.once('close', r))),
      ).then(() => process.exit(2));
    });
}

/** @param {string} mode @param {string} root @param {string} arm @param {string} type @param {string} fault */
function startWorker(mode, root, arm, type, fault) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), mode, root, arm, type, fault],
    {
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  ownedChildren.add(child);
  child.once('close', () => ownedChildren.delete(child));
  let errorText = '';
  let exceeded = false;
  child.stdout?.resume();
  child.stderr?.on('data', (b) => {
    if (errorText.length < 8192) errorText += b.toString();
    else exceeded = true;
  });
  const exited = new Promise((r) => {
    child.once('error', () => r({ code: -1, signal: null }));
    child.once('close', (code, signal) => r({ code, signal }));
  });
  /** @type {Array<{type:string,base?:string}>} */ const messages = [];
  child.on('message', (message) => {
    messages.push(/** @type {{type:string,base?:string}} */ (message));
  });
  const wait = async (/** @type {string} */ type) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const m = messages.find((v) => v.type === type);
      if (m) return m;
      if (child.exitCode !== null || child.signalCode !== null || exceeded)
        throw Error('installed worker exited before ' + type + '; ' + errorText);
      await new Promise((r) => setTimeout(r, 5));
    }
    throw Error('installed worker boundary timed out');
  };
  return {
    child,
    wait,
    exited,
    async stop(/** @type {NodeJS.Signals} */ signal) {
      child.kill(signal);
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      try {
        return await exited;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

async function consentBoundary() {
  const hosted =
    /** @type {typeof import('../../packages/adapter-browser/dist/hosted-jubjub-authoriser.js')} */ (
      await load('@input-output-hk/mn-passport-adapter-browser/hosted-jubjub')
    );
  /** @typedef {import('../../packages/account/dist/ports/index.js').FlowDescriptor} Flow */
  /** @type {Flow[]} */ const sessions = [];
  let operations = 0,
    secretCalls = 0;
  const secretRefusal = async () => {
    secretCalls++;
    throw Error('consent probe must not access secret material');
  };
  /** @type {import('../../packages/adapter-browser/dist/hosted-jubjub-authoriser.js').HostedJubjubAuthoriser<string,bigint,bigint,string,Flow>} */
  const source = {
    scheme: 'jubjub-schnorr',
    devicePublicKey: secretRefusal,
    deviceCommitment: secretRefusal,
    authorise: secretRefusal,
    withKeySession: async (operation, flow) => {
      if (flow) sessions.push(structuredClone(flow));
      return operation();
    },
  };
  const convert = {
    account: (/** @type {string} */ v) => v,
    epoch: (/** @type {bigint} */ v) => v,
    counter: (/** @type {bigint} */ v) => v,
    flow: (/** @type {Flow} */ v) => structuredClone(v),
  };
  const authoriser = hosted.hostedJubjubAuthoriser(source, convert);
  /** @type {Flow} */ const descriptor = {
    kind: 'remove-device',
    account: 'ab'.repeat(32),
    commitmentHex: 'cd'.repeat(32),
    read: true,
    devices: ['ef'.repeat(32)],
  };
  assert.equal(
    await authoriser.withKeySession(async () => {
      operations++;
      return 'approved';
    }, descriptor),
    'approved',
  );
  assert.deepEqual(sessions, [descriptor]);
  const lossy = hosted.hostedJubjubAuthoriser(source, {
    ...convert,
    flow: () => ({ kind: /** @type {const} */ ('sign-in') }),
  });
  assert.throws(
    () =>
      lossy.withKeySession(async () => {
        operations++;
      }, descriptor),
    /consent descriptor changed/,
  );
  const unsupported = /** @type {const} */ ([
    'rotate-encryption-key',
    'withdraw-unshielded',
    'withdraw-shielded',
  ]);
  for (const kind of unsupported)
    assert.throws(
      () =>
        authoriser.withKeySession(
          async () => {
            operations++;
          },
          { kind },
        ),
      /no .* consent descriptor/,
    );
  assert.equal(sessions.length, 1);
  assert.equal(operations, 1);
  assert.equal(secretCalls, 0);
  return {
    kind: 'synthetic-hosted-consent',
    supportedDescriptorPreserved: true,
    lossyConversionRefused: true,
    unsupportedOwnerFlowsRefused: [...unsupported],
    noRejectedHostSessions: true,
    secretCalls: 0,
    realProvider: false,
  };
}

async function suite() {
  const root = resolve(/** @type {string} */ (directory));
  /** @type {Array<Record<string, unknown>>} */ const cases = [];
  let number = 0;
  for (const arm of ['jubjub-schnorr', 'p256-webauthn'])
    for (const type of ['call', 'deploy'])
      for (const fault of ['before-host', 'after-send']) {
        const path = join(root, String(++number));
        await mkdir(path, { mode: 0o700 });
        const identity = descriptor(arm, type, number),
          payload = input(type, arm);
        const original = startWorker('initial', path, arm, type, fault);
        let recovering;
        try {
          const ready = await original.wait('ready');
          assert.ok(ready.base);
          const client = adapter.remoteHostJobs(ready.base, {
            pins: identity.pins,
            token,
            timeoutMs: 5000,
            pollIntervalMs: 5,
          });
          const accepted = await client.accept(identity, payload);
          assert.equal(accepted.jobId, await adapter.remoteHostJobId(identity));
          await client.start(identity);
          await original.wait('boundary');
          assert.deepEqual(await original.stop('SIGKILL'), { code: null, signal: 'SIGKILL' });
          const ledgerBefore =
            fault === 'after-send' ? await readFile(join(path, 'ledger.json')) : undefined;
          recovering = startWorker('recover', path, arm, type, fault);
          const next = await recovering.wait('ready');
          assert.ok(next.base);
          const resumed = adapter.remoteHostJobs(next.base, {
            pins: identity.pins,
            token,
            timeoutMs: 5000,
            pollIntervalMs: 5,
          });
          const before = await resumed.get(identity);
          assert.equal(before?.state, 'running');
          const result = await resumed.resume(identity);
          assert.ok(result);
          assert.equal(result.state, fault === 'after-send' ? 'done' : 'unknown');
          assert.equal(result.jobId, accepted.jobId);
          if (fault === 'after-send') {
            assert.equal(result.outcome?.digest, identity.intentSha256);
            assert.equal(result.milestones.confirmedSteps, type === 'deploy' ? 2 : 1);
            assert.deepEqual(await readFile(join(path, 'ledger.json')), ledgerBefore);
          }
          // Reads, repeated original resume and conflicting reacceptance cannot execute a send.
          await resumed.get(identity);
          await resumed.resume(identity);
          const changed =
            type === 'call' ? { ...payload, tx: '02' } : { ...payload, boot: '44'.repeat(32) };
          await assert.rejects(() => resumed.accept(identity, changed), {
            code: 'MutationUnsettled',
          });
          const denied = adapter.remoteHostJobs(next.base, {
            pins: identity.pins,
            token: '44'.repeat(32),
          });
          await assert.rejects(() => denied.get(identity), { code: 'MutationUnsettled' });
          assert.equal(
            await resumed.get({ ...identity, requestId: 'ff'.repeat(16) + ':1' }),
            undefined,
          );
          assert.deepEqual(await recovering.stop('SIGTERM'), { code: 0, signal: null });
          const counters = JSON.parse(await readFile(join(path, 'recovery-counters.json'), 'utf8'));
          assert.equal(counters.forbidden, 0);
          if (ledgerBefore)
            assert.deepEqual(await readFile(join(path, 'ledger.json')), ledgerBefore);
          else await assert.rejects(() => readFile(join(path, 'ledger.json')), { code: 'ENOENT' });
          cases.push({
            arm,
            kind: type,
            boundary: fault,
            verdict: 'PASS',
            state: result.state,
            jobId: result.jobId,
            identitySha256: result.identitySha256,
            submitEntries: ledgerBefore ? JSON.parse(ledgerBefore.toString()).length : 0,
            recoveryEffectAttempts: 0,
            ledgerUnchanged: true,
            resultVisibilityTtlMs: 0,
            checks: [
              'actual-http',
              'process-sigkill',
              'original-id',
              'repeat-resume',
              'input-conflict',
              'unauthorised-refusal',
              'missing-read-only',
            ],
          });
        } finally {
          for (const owned of [original, recovering])
            if (owned && owned.child.exitCode === null && owned.child.signalCode === null)
              await owned.stop('SIGKILL');
        }
      }
  const receipt = {
    schemaVersion: 1,
    kind: 'installed-host-jobs-synthetic',
    cases,
    consent: await consentBoundary(),
    allRequiredPassed: true,
    realProvider: false,
    fullLace: false,
    nativeProof: false,
    releaseQualified: false,
  };
  await writeFile(join(root, 'cases.json'), JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
}
if (role === 'suite') await suite();
else await worker();
