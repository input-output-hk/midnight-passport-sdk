// The demo's flow table and text helpers (src/flows.ts): prompt counts per action, the stage
// definitions the progress bar and the log are built from, the connector-step map, and how an
// error reads to the person at the demo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPassportConnector } from '@midnight-ntwrk/mn-passport-account';
import {
  ACTIVATION_ESTIMATE_S,
  CREATE_STEP_STAGE,
  DEPLOY_ESTIMATE_S,
  FLOWS,
  PASSKEY_PROMPTS,
  ROTATION_ESTIMATE_S,
  formatClock,
  formatDuration,
  plainError,
  promptCountText,
  promptLabel,
  promptsFor,
  type ActionId,
} from '../src/flows.ts';
import { shorten } from '../src/ui.ts';

const ACTIONS: readonly ActionId[] = ['create', 'open', 'rotate', 'wallet'];

test('prompts per action, with and without an account open', () => {
  assert.deepEqual(promptsFor('create', false), [2, 3]);
  assert.deepEqual(
    promptsFor('create', true),
    [2, 3],
    'creating does not depend on an open account',
  );
  // The second prompt checks the encryption key, until it is rotated.
  assert.deepEqual(promptsFor('open', false), [1, 2]);
  assert.deepEqual(promptsFor('open', true), [1, 2]);
  assert.equal(promptsFor('rotate', false), 1);
  assert.equal(promptsFor('rotate', true), 1);
  assert.equal(promptsFor('wallet', true), 1, 'pinned to the open account: one PRF prompt');
  assert.equal(promptsFor('wallet', false), 2, 'no account: the picker, then the PRF prompt');
});

test('the prompt table has an entry for each action and nothing the actions do not use', () => {
  assert.deepEqual(Object.keys(PASSKEY_PROMPTS).sort(), [
    'create',
    'open',
    'rotate',
    'walletWithAccount',
    'walletWithoutAccount',
  ]);
  for (const action of ACTIONS) {
    for (const open of [true, false]) {
      const n = promptsFor(action, open);
      const [min, max] = typeof n === 'number' ? [n, n] : n;
      assert.ok(Number.isInteger(min) && min >= 1 && max >= min, `${action} ${open}`);
    }
  }
});

test('prompt counts read as numbers, ranges and a plural that follows the largest count', () => {
  assert.equal(promptCountText(2), '2');
  assert.equal(promptCountText([2, 3]), '2–3');
  assert.equal(promptCountText([2, 2]), '2');
  assert.equal(promptLabel(1), '1 passkey prompt');
  assert.equal(promptLabel(2), '2 passkey prompts');
  assert.equal(promptLabel([2, 3]), '2–3 passkey prompts');
  assert.equal(promptLabel([1, 1]), '1 passkey prompt');
  assert.equal(promptLabel([0, 1]), '0–1 passkey prompt');
  assert.equal(promptLabel(0), 'No passkey prompt');
  assert.equal(promptLabel([0, 0]), 'No passkey prompt');
  assert.equal(promptLabel(promptsFor('wallet', false)), '2 passkey prompts');
  assert.equal(promptLabel(promptsFor('create', true)), '2–3 passkey prompts');
});

test('every action has a flow with at least one stage, unique stage ids and a title and summary', () => {
  for (const action of ACTIONS) {
    const flow = FLOWS[action];
    assert.ok(flow.title.length > 0 && flow.summary.length > 0, action);
    assert.ok(flow.stages.length > 0, action);
    const ids = flow.stages.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${action}: stage ids are unique`);
  }
});

test('create has five stages and only the deployment and the activation have an estimate', () => {
  const stages = FLOWS.create.stages;
  assert.deepEqual(
    stages.map((s) => s.id),
    ['passkey', 'prf', 'deploy', 'activate', 'read'],
  );
  assert.deepEqual(
    stages.map((s) => s.estimateMs),
    [undefined, undefined, DEPLOY_ESTIMATE_S * 1000, ACTIVATION_ESTIMATE_S * 1000, undefined],
  );
  assert.equal(DEPLOY_ESTIMATE_S, 180);
  assert.equal(ACTIVATION_ESTIMATE_S, 25);
  assert.match(stages[2]?.label ?? '', /10 waves/);
});

test('rotate estimates its one proving stage, and open and wallet are all indeterminate', () => {
  assert.equal(FLOWS.rotate.stages[0]?.estimateMs, ROTATION_ESTIMATE_S * 1000);
  assert.equal(ROTATION_ESTIMATE_S, 60);
  for (const action of ['open', 'wallet'] as const) {
    for (const stage of FLOWS[action].stages) assert.equal(stage.estimateMs, undefined, stage.id);
  }
});

test('the summaries quote the estimates the progress bar uses', () => {
  assert.match(FLOWS.create.summary, /about 3 min/);
  assert.match(FLOWS.rotate.summary, /about 60 s/);
});

test('the account is read at the end of create, open and rotate', () => {
  for (const action of ['create', 'open', 'rotate'] as const) {
    assert.equal(FLOWS[action].stages.at(-1)?.id, 'read', action);
  }
});

test('every connector step maps to a create stage that exists, or to none', () => {
  const stageIds = new Set(FLOWS.create.stages.map((s) => s.id));
  for (const [step, stage] of Object.entries(CREATE_STEP_STAGE)) {
    assert.ok(stage === null || stageIds.has(stage), `${step} -> ${String(stage)}`);
  }
  assert.equal(CREATE_STEP_STAGE.deployed, null, 'a note on the deployment, not a stage');
  // The stages are entered in flow order by the steps in the order the connector reports them.
  const order = ['passkey-created', 'deploying', 'activating', 'active'].map(
    (step) => CREATE_STEP_STAGE[step],
  );
  const indexes = order.map((id) => FLOWS.create.stages.findIndex((s) => s.id === id));
  assert.deepEqual(
    indexes,
    [...indexes].sort((a, b) => a - b),
  );
});

test('the real connector reports no step that the map does not know', async () => {
  const bytes = (n: number) => new Uint8Array(n).fill(1);
  const credential = {
    credentialId: bytes(1),
    publicKey: { x: 1n, y: 2n, identity: false as const },
    policy: { rp_id_hash: bytes(32), origin: bytes(21) },
  };
  const connector = createPassportConnector({
    networkId: 'undeployed',
    bindingId: 'acc-test',
    pureCircuits: {
      derive_boot_commitment_with_p256: () => bytes(32),
      derive_device_entry_with_p256: () => bytes(32),
      challenge_rotate_enc_key_with_p256: () => bytes(32),
    },
    passkey: {
      create: async () => credential,
      identify: async () => ({ credentialId: credential.credentialId, owns: () => true }),
      sign: async () => ({ authenticator_data: bytes(37), sig: { r: 1n, s: 2n } }),
    },
    chain: {
      deploy: async () => ({ address: 'ab'.repeat(32), txHashes: [] }),
      readLedger: async () => undefined,
      call: async () => ({ txHash: 'tx' }),
    },
    registry: { put: async () => {}, get: async () => undefined },
    random: bytes,
    encryptionKey: async () => bytes(32),
  });
  const steps: string[] = [];
  await connector.createAccount({ userName: 'u', onProgress: (s: string) => steps.push(s) });
  assert.ok(steps.length >= 4);
  for (const step of steps) {
    assert.ok(step in CREATE_STEP_STAGE, `the dapp has no mapping for connector step "${step}"`);
  }
});

test('an error carries its code, its message and a hint for each connector code', () => {
  const codes = [
    'UserCancelled',
    'UnsupportedAuthenticator',
    'AccountNotFound',
    'ArtefactIntegrity',
    'ProverUnavailable',
    'SponsorRejected',
    'NetworkMismatch',
    'InternalError',
  ];
  const hints = new Set<string>();
  for (const code of codes) {
    const err = plainError(Object.assign(new Error('detail'), { code }), 'http://svc');
    assert.equal(err.code, code);
    assert.equal(err.message, 'detail');
    assert.ok(err.hint.length > 0 && !/Unexpected error/.test(err.hint), code);
    hints.add(err.hint);
  }
  assert.equal(hints.size, codes.length, 'each code has its own hint');
});

test('an error with an unknown code, a name only, or no shape at all still reads', () => {
  const unknownCode = plainError(Object.assign(new Error('x'), { code: 'Weird' }), 'http://svc');
  assert.equal(unknownCode.code, 'Weird');
  assert.match(unknownCode.hint, /Unexpected error/);
  assert.equal(
    plainError(new TypeError('x'), 'http://svc').code,
    'TypeError',
    'the name stands in',
  );
  assert.equal(
    plainError({ code: 7, name: 'Named' }, 'u').code,
    'Named',
    'a non-string code is skipped',
  );
  assert.equal(plainError({ code: 7, name: 7 }, 'u').code, 'Error');
  assert.deepEqual(plainError('boom', 'u'), {
    code: 'Error',
    message: 'boom',
    hint: 'Unexpected error; see the message below.',
  });
  assert.equal(plainError(null, 'u').message, 'null');
  assert.equal(plainError(undefined, 'u').message, 'undefined');
  assert.equal(
    plainError(new Error(''), 'u').message,
    'Error',
    'an empty message falls back to the text of the error',
  );
  assert.equal(plainError({ message: 5 }, 'u').message, '[object Object]');
});

test('an unreachable service is explained with its address, whatever the code and the browser', () => {
  for (const message of [
    'Failed to fetch',
    'NetworkError when attempting to fetch resource.',
    'Load failed',
    '/deploy: the service is unreachable',
    'service /config is unreachable',
    'FAILED TO FETCH',
  ]) {
    const err = plainError(
      Object.assign(new Error(message), { code: 'InternalError' }),
      'http://localhost:8787',
    );
    assert.match(
      err.hint,
      /Could not reach the Passport service at http:\/\/localhost:8787/,
      message,
    );
    assert.equal(err.code, 'InternalError');
    assert.equal(err.message, message, 'the raw message is kept');
  }
  assert.doesNotMatch(
    plainError(new Error('prover answered 500'), 'http://svc').hint,
    /Could not reach/,
  );
});

test('the evidence of an error holds exactly code, message and hint, whatever the thrown object carries', () => {
  const thrown = Object.assign(new Error('boom'), {
    code: 'InternalError',
    cause: new Error('inner'),
    seed: 'must not travel',
    credentialId: Uint8Array.of(1, 2, 3),
  });
  const err = plainError(thrown, 'http://svc');
  assert.deepEqual(Object.keys(err).sort(), ['code', 'hint', 'message']);
  assert.ok(!JSON.stringify(err).includes('must not travel'));
});

test('durations read in seconds below a minute and in minutes and seconds from there', () => {
  assert.equal(formatDuration(0), '0.0 s');
  assert.equal(formatDuration(1_234), '1.2 s');
  assert.equal(formatDuration(9_900), '9.9 s');
  assert.equal(formatDuration(10_000), '10 s');
  assert.equal(formatDuration(59_000), '59 s');
  assert.equal(formatDuration(60_000), '1 min 00 s');
  assert.equal(formatDuration(61_000), '1 min 01 s');
  assert.equal(formatDuration(89_600), '1 min 30 s', 'rounded to the second');
  assert.equal(formatDuration(125_400), '2 min 05 s');
  assert.equal(formatDuration(3_600_000), '60 min 00 s');
});

test('the clock reads minutes and seconds, floors the second and never goes negative', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(999), '0:00');
  assert.equal(formatClock(1_000), '0:01');
  assert.equal(formatClock(61_000), '1:01');
  assert.equal(formatClock(180_000), '3:00');
  assert.equal(formatClock(600_000), '10:00');
  assert.equal(formatClock(3_599_999), '59:59');
  assert.equal(formatClock(-5_000), '0:00');
});

test('shorten keeps the ends of a long value and leaves a short one whole', () => {
  assert.equal(shorten('abcdefghijklmnopqrstuvwxyz'), 'abcdefgh…uvwxyz');
  assert.equal(
    shorten('abcdefghijklmno'),
    'abcdefghijklmno',
    'head + tail + 1 characters stay whole',
  );
  assert.equal(shorten('abcdefghijklmnop'), 'abcdefgh…klmnop');
  assert.equal(shorten('abc'), 'abc');
  assert.equal(shorten('', 2, 2), '');
  assert.equal(shorten('0123456789', 2, 2), '01…89');
});
