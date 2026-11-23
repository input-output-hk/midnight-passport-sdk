import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PassportNameError,
  resolvePassportContractCallName,
  resolvePassportName,
  type PassportNameErrorCode,
} from '@input-output-hk/mn-passport-account/names';
import { configureMidnames, configuredNameService } from '../src/midnames/config.js';
import type { MidnamesIndexerBlock } from '../src/midnames/chain-finality.js';
import type { CandidateAccountQualification } from '../src/midnames/ledger-reader.js';
import {
  createMidnamesNameService,
  requireAgreeingMidnamesResolvers,
  requireKnownMidnamesMapping,
  requireMatchingFinalizedIndexerBlock,
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

test('contract-call context admits only a verified contract target', async () => {
  const calls: string[] = [];
  const adapter = createMidnamesNameService(profile, {
    async readTarget(name) {
      assert.equal(name, query.name);
      calls.push('contract-target');
      return { kind: 'contract', address: account };
    },
    async isSupportedAccount(address) {
      assert.equal(address, account);
      calls.push('binding');
      return true;
    },
  });
  const result = await resolvePassportContractCallName(adapter, query);
  assert.equal(result?.accountAddress, account);
  assert.deepEqual(calls, ['contract-target', 'binding']);
  assert.equal(result?.addressClass, 'contract');
  assert.equal(result?.resolvedOperation, 'contract-call');
  const bad = createMidnamesNameService(
    profile,
    reads(async () => ({ kind: 'other', address: repointed })),
  );
  await assert.rejects(resolvePassportContractCallName(bad, query), code('InvalidRecord'));
});

test('uses an atomic target and ACC check when the provider supports one', async () => {
  const calls: string[] = [];
  const adapter = createMidnamesNameService(profile, {
    async readTarget() {
      assert.fail('The separate target read must not run.');
    },
    async isSupportedAccount() {
      assert.fail('The separate account read must not run.');
    },
    async readSupportedTarget(name, scope) {
      assert.equal(name, query.name);
      assert.deepEqual(scope, profile);
      calls.push('atomic');
      return { kind: 'contract', address: account };
    },
  });
  assert.equal((await resolvePassportName(adapter, query))?.accountAddress, account);
  assert.deepEqual(calls, ['atomic']);
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

test('two verifier-checked readers must agree on every observed contract target', async () => {
  const calls: string[] = [];
  let primary: string | undefined = account;
  let witness: string | undefined = account;
  let witnessOutage = false;
  const service = (path: 'primary' | 'witness') =>
    createMidnamesNameService(profile, {
      async readTarget(name) {
        calls.push(`${path}:${name}`);
        if (path === 'witness' && witnessOutage) throw new Error('private provider detail');
        const target = path === 'primary' ? primary : witness;
        return target ? { kind: 'contract', address: target } : undefined;
      },
      async isSupportedAccount() {
        return true;
      },
    });
  const agreeing = requireAgreeingMidnamesResolvers(service('primary'), service('witness'));
  assert.equal((await resolvePassportName(agreeing, query))?.accountAddress, account);
  assert.deepEqual(calls, [`primary:${query.name}`, `witness:${query.name}`]);
  calls.length = 0;
  witness = repointed;
  await assert.rejects(resolvePassportName(agreeing, query), code('Unavailable'));
  assert.deepEqual(calls, [`primary:${query.name}`, `witness:${query.name}`]);
  witness = undefined;
  await assert.rejects(resolvePassportName(agreeing, query), code('Unavailable'));
  primary = undefined;
  assert.equal(await resolvePassportName(agreeing, query), undefined);
  witnessOutage = true;
  await assert.rejects(resolvePassportName(agreeing, query), code('Unavailable'));
  assert.throws(
    () =>
      requireAgreeingMidnamesResolvers(
        service('primary'),
        createMidnamesNameService(
          { ...profile, registryAddress: repointed },
          reads(async () => undefined),
        ),
      ),
    code('InvalidQuery'),
  );
});

test('two finalized indexers must select one identical block before a shared read', async () => {
  const first = { height: 120, hash: 'ab'.repeat(32) };
  const second = { ...first };
  const selected = await requireMatchingFinalizedIndexerBlock(
    async () => first,
    async () => second,
  );
  assert.deepEqual(selected, first);
  assert.ok(Object.isFrozen(selected));
  second.height++;
  await assert.rejects(
    requireMatchingFinalizedIndexerBlock(
      async () => first,
      async () => second,
    ),
    code('Unavailable'),
  );
  second.height = first.height;
  second.hash = 'cd'.repeat(32);
  await assert.rejects(
    requireMatchingFinalizedIndexerBlock(
      async () => first,
      async () => second,
    ),
    code('Unavailable'),
  );
  await assert.rejects(
    requireMatchingFinalizedIndexerBlock(
      async () => first,
      async () => {
        throw new Error('private witness failure');
      },
    ),
    code('Unavailable'),
  );
});

test('known mapping and requested name use one matched block per resolution', async () => {
  const reads: Array<{ path: string; name: string; block: MidnamesIndexerBlock }> = [];
  const selections = { primary: 0, witness: 0 };
  let witnessHeight = 120;
  const block = (height: number) => ({ height, hash: 'ab'.repeat(32) });
  const loader =
    (path: 'primary' | 'witness'): Parameters<typeof configuredNameService>[1] =>
    async () => ({
      async readFinalizedBlock() {
        selections[path]++;
        return block(path === 'primary' ? 120 : witnessHeight);
      },
      async readSupportedTargetAt(name, _scope, selected) {
        reads.push({ path, name, block: selected });
        return { kind: 'contract' as const, address: name === query.name ? account : repointed };
      },
      async readSupportedTarget() {
        assert.fail('The matched-block path must not select a fresh tip per name.');
      },
      async readTarget() {
        assert.fail('The unchecked target path must not run.');
      },
      async isSupportedAccount() {
        assert.fail('The separate account read must not run.');
      },
    });
  const service = configuredNameService(
    profile,
    loader('primary'),
    loader('witness'),
    query.name,
    account,
  );
  const other = { ...query, name: 'bob.passport.night' };
  assert.equal((await resolvePassportName(service, other))?.accountAddress, repointed);
  assert.deepEqual(selections, { primary: 1, witness: 1 });
  assert.deepEqual(
    reads.map((read) => `${read.path}:${read.name}:${read.block.height}`),
    [
      `primary:${query.name}:120`,
      `witness:${query.name}:120`,
      `primary:${other.name}:120`,
      `witness:${other.name}:120`,
    ],
  );
  witnessHeight = 121;
  await assert.rejects(resolvePassportName(service, other), code('Unavailable'));
  assert.deepEqual(selections, { primary: 2, witness: 2 });
  assert.equal(reads.length, 4, 'Divergent tips refuse before either name is read.');
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
  assert.throws(
    () =>
      configureMidnames(
        {
          ...config,
          verificationIndexerUrl: 'http://127.0.0.1:18089/api/v4/graphql',
          verificationIndexerWsUrl: 'ws://127.0.0.1:18089/api/v4/graphql/ws',
        },
        profile.networkId,
        'acc-s3r1.1',
      ),
    /separately pinned finalized node/,
  );
  assert.ok(
    configureMidnames(
      { ...config, registryProfile: 'standalone-0.35' },
      profile.networkId,
      'acc-s3r1.1',
    ),
  );
  assert.equal(
    configureMidnames(
      { ...config, registryProfile: 'standalone-0.36.1' },
      profile.networkId,
      'acc-s3r1.1',
    )?.recovery,
    undefined,
  );
  assert.throws(() =>
    configureMidnames(
      { ...config, registryProfile: 'standalone-0.36.1', claimProtocolVersion: '2001100' },
      profile.networkId,
      'acc-s3r1.1',
    ),
  );
  const isolated0361 = {
    ...config,
    namespace: 'night',
    registryProfile: 'standalone-0.36.1',
    isolated0361: '1',
    claimProtocolVersion: '2001100',
  };
  assert.throws(() => configureMidnames(isolated0361, profile.networkId, 'acc-s3r1.1'));
  assert.throws(() =>
    configureMidnames({ ...isolated0361, isolated0361: '0' }, profile.networkId, 'acc-s3r1.1'),
  );
  assert.throws(() =>
    configureMidnames(
      { ...isolated0361, indexerUrl: 'https://indexer.example.test/api/v4/graphql' },
      profile.networkId,
      'acc-s3r1.1',
    ),
  );
  const standalone = { ...config, namespace: 'night', registryProfile: 'standalone-0.35' };
  const resolverOnly = configureMidnames(standalone, profile.networkId, 'acc-s3r1.1');
  assert.equal(resolverOnly?.provider.mode, 'external');
  assert.equal(resolverOnly?.recovery, undefined);
  assert.ok(
    configureMidnames(
      { ...standalone, claimProtocolVersion: '2001000' },
      profile.networkId,
      'acc-s3r1.1',
    ),
  );
  assert.ok(
    configureMidnames(
      { ...standalone, claimProtocolVersion: '2001100' },
      profile.networkId,
      'acc-s3r1.1',
    )?.recovery,
  );
  for (const version of ['2001100.0', '2001001', '2001200', ''])
    assert.throws(
      () =>
        configureMidnames(
          { ...standalone, claimProtocolVersion: version },
          profile.networkId,
          'acc-s3r1.1',
        ),
      /observed standalone claim transaction protocol/,
    );
  assert.throws(() =>
    configureMidnames(
      {
        ...config,
        verificationIndexerUrl: 'https://witness.example.test/graphql',
        verificationIndexerWsUrl: 'wss://witness.example.test/graphql/ws',
      },
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
  assert.throws(() =>
    configureMidnames(
      { ...config, networkId: 'preview', registryProfile: 'standalone-0.36.1' },
      'preview',
      'acc-s3r1.1',
    ),
  );
  for (const change of [
    { registryProfile: 'unknown' },
    { registryAddress: undefined },
    { namespace: undefined },
    { networkId: 'preview' },
    { indexerUrl: 'http://127.0.0.1:18108/api/v3/graphql' },
    { indexerWsUrl: 'ws://127.0.0.1:18108/api/v3/graphql/ws' },
    { claimProtocolVersion: '2001100' },
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
    verificationIndexerUrl: 'https://witness.preview.example.test/api/v4/graphql',
    verificationIndexerWsUrl: 'wss://witness.preview.example.test/api/v4/graphql/ws',
    nodeUrl: 'https://node.preview.example.test/rpc',
    anchorBlockHeight: '42',
    anchorBlockHash: 'ab'.repeat(32),
  };
  for (const missing of [
    {},
    { knownName: query.name },
    { knownAccountAddress: account },
    { knownName: '', knownAccountAddress: '' },
  ])
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
    { verificationIndexerUrl: undefined, verificationIndexerWsUrl: undefined },
    { verificationIndexerUrl: undefined },
    { verificationIndexerUrl: config.indexerUrl },
    { verificationIndexerWsUrl: 'wss://user:password@witness.preview.example.test/graphql' },
    { nodeUrl: undefined },
    { anchorBlockHeight: undefined },
    { anchorBlockHash: undefined },
    { nodeUrl: config.indexerUrl },
    { nodeUrl: config.verificationIndexerUrl },
    { anchorBlockHash: '0x' + config.anchorBlockHash },
    { anchorBlockHeight: '0' },
    { anchorBlockHeight: '1e2' },
  ])
    assert.throws(() => configureMidnames({ ...config, ...invalid }, 'preview', 'acc-s3r1.1'));
});

test('a remote indexer requires the known mapping even when labelled undeployed', () => {
  const remote = {
    ...profile,
    indexerUrl: 'https://example.test/api/v4/graphql',
    indexerWsUrl: 'wss://example.test/api/v4/graphql/ws',
    verificationIndexerUrl: 'https://witness.example.test/api/v4/graphql',
    verificationIndexerWsUrl: 'wss://witness.example.test/api/v4/graphql/ws',
    nodeUrl: 'https://node.example.test/rpc',
    anchorBlockHeight: '42',
    anchorBlockHash: 'ab'.repeat(32),
  };
  assert.throws(
    () => configureMidnames(remote, 'undeployed', 'acc-s3r1.1'),
    /complete independently observed/,
  );
  assert.equal(
    configureMidnames(
      { ...remote, knownName: query.name, knownAccountAddress: account },
      'undeployed',
      'acc-s3r1.1',
    )?.provider.mode,
    'external',
  );
});

test('provisional ACC reader is confined to the local standalone registry', () => {
  const local = {
    networkId: 'undeployed',
    namespace: 'night',
    registryAddress: profile.registryAddress,
    registryProfile: 'standalone-0.35',
    indexerUrl: 'http://127.0.0.1:18108/api/v4/graphql',
    indexerWsUrl: 'ws://127.0.0.1:18108/api/v4/graphql/ws',
  };
  const candidate: CandidateAccountQualification = {
    bindingId: 'acc-s3r1.1-zkir036',
    manifestSha256: '590d3c97db7fce05d5ea85a9bf37c82b7032c498703a2807276ca7ae0ca52e5f',
    decodeState: () => {
      throw new Error('No chain read in configuration test');
    },
  };
  assert.ok(configureMidnames(local, 'undeployed', candidate.bindingId, undefined, candidate));
  const isolated0361 = {
    ...local,
    registryProfile: 'standalone-0.36.1',
    isolated0361: '1',
    claimProtocolVersion: '2001100',
  };
  assert.ok(
    configureMidnames(isolated0361, 'undeployed', candidate.bindingId, undefined, candidate)
      ?.recovery,
  );
  assert.throws(() =>
    configureMidnames(
      { ...isolated0361, isolated0361: '0' },
      'undeployed',
      candidate.bindingId,
      undefined,
      candidate,
    ),
  );
  assert.throws(
    () =>
      configureMidnames(
        {
          ...local,
          indexerUrl: 'https://remote.example.test/api/v4/graphql',
          indexerWsUrl: 'wss://remote.example.test/api/v4/graphql/ws',
          knownName: 'alice.night',
          knownAccountAddress: account,
          verificationIndexerUrl: 'https://witness.example.test/api/v4/graphql',
          verificationIndexerWsUrl: 'wss://witness.example.test/api/v4/graphql/ws',
        },
        'undeployed',
        candidate.bindingId,
        undefined,
        candidate,
      ),
    /local standalone registry/,
  );
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
  for (const badName of ['Bob.passport.night', 'bob..passport.night', 'bob.night'])
    await assert.rejects(
      resolvePassportName(service, { ...other, name: badName }),
      code('InvalidQuery'),
    );
  unavailable = true;
  await assert.rejects(
    resolvePassportName(service, { ...other, name: 'Bob.passport.night' }),
    code('InvalidQuery'),
  );
  unavailable = false;
  assert.deepEqual(calls, []);
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
