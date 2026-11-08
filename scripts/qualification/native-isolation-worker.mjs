// Read-only worker admission. Parent admission owns fresh roots, frozen references and stack IDs.
import assert from 'node:assert/strict';
import {
  constants,
  lstatSync,
  realpathSync,
  openSync,
  fstatSync,
  readSync,
  closeSync,
} from 'node:fs';
import { isAbsolute, normalize, join, relative, sep } from 'node:path';
import {
  ISOLATED_KIND,
  admitIsolationProfile,
  isolationDigest,
  isolationEnvironment,
  assertIsolationOverrides,
} from './native-isolation-profile.mjs';

/** @typedef {'live'|'wallet-transfer'|'wallet-reconnect'} WorkerKind */
/** @typedef {{kind:WorkerKind,root:string|undefined,arm:string|undefined,mode?:string|undefined,operation?:string|undefined,fault?:string|undefined,env?:NodeJS.ProcessEnv}} WorkerAdmission */
const MARKER_PREFIX = 'PASSPORT_NATIVE_ISOLATION';
const DESCRIPTOR_LIMIT = 4096;
/** @param {unknown} value */
function absolutePath(value) {
  assert.ok(
    typeof value === 'string' && isAbsolute(value) && normalize(value) === value && value !== '/',
    'Expected a normalized absolute worker path.',
  );
  return value;
}
/** Stat only: private fixture contents are never read by the admission boundary.
 * @param {string} path @param {boolean} directory @param {boolean} [optional]
 */
function ownedPath(path, directory, optional = false) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) {
    assert.ok(optional, 'Required owned worker input is absent.');
    return undefined;
  }
  assert.ok(
    !stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()),
    'Worker input must be a real owned path.',
  );
  assert.equal(stat.mode & 0o077, 0, 'Worker inputs must remain private.');
  if (process.getuid)
    assert.equal(stat.uid, process.getuid(), 'Worker input has a different owner.');
  if (!directory)
    assert.equal(stat.nlink, 1, 'Worker files cannot alias another retained fixture.');
  return stat;
}
/** @param {string} path @param {boolean} [optional] */
function fixtureFile(path, optional = false) {
  const stat = ownedPath(path, false, optional);
  if (stat) assert.ok(stat.size < 65536, 'Owned fixture exceeds its admission bound.');
  return stat;
}
/** @param {NodeJS.ProcessEnv} env */
function readDescriptor(env) {
  assert.equal(
    env.PASSPORT_NATIVE_ISOLATION,
    ISOLATED_KIND,
    'Unknown or partial isolated worker mode.',
  );
  const output = absolutePath(env.PASSPORT_LIVE_ROOT),
    file = absolutePath(env.PASSPORT_NATIVE_ISOLATION_FILE);
  assert.equal(
    file,
    join(output, 'isolation.json'),
    'Descriptor must belong to the declared output root.',
  );
  ownedPath(output, true);
  assert.equal(realpathSync(output), output, 'Descriptor root cannot traverse aliases.');
  const before = ownedPath(file, false);
  assert.ok(before);
  assert.equal(before.mode & 0o777, 0o600, 'Descriptor must retain its admitted private mode.');
  assert.ok(
    before.size > 0 && before.size <= DESCRIPTOR_LIMIT,
    'Descriptor exceeds its byte admission bound.',
  );
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = fstatSync(fd);
    assert.equal(current.dev, before.dev);
    assert.equal(current.ino, before.ino);
    assert.equal(current.size, before.size);
    const bytes = Buffer.alloc(DESCRIPTOR_LIMIT + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    assert.ok(
      size <= DESCRIPTOR_LIMIT && size === before.size,
      'Descriptor changed or exceeded its byte bound.',
    );
    const profile = admitIsolationProfile(JSON.parse(bytes.subarray(0, size).toString('utf8')));
    assert.equal(profile.outputRoot, output);
    assert.equal(
      isolationDigest(profile),
      env.PASSPORT_NATIVE_ISOLATION_SHA256,
      'Descriptor digest differs.',
    );
    return profile;
  } finally {
    closeSync(fd);
  }
}
/** @param {import('./native-isolation-profile.mjs').IsolationProfile} profile @param {NodeJS.ProcessEnv} env */
function workerEnvironment(profile, env) {
  assertIsolationOverrides(env);
  const expected = isolationEnvironment(profile);
  for (const [name, value] of Object.entries(expected))
    assert.equal(env[name], value, `Isolated worker environment differs: ${name}`);
  for (const [name, value] of Object.entries(env))
    if (value !== undefined && name.startsWith(MARKER_PREFIX))
      assert.ok(Object.hasOwn(expected, name), 'Unknown isolation marker.');
  assert.equal(env.PASSPORT_RC_LOCALNET, '1');
  assert.equal(env.MN_NETWORK_ID, 'undeployed');
  assert.equal(env.MIDNIGHT_NETWORK, 'local');
  assert.equal(env.PASSPORT_LIVE_HOST_JOBS, '1');
  assert.equal(env.PASSPORT_LIVE_PROFILE, 'lifecycle');
  const contract = absolutePath(env.PASSPORT_CONTRACT_DIR);
  assert.equal(
    lstatSync(contract).isSymbolicLink(),
    false,
    'Reference root cannot be substituted by a link.',
  );
  assert.ok(lstatSync(contract).isDirectory(), 'Expected the parent-pinned reference directory.');
}
/** Every existing descendant is private and canonical; this never creates the missing tail.
 * @param {string} output @param {string} root
 */
function workerDirectories(output, root) {
  let path = output;
  for (const part of relative(output, root).split(sep)) {
    path = join(path, part);
    const stat = ownedPath(path, true, true);
    if (!stat) break;
    assert.equal(realpathSync(path), path, 'Worker root cannot traverse aliases.');
  }
}
/** @param {WorkerAdmission} request @param {string} root @param {string} ownerRoot @param {NodeJS.ProcessEnv} env */
function workerFixtures(request, root, ownerRoot, env) {
  assert.equal(
    env.PASSPORT_REGISTRY_FILE,
    join(root, 'registry.json'),
    'Worker registry differs from its root.',
  );
  fixtureFile(join(root, 'registry.json'), true);
  if (request.kind === 'live') {
    assert.equal(
      env.PASSPORT_WALLET_OWNER_FIXTURE,
      undefined,
      'Live workers cannot borrow wallet identity overrides.',
    );
    const fixture = fixtureFile(join(root, 'fixture.json'), request.mode === 'prepare');
    if (request.mode === 'prepare')
      assert.equal(fixture, undefined, 'Do not replace a retained owner fixture.');
    return;
  }
  const ownerFixture = join(ownerRoot, 'fixture.json');
  fixtureFile(ownerFixture);
  if (request.kind === 'wallet-reconnect') {
    assert.equal(
      env.PASSPORT_WALLET_OWNER_FIXTURE,
      ownerFixture,
      'Reconnect must use its sibling owner fixture.',
    );
    assert.equal(
      lstatSync(join(root, 'wallet-fixture.json'), { throwIfNoEntry: false }),
      undefined,
      'Do not replace a retained wallet identity.',
    );
  } else {
    assert.equal(
      env.PASSPORT_WALLET_OWNER_FIXTURE,
      undefined,
      'Payer cannot borrow an owner identity override.',
    );
    fixtureFile(join(root, 'wallet-ready.json'));
    assert.equal(
      lstatSync(join(root, 'wallet-transfer.json'), { throwIfNoEntry: false }),
      undefined,
      'Preserve uncertain original prepared bytes.',
    );
  }
}
/** Returns undefined only when every isolation marker is absent, preserving legacy guards.
 * Any partial/invalid mode refuses before a caller may mkdir, load backend or touch fixtures.
 * @param {WorkerAdmission} request
 * @returns {import('./native-isolation-profile.mjs').IsolationProfile|undefined}
 */
export function nativeIsolationWorker(request) {
  const env = request.env ?? process.env;
  if (
    !Object.entries(env).some(
      ([name, value]) => name.startsWith(MARKER_PREFIX) && value !== undefined,
    )
  )
    return undefined;
  assertIsolationOverrides(env);
  const profile = readDescriptor(env);
  workerEnvironment(profile, env);
  assert.ok(request.arm === 'p256' || request.arm === 'jubjub', 'Unknown worker identity arm.');
  assert.ok(
    ['live', 'wallet-transfer', 'wallet-reconnect'].includes(request.kind),
    'Unknown isolated worker kind.',
  );
  if (request.kind === 'live') {
    assert.ok(
      ['host', 'owner', 'resume', 'probe', 'inspect', 'populate', 'prepare'].includes(
        request.mode ?? '',
      ),
      'Unknown isolated live worker mode.',
    );
    assert.ok(
      [
        'create',
        'populate',
        'add-survivor',
        'add-target',
        'remove-target',
        'survivor-rotate',
        'verify-removed',
      ].includes(request.operation ?? ''),
      'Isolated mode supports the source lifecycle only.',
    );
    assert.ok(
      request.fault === 'none' ||
        request.fault === `circuit:add_device_with_${request.arm}:after-submit` ||
        request.fault === `circuit:rotate_enc_key_with_${request.arm}:after-submit`,
      'Unsupported isolated source fault.',
    );
  }
  if (request.kind !== 'live')
    assert.equal(
      request.mode,
      request.kind === 'wallet-transfer' ? 'wallet-producer' : 'wallet-observer',
      'Unknown isolated wallet mode.',
    );
  const root = absolutePath(request.root),
    ownerRoot = join(profile.outputRoot, request.arm);
  assert.equal(
    root,
    request.kind === 'live' ? ownerRoot : join(ownerRoot, 'wallet'),
    'Worker root differs from the admitted identity.',
  );
  workerDirectories(profile.outputRoot, root);
  workerFixtures(request, root, ownerRoot, env);
  return profile;
}
