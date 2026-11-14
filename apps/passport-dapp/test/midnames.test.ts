import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PassportNameError,
  resolvePassportName,
  type PassportNameErrorCode,
} from '@input-output-hk/mn-passport-account/names';
import { configureMidnames } from '../src/midnames/config.js';
import {
  createMidnamesNameService,
  requireKnownMidnamesMapping,
  type MidnamesReads,
} from '../src/midnames/resolver.js';

const profile = {
  networkId: 'undeployed',
  namespace: 'passport.night',
  registryAddress: '11'.repeat(32),
};
const query = { name: 'alice.passport.night', networkId: 'undeployed' };
const account = '22'.repeat(32);
const repointed = '33'.repeat(32);
const code = (expected: PassportNameErrorCode) => (error: unknown) =>
  error instanceof PassportNameError && error.code === expected;
const reads = (target: MidnamesReads['readTarget']): MidnamesReads => ({
  readTarget: target,
  isSupportedAccount: async (address, network) =>
    [account, repointed].includes(address) && network === profile.networkId,
});

test('resolves the currently observed contract target for the captured registry and network', async () => {
  let address = account;
  const mutableProfile = { ...profile };
  const adapter = createMidnamesNameService(
    mutableProfile,
    reads(async (name, scope) => {
      assert.equal(name, query.name);
      assert.deepEqual(scope, profile);
      return { kind: 'contract', address };
    }),
  );
  mutableProfile.registryAddress = repointed;
  assert.equal((await resolvePassportName(adapter, query))?.accountAddress, account);
  address = repointed;
  assert.equal((await resolvePassportName(adapter, query))?.accountAddress, repointed);
});

test('absence, invalid targets, invalid query and provider failure are distinct', async () => {
  const absent = createMidnamesNameService(
    profile,
    reads(async () => undefined),
  );
  assert.equal(await resolvePassportName(absent, query), undefined);
  for (const target of [
    { kind: 'other', address: account },
    { kind: 'contract', address: 'mn_addr_undeployed1wallet' },
    { kind: 'contract', address: '44'.repeat(32) },
  ] as const) {
    const adapter = createMidnamesNameService(
      profile,
      reads(async () => target),
    );
    await assert.rejects(resolvePassportName(adapter, query), code('InvalidRecord'));
  }
  const offline = createMidnamesNameService(
    profile,
    reads(async () => {
      throw new Error('private provider details');
    }),
  );
  await assert.rejects(resolvePassportName(offline, query), code('Unavailable'));
  for (const name of [
    'alice.night',
    'Alice.passport.night',
    'alice..passport.night',
    'alice.passport.night\n',
  ])
    await assert.rejects(resolvePassportName(offline, { ...query, name }), code('InvalidQuery'));
  await assert.rejects(
    resolvePassportName(offline, { ...query, networkId: 'preview' }),
    code('InvalidQuery'),
  );
});

test('configured name lookup requires an explicit matching network, registry and public indexer endpoints', () => {
  assert.equal(configureMidnames({}, profile.networkId, 'acc-s3r1.1'), undefined);
  const config = {
    ...profile,
    indexerUrl: 'http://127.0.0.1:18108/api/v4/graphql',
    indexerWsUrl: 'ws://127.0.0.1:18108/api/v4/graphql/ws',
  };
  assert.equal(
    configureMidnames(config, profile.networkId, 'acc-s3r1.1')?.provider.mode,
    'external',
  );
  assert.ok(
    configureMidnames(
      { ...config, registryProfile: 'standalone-0.35' },
      profile.networkId,
      'acc-s3r1.1',
    ),
  );
  assert.throws(() =>
    configureMidnames(
      { ...config, networkId: 'preview', registryProfile: 'standalone-0.35' },
      'preview',
      'acc-s3r1.1',
    ),
  );
  for (const change of [
    { registryProfile: 'unknown' },
    { registryAddress: undefined },
    { namespace: undefined },
    { networkId: 'preview' },
    { indexerUrl: 'http://example.test/graphql' },
    { indexerUrl: 'https://user:password@example.test/graphql' },
    { indexerWsUrl: 'wss://example.test/graphql?token=secret' },
  ])
    assert.throws(() =>
      configureMidnames({ ...config, ...change }, profile.networkId, 'acc-s3r1.1'),
    );
});

test('an online profile requires a complete known name-to-ACC pin before lookup', () => {
  const config = {
    ...profile,
    networkId: 'preview',
    indexerUrl: 'https://indexer.preview.midnight.network/api/v4/graphql',
    indexerWsUrl: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
  };
  for (const missing of [{}, { knownName: query.name }, { knownAccountAddress: account }])
    assert.throws(() => configureMidnames({ ...config, ...missing }, 'preview', 'acc-s3r1.1'));
  assert.equal(
    configureMidnames(
      { ...config, knownName: query.name, knownAccountAddress: account },
      'preview',
      'acc-s3r1.1',
    )?.provider.mode,
    'external',
  );
  for (const invalid of [
    { knownName: 'Alice.passport.night', knownAccountAddress: account },
    { knownName: query.name, knownAccountAddress: 'mn_wallet' },
  ])
    assert.throws(() => configureMidnames({ ...config, ...invalid }, 'preview', 'acc-s3r1.1'));
});

test('online known mapping is checked fresh and never turns absence or outage into another destination', async () => {
  const scope = { ...profile, networkId: 'preview' };
  const known = { name: query.name, networkId: scope.networkId };
  const other = { name: 'bob.passport.night', networkId: scope.networkId };
  let knownTarget: string | undefined = account;
  let unavailable = false;
  const calls: string[] = [];
  const service = requireKnownMidnamesMapping(
    createMidnamesNameService(scope, {
      async readTarget(name, observed) {
        assert.deepEqual(observed, scope);
        calls.push(name);
        if (unavailable) throw new Error('private provider detail');
        if (name === known.name)
          return knownTarget ? { kind: 'contract', address: knownTarget } : undefined;
        return { kind: 'contract', address: repointed };
      },
      async isSupportedAccount(address, network) {
        return network === scope.networkId && [account, repointed].includes(address);
      },
    }),
    scope.networkId,
    known.name,
    account,
  );
  assert.equal((await resolvePassportName(service, other))?.accountAddress, repointed);
  assert.deepEqual(calls, [known.name, other.name]);
  calls.length = 0;
  knownTarget = repointed;
  await assert.rejects(resolvePassportName(service, other), code('InvalidRecord'));
  assert.deepEqual(calls, [known.name]);
  knownTarget = undefined;
  await assert.rejects(resolvePassportName(service, other), code('InvalidRecord'));
  knownTarget = account;
  unavailable = true;
  await assert.rejects(resolvePassportName(service, other), code('Unavailable'));
  unavailable = false;
  await assert.rejects(
    resolvePassportName(service, { ...other, networkId: 'preprod' }),
    code('InvalidQuery'),
  );
  assert.equal((await resolvePassportName(service, known))?.accountAddress, account);
});
