import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BINDING_VERSION,
  resolveBinding,
  resolvePinnedBinding,
} from '@input-output-hk/mn-passport-contract';
import { assertPinnedBinding } from '../src/binding-pin.ts';

test('the service refuses a binding or manifest other than the packaged ACC pin', () => {
  const binding = resolveBinding(BINDING_VERSION);
  const stack = {
    networkId: 'undeployed',
    nodeUri: 'http://127.0.0.1:9944',
    indexerUri: 'http://127.0.0.1:8088/api/v4/graphql',
    indexerWsUri: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
    proofServerUri: 'http://127.0.0.1:6300',
  };
  const old = {
    ...stack,
    publicStack: stack,
    host: '127.0.0.1',
    corsOrigin: 'http://localhost:5173',
    bindingId: BINDING_VERSION,
    manifestSha256: binding.manifestSha256,
    contractDir: '/reference',
    artefactDir: '/reference/contracts/managed/account',
  };
  assert.doesNotThrow(() => assertPinnedBinding(old, false));
  assert.throws(
    () => assertPinnedBinding({ ...old, bindingId: 'acc-other' }, false),
    /not supported/,
  );
  assert.throws(
    () => assertPinnedBinding({ ...old, manifestSha256: 'ab'.repeat(32) }, false),
    /differs from the package pin/,
  );
  const candidate = resolvePinnedBinding('acc-s3r1.1-zkir036');
  assert.throws(
    () =>
      assertPinnedBinding(
        {
          ...old,
          bindingId: 'acc-s3r1.1-zkir036',
          manifestSha256: candidate.manifestSha256,
        },
        true,
      ),
    /requires a separate ACC asset directory/,
  );
  const localCandidate = {
    ...old,
    bindingId: 'acc-s3r1.1-zkir036',
    manifestSha256: candidate.manifestSha256,
    artefactDir: '/candidate/account',
  };
  assert.doesNotThrow(() => assertPinnedBinding(localCandidate, true));
  assert.throws(() => assertPinnedBinding(localCandidate, false), /explicit local undeployed mode/);
  assert.throws(
    () => assertPinnedBinding({ ...localCandidate, networkId: 'mainnet' }, true),
    /explicit local undeployed mode/,
  );
  for (const changed of [
    { host: '0.0.0.0' },
    { corsOrigin: 'https://passport.example' },
    { nodeUri: 'https://node.example' },
    { proofServerUri: 'https://proof.example' },
    { indexerUri: 'https://indexer.example/api/v4/graphql' },
    { indexerWsUri: 'ws://127.0.0.1:8088/api/v3/graphql/ws' },
    { publicStack: { ...stack, indexerUri: 'https://indexer.example/api/v4/graphql' } },
  ])
    assert.throws(
      () => assertPinnedBinding({ ...localCandidate, ...changed }, true),
      /loopback API v4 endpoints/,
    );
  assert.doesNotThrow(() =>
    assertPinnedBinding(
      {
        ...old,
        networkId: 'mainnet',
        host: '0.0.0.0',
        indexerUri: 'https://indexer.example/api/v4/graphql',
      },
      false,
    ),
  );
});
