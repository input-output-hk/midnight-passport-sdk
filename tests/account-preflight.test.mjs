import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectAccountConfiguration } from '../packages/account/dist/preflight.js';

const forbidden = () => {
  throw Error('a configuration inspection must not invoke a port');
};
const manifest = '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f';
/** @param {'p256-webauthn'|'jubjub-schnorr'} [scheme] */
function complete(scheme = 'p256-webauthn') {
  return {
    network: { networkId: 'undeployed', bindingId: 'acc-s3r1.1', manifestSha256: manifest },
    authoriser: {
      scheme,
      devicePublicKey: forbidden,
      devicePublicKeyHex: forbidden,
      authorise: forbidden,
      withKeySession: forbidden,
      deviceBinding: forbidden,
    },
    credentials: { identify: forbidden },
    directory: { get: forbidden, put: forbidden },
    binding: forbidden,
    chain: forbidden,
    viewingKey: {
      readerPublicKey: forbidden,
      openInbox: forbidden,
      sealGrant: forbidden,
      reencryptInbox: forbidden,
      sealView: forbidden,
      createKeys: forbidden,
      sealToDevice: forbidden,
      decodeDevicePublicKey: forbidden,
      decodeP256DevicePublicKey: forbidden,
    },
    records: { read: forbidden, write: forbidden },
    grants: { readActiveGrantIds: forbidden, readActiveGrantSnapshot: forbidden },
    grantCommitments: { readGrantCommitment: forbidden },
    grantJournal: {
      stage: forbidden,
      load: forbidden,
      markPublished: forbidden,
      pending: forbidden,
    },
    grantOrigin: 'example.test',
    holdings: { selectHeldEntries: forbidden, selectQualifiedHeldCoins: forbidden },
    readGrants: { readActiveReadGrantTargets: forbidden },
  };
}
/** @param {import('../packages/account/dist/preflight.js').AccountConfigurationReport} report */
const paths = (report) => report.issues.map((issue) => issue.path);

test('both sealed owner arms inspect all four flows without invoking even lazy loaders', () => {
  for (const scheme of /** @type {const} */ (['p256-webauthn', 'jubjub-schnorr'])) {
    for (const operation of /** @type {const} */ ([
      'withdraw-unshielded',
      'withdraw-shielded',
      'issue-grant',
      'recover-pending-grants',
    ])) {
      for (const grantRead of [false, true]) {
        const report = inspectAccountConfiguration(complete(scheme), { operation, grantRead });
        assert.equal(report.status, 'runtime-validation-required');
        assert.deepEqual(report.issues, []);
        assert.ok(report.runtimeChecks.length >= 5);
        assert.ok(
          Object.isFrozen(report) &&
            Object.isFrozen(report.issues) &&
            Object.isFrozen(report.runtimeChecks),
        );
      }
    }
  }
});

test('missing, malformed or unsupported owner configuration returns public actionable paths', () => {
  const report = inspectAccountConfiguration({}, { operation: 'withdraw-unshielded' });
  assert.equal(report.status, 'configuration-incomplete');
  assert.ok(paths(report).includes('authoriser.withKeySession'));
  assert.ok(paths(report).includes('viewingKey.openInbox'));
  assert.ok(paths(report).includes('chain.call'));
  for (const network of [
    { bindingId: 'legacy', manifestSha256: manifest },
    { bindingId: 'acc-s3r1.1', manifestSha256: '0'.repeat(64) },
  ]) {
    const result = inspectAccountConfiguration(
      { ...complete(), network },
      { operation: 'withdraw-unshielded' },
    );
    assert.equal(result.status, 'configuration-incomplete');
  }
  const unsupported = inspectAccountConfiguration(
    { ...complete(), authoriser: { scheme: 'k256-ecdsa' } },
    { operation: 'withdraw-unshielded' },
  );
  assert.ok(paths(unsupported).includes('authoriser.scheme'));
  assert.ok(Object.isFrozen(report.issues[0]));
});

test('grant issue demands explicit read intent and durable authenticated publication ports', () => {
  const base = complete();
  const omitted = inspectAccountConfiguration(base, { operation: 'issue-grant' });
  assert.ok(paths(omitted).includes('grantRead'));
  const result = inspectAccountConfiguration(
    { ...base, grantJournal: {}, grantCommitments: {}, grantOrigin: '' },
    { operation: 'issue-grant', grantRead: false },
  );
  assert.ok(paths(result).includes('grantJournal.stage'));
  assert.ok(paths(result).includes('grantJournal.markPublished'));
  assert.ok(paths(result).includes('grantCommitments.readGrantCommitment'));
  assert.ok(paths(result).includes('grantOrigin'));
});

test('read-grant inspection detects missing chain-backed holdings, delivery and roster methods', () => {
  const base = { ...complete(), holdings: {}, readGrants: {}, viewingKey: {} };
  const result = inspectAccountConfiguration(base, { operation: 'issue-grant', grantRead: true });
  for (const path of [
    'holdings.selectHeldEntries',
    'readGrants.readActiveReadGrantTargets',
    'viewingKey.reencryptInbox',
    'viewingKey.sealView',
    'viewingKey.decodeDevicePublicKey',
    'viewingKey.decodeP256DevicePublicKey',
  ])
    assert.ok(paths(result).includes(path), path);
});

test('ordinary publication journal does not imply pending enumeration and recovery', () => {
  const base = complete();
  const { pending: _, ...journal } = base.grantJournal;
  assert.ok(
    paths(
      inspectAccountConfiguration(
        { ...base, grantJournal: journal },
        { operation: 'recover-pending-grants' },
      ),
    ).includes('grantJournal.pending'),
  );
});

test('fee sponsor cannot replace qualified shielded holdings or a value-bearing sender', () => {
  const result = inspectAccountConfiguration(
    { ...complete(), holdings: {}, sponsor: { balanceAndSign: forbidden } },
    { operation: 'withdraw-shielded' },
  );
  assert.ok(paths(result).includes('holdings.selectQualifiedHeldCoins'));
  assert.ok(result.runtimeChecks.some((check) => check.includes('exact-value')));
  assert.ok(
    result.runtimeChecks.some((check) =>
      check.includes('separately qualified value-bearing wallet'),
    ),
  );
});

test('class methods are supported; accessors and reflected exception diagnostics never execute/leak', () => {
  class Chain {
    call() {
      forbidden();
    }
    readAccount() {
      forbidden();
    }
  }
  const base = complete();
  assert.equal(
    inspectAccountConfiguration(
      { ...base, chain: new Chain() },
      { operation: 'withdraw-unshielded' },
    ).status,
    'runtime-validation-required',
  );
  let reads = 0;
  const getter = {
    get chain() {
      reads++;
      throw Error('private diagnostic');
    },
  };
  const report = inspectAccountConfiguration(
    { ...base, chain: getter },
    { operation: 'withdraw-unshielded' },
  );
  assert.ok(paths(report).includes('chain.call'));
  const input = Object.create(base, {
    chain: {
      get() {
        reads++;
        throw Error('private diagnostic');
      },
    },
  });
  const result = inspectAccountConfiguration(input, { operation: 'withdraw-unshielded' });
  assert.equal(reads, 0);
  assert.ok(paths(result).includes('chain.call'));
  assert.equal(JSON.stringify(result).includes('private diagnostic'), false);
});
