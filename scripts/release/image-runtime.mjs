// Actual production-image startup refusals, owned by the same durable resource journal.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { object, put, sha256 } from './files.mjs';

/** @typedef {ReturnType<import('./images.mjs').verifyImage>} PulledImage */
/** @param {import('./resources.mjs').ResourceOwner} owner @param {PulledImage} image @param {string} name @param {string[]} args @param {string[]} [command] @param {string} [input] @param {string} [expected] @param {string} [root] */
export function imageCase(owner, image, name, args, command = [], input, expected, root) {
  const row = owner.create(
    'container',
    `passport-${owner.runId}-${name}`,
    [
      '--platform',
      'linux/amd64',
      '--network',
      'none',
      '--read-only',
      '--tmpfs',
      '/tmp:mode=1777',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      ...args,
      ...(input !== undefined ? ['-i'] : []),
      image.id,
      ...command,
    ],
    image.id,
  );
  const result = owner.start(row, { attach: true, input });
  const bytes = Buffer.from(result.stdout + result.stderr);
  if (root) put(join(root, `${name}.private.log`), bytes);
  const state = object(owner.inspect(row).State);
  assert.equal(state.Running, false);
  assert.equal(state.Status, 'exited');
  assert.equal(
    result.status,
    state.ExitCode,
    'Docker transport exit differs from application exit',
  );
  if (expected) {
    assert.notEqual(state.ExitCode, 0);
    assert.ok(bytes.includes(expected), 'Wrong startup refusal');
  } else assert.equal(state.ExitCode, 0);
  owner.stop(row);
  return {
    name,
    imageDigest: image.digest,
    outcome: 'passed',
    logSha256: sha256(bytes),
    expected: expected ?? 'exit0',
  };
}
/** @param {string} repository @param {string} root @param {import('./resources.mjs').ResourceOwner} owner @param {PulledImage[]} images */
export function backendSmoke(repository, root, owner, images) {
  const dummy = join(root, 'dummy-contract');
  mkdirSync(join(dummy, 'contracts/managed/account/contract'), { recursive: true, mode: 0o755 });
  mkdirSync(join(dummy, 'node_modules'), { mode: 0o755 });
  // These are deliberately synthetic, public test inputs, readable by the non-root container.
  put(join(dummy, 'contracts/managed/account/contract/index.js'), '');
  chmodSync(join(dummy, 'contracts/managed/account/contract/index.js'), 0o644);
  const synthetic = join(root, 'synthetic-config');
  mkdirSync(synthetic, { mode: 0o755 });
  for (const [file, value] of [
    ['seed', '0'.repeat(63) + '1\n'],
    ['token', '0'.repeat(31) + '1\n'],
  ]) {
    assert.ok(file && value);
    put(join(synthetic, file), value);
    chmodSync(join(synthetic, file), 0o644);
  }
  const mount = ['--mount', `type=bind,src=${dummy},dst=/data/contract,readonly`];
  const cases = [];
  for (const image of images.filter((row) => row.role !== 'keys')) {
    const prefix = image.role;
    cases.push(
      imageCase(
        owner,
        image,
        `${prefix}-content`,
        ['--entrypoint', 'node'],
        ['--input-type=module', '-', '/opt/passport'],
        readFileSync(join(repository, 'scripts/check-runtime-image.mjs'), 'utf8'),
        undefined,
        root,
      ),
    );
    cases.push(
      imageCase(
        owner,
        image,
        `${prefix}-node`,
        ['--entrypoint', 'node'],
        ['--version'],
        undefined,
        undefined,
        root,
      ),
    );
    cases.push(
      imageCase(
        owner,
        image,
        `${prefix}-missing-export`,
        [],
        [],
        undefined,
        'mount a Linux-prepared pinned ACC export',
        root,
      ),
    );
    cases.push(
      imageCase(
        owner,
        image,
        `${prefix}-missing-seed`,
        [
          ...mount,
          '-e',
          'MN_NETWORK_ID=testnet',
          ...(prefix === 'service' ? ['-e', 'PASSPORT_MANIFEST_SHA256=' + 'ab'.repeat(32)] : []),
        ],
        [],
        undefined,
        prefix === 'service'
          ? 'set PASSPORT_SPONSOR_SEED_FILE or PASSPORT_SPONSOR_SEED'
          : 'set PASSPORT_FUNDING_SEED_FILE',
        root,
      ),
    );
    if (prefix === 'service')
      cases.push(
        imageCase(
          owner,
          image,
          'service-bad-manifest',
          [
            ...mount,
            '-e',
            'MN_NETWORK_ID=undeployed',
            '-e',
            'PASSPORT_MANIFEST_SHA256=' + 'ab'.repeat(32),
          ],
          [],
          undefined,
          'binding or manifest differs from the package pin',
          root,
        ),
      );
    else
      cases.push(
        imageCase(
          owner,
          image,
          'funding-missing-policy',
          [
            ...mount,
            '--mount',
            `type=bind,src=${synthetic},dst=/run/passport-secrets,readonly`,
            '-e',
            'MN_NETWORK_ID=testnet',
            '-e',
            'PASSPORT_FUNDING_SEED_FILE=/run/passport-secrets/seed',
            '-e',
            'PASSPORT_FUNDING_TOKEN_FILE=/run/passport-secrets/token',
            '-e',
            'PASSPORT_FUNDING_DEPLOYMENTS_FILE=/run/passport-secrets/deployments.json',
          ],
          [],
          undefined,
          'set PASSPORT_FUNDING_ASSETS_FILE',
          root,
        ),
      );
  }
  assert.equal(cases.length, 10);
  return cases;
}
