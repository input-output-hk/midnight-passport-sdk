import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  isolationArtifactInventory,
  verifyIsolationArtifacts,
} from '../scripts/qualification/native-isolation-artifacts.mjs';
import { observeNativeCompletion } from '../scripts/qualification/native-worker-completion.mjs';
import { isolatedProcesses } from '../scripts/qualification/native-isolation-control.mjs';
import { isolationProfile } from '../scripts/qualification/native-isolation-profile.mjs';
import { assertNativeContainer } from '../scripts/qualification/native-container-shape.mjs';
import { containerFixture } from './fixtures/overnight-native-isolation.mjs';

/** Only tiny newly owned synthetic files; no reference cache or private fixture is read.
 * @param {string} root */
function syntheticArtifacts(root) {
  /** @type {Record<string,Record<string,{sha256:string}>>} */ const circuits = {};
  for (const circuit of ['native_test_one', 'native_test_two']) {
    /** @type {Record<string,{sha256:string}>} */ const pins = {};
    for (const kind of ['zkir', 'bzkir', 'prover', 'verifier']) {
      const bytes = `synthetic ${circuit} ${kind}`;
      const directory = kind === 'zkir' || kind === 'bzkir' ? 'zkir' : 'keys';
      const path = join(root, `contracts/managed/account/${directory}/${circuit}.${kind}`);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, bytes, { mode: 0o600 });
      pins[kind] = { sha256: createHash('sha256').update(bytes).digest('hex') };
    }
    circuits[circuit] = pins;
  }
  return { circuits };
}
test('public manifest inventory includes every declared binary ZKIR alongside all other artifact pins', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL('../packages/contract/resources/acc-s3r1.1.key-manifest.json', import.meta.url),
      'utf8',
    ),
  );
  const inventory = isolationArtifactInventory(manifest);
  assert.equal(inventory.length, Object.keys(manifest.circuits).length * 4);
  for (const circuit of Object.keys(manifest.circuits))
    for (const kind of ['zkir', 'bzkir', 'prover', 'verifier']) {
      const artifact = inventory.find((entry) => entry.path.endsWith(`/${circuit}.${kind}`));
      assert.ok(artifact);
      assert.equal(artifact.sha256, manifest.circuits[circuit][kind].sha256);
      assert.ok(artifact.path.includes(kind === 'zkir' || kind === 'bzkir' ? '/zkir/' : '/keys/'));
    }
  assert.ok(Object.isFrozen(inventory) && inventory.every(Object.isFrozen));
});
test('actual initial/final artifact verifier detects changed or missing bzkir and each other pinned kind', async () => {
  const root = mkdtempSync(join(tmpdir(), 'passport-artifact-drift-'));
  try {
    const manifest = syntheticArtifacts(root),
      inventory = isolationArtifactInventory(manifest);
    let guarded = 0;
    const check = () => {
      guarded++;
    };
    await verifyIsolationArtifacts(root, inventory, check);
    assert.ok(guarded >= inventory.length);
    const first = manifest.circuits.native_test_one;
    assert.ok(first);
    const binaryPin = first.bzkir;
    assert.ok(binaryPin);
    binaryPin.sha256 = 'f'.repeat(64);
    await verifyIsolationArtifacts(root, inventory, check); // Caller mutation cannot change the captured pins.
    for (const kind of ['zkir', 'bzkir', 'prover', 'verifier']) {
      const artifact = inventory.find((entry) => entry.path.endsWith(`/native_test_one.${kind}`));
      assert.ok(artifact);
      const path = join(root, artifact.path),
        original = readFileSync(path);
      writeFileSync(path, 'changed synthetic bytes');
      await assert.rejects(
        verifyIsolationArtifacts(root, inventory, check),
        /Pinned native artifact mismatch/,
      );
      writeFileSync(path, original);
      await verifyIsolationArtifacts(root, inventory, check);
    }
    const binary = inventory.find((entry) => entry.path.endsWith('.bzkir'));
    assert.ok(binary);
    unlinkSync(join(root, binary.path));
    await assert.rejects(verifyIsolationArtifacts(root, inventory, check), { code: 'ENOENT' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('artifact admission refuses missing binary pins, malformed hashes and escaping circuit names', () => {
  const valid = {
    zkir: { sha256: 'a'.repeat(64) },
    bzkir: { sha256: 'b'.repeat(64) },
    prover: { sha256: 'c'.repeat(64) },
    verifier: { sha256: 'd'.repeat(64) },
  };
  assert.throws(() => isolationArtifactInventory({ circuits: {} }));
  assert.throws(() =>
    isolationArtifactInventory({
      circuits: { test: { zkir: valid.zkir, prover: valid.prover, verifier: valid.verifier } },
    }),
  );
  assert.throws(() =>
    isolationArtifactInventory({
      circuits: { test: { ...valid, bzkir: { sha256: 'not-a-digest' } } },
    }),
  );
  assert.throws(() => isolationArtifactInventory({ circuits: { '../retained': valid } }));
});
test('actual created-container admission accepts empty network ID only while stopped in its owned network', () => {
  const profile = isolationProfile('123456789abcdef0', '/private/owned-synthetic-output');
  /** @type {import('../scripts/qualification/native-isolated-stack.mjs').OwnedContainer} */
  const owned = { service: 'node', image: 'sha256:' + '1'.repeat(64), id: '2'.repeat(64) };
  /** @type {Array<[boolean,string,boolean]>} */ const cases = [
    [false, '', true],
    [false, '9'.repeat(64), true],
    [false, 'a'.repeat(64), false],
    [true, '', false],
    [true, '9'.repeat(64), true],
    [true, 'a'.repeat(64), false],
  ];
  for (const [running, id, accepted] of cases) {
    const current = containerFixture(profile, owned, running),
      network = current.NetworkSettings.Networks[profile.project];
    assert.ok(network);
    network.NetworkID = id;
    const admit = () =>
      assertNativeContainer(current, {
        ...owned,
        project: profile.project,
        labelPrefix: 'passport.native',
        port: 19964,
        running,
        strictEnvironment: true,
        networkId: '9'.repeat(64),
      });
    if (accepted) assert.equal(admit(), owned.id);
    else assert.throws(admit);
  }
  const current = containerFixture(profile, owned, false),
    network = current.NetworkSettings.Networks[profile.project];
  assert.ok(network);
  network.NetworkID = '';
  current.HostConfig.NetworkMode = 'mn-passport-qual-20261023_midnight';
  assert.throws(() =>
    assertNativeContainer(current, {
      ...owned,
      project: profile.project,
      labelPrefix: 'passport.native',
      port: 19964,
      running: false,
      strictEnvironment: true,
      networkId: '9'.repeat(64),
    }),
  );
});
test(
  'early private-log I/O failure is handled before consumption, remains rejected and reaches owned cleanup',
  { timeout: 10000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'passport-worker-log-failure-')),
      blocker = join(root, 'not-a-directory');
    writeFileSync(blocker, 'synthetic');
    const processes = isolatedProcesses(),
      child = spawn(process.execPath, ['-e', 'process.stdout.write("synthetic");'], {
        detached: true,
        stdio: 'ignore',
      }),
      companion = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
        detached: true,
        stdio: 'ignore',
      });
    processes.register(child);
    processes.register(companion);
    /** @type {unknown[]} */ const unhandled = [];
    const onUnhandled = (/** @type {unknown} */ error) => {
      unhandled.push(error);
    };
    process.on('unhandledRejection', onUnhandled);
    /** @type {()=>void} */ let markWriteFailure = () => {};
    /** @type {Promise<void>} */ const writeFailed = new Promise((resolve) => {
      markWriteFailure = resolve;
    });
    const done = observeNativeCompletion(child, async (code, signal) => {
      try {
        await writeFile(join(blocker, 'worker.private.log'), 'synthetic log', { mode: 0o600 });
      } catch (error) {
        markWriteFailure();
        throw error;
      }
      return { code, signal };
    });
    let cleaned = false;
    try {
      await writeFailed;
      await delay(25); // The consumer has not attached a failure handler yet.
      assert.deepEqual(unhandled, []);
      try {
        await assert.rejects(done, { code: 'ENOTDIR' });
      } finally {
        const cleanup = await processes.stop(2000);
        assert.equal(cleanup.incomplete, false);
        assert.equal(cleanup.owned, 2);
        cleaned = true;
      }
      assert.equal(cleaned, true);
      assert.deepEqual(unhandled, []);
    } finally {
      await processes.stop(2000);
      process.removeListener('unhandledRejection', onUnhandled);
      rmSync(root, { recursive: true, force: true });
    }
  },
);
test(
  'early spawn failure and synchronous completion failure keep their original rejecting promises',
  { timeout: 10000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'passport-worker-spawn-failure-'));
    /** @type {unknown[]} */ const unhandled = [];
    const observe = (/** @type {unknown} */ error) => {
      unhandled.push(error);
    };
    process.on('unhandledRejection', observe);
    const processes = isolatedProcesses();
    try {
      const failed = spawn(join(root, 'absent-executable'), [], {
        detached: true,
        stdio: 'ignore',
      });
      processes.register(failed);
      const spawnDone = observeNativeCompletion(failed, () => ({ closed: true }));
      await new Promise((resolve) => failed.once('close', resolve));
      await delay(25);
      assert.deepEqual(unhandled, []);
      await assert.rejects(spawnDone, { code: 'ENOENT' });
      const child = spawn(process.execPath, ['-e', ''], { detached: true, stdio: 'ignore' });
      processes.register(child);
      const failure = new Error('synthetic synchronous completion failure'),
        done = observeNativeCompletion(child, () => {
          throw failure;
        });
      await new Promise((resolve) => child.once('close', resolve));
      await delay(25);
      assert.deepEqual(unhandled, []);
      await assert.rejects(done, (error) => error === failure);
    } finally {
      assert.equal((await processes.stop(2000)).incomplete, false);
      process.removeListener('unhandledRejection', observe);
      rmSync(root, { recursive: true, force: true });
    }
  },
);
test(
  'successful owned completion still waits for the private-log write and returns the result',
  { timeout: 10000 },
  async () => {
    const child = spawn(process.execPath, ['-e', ''], { detached: true, stdio: 'ignore' }),
      processes = isolatedProcesses();
    processes.register(child);
    let written = false;
    const done = observeNativeCompletion(child, async (code, signal) => {
      await delay(5);
      written = true;
      return { code, signal };
    });
    try {
      assert.deepEqual(await done, { code: 0, signal: null });
      assert.equal(written, true);
    } finally {
      assert.equal((await processes.stop(2000)).incomplete, false);
    }
  },
);
