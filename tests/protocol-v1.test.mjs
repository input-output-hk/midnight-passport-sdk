// mn-passport-protocol v1 (design §3, §4.1): the version constants, the error-code table with its
// retry flags and lace-platform mapping, the unknown-code rule, the progress steps, the service
// wire, and the prototype's names kept as deprecated aliases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../packages/protocol/dist/index.js';

/**
 * @typedef {import('../packages/protocol/dist/index.js').PassportErrorCode} PassportErrorCode
 * @typedef {import('../packages/protocol/dist/index.js').PassportErrorInfo} PassportErrorInfo
 */

test('the API and service wire versions are fixed constants', () => {
  assert.equal(p.PASSPORT_API_VERSION, '1.0.0-pre.0');
  assert.equal(p.PASSPORT_SERVICE_API_VERSION, '1.0.0-pre.0');
  assert.equal(p.PASSPORT_SERVICE_PATH_PREFIX, '/v1');
  assert.equal(p.PASSPORT_ERROR_TYPE, 'PassportConnectorError');
});

/**
 * Design §3.3, row by row: the retry flag and the lace-platform column.
 * @type {Record<PassportErrorCode, PassportErrorInfo>}
 */
const TABLE = {
  UserCancelled: { retryable: true, lace: ['ceremony-cancelled'] },
  UnsupportedAuthenticator: { retryable: false, lace: ['prf-unsupported'] },
  WrongPasskey: { retryable: true, lace: ['PasskeyCredentialMismatchError'] },
  AccountNotFound: { retryable: false, lace: ['account-not-found', 'account-contract-missing'] },
  EncryptionKeyMismatch: { retryable: false, lace: ['encryption-key-mismatch'] },
  NotAuthorised: { retryable: false, lace: ['not-authorised'] },
  DeviceEntryNotFound: { retryable: false, lace: ['device-entry-not-found'] },
  BindingUnsupported: { retryable: false, lace: [] },
  ArtefactIntegrity: { retryable: false, lace: ['artefact-integrity'] },
  ProverUnavailable: { retryable: true, lace: ['proof-server'] },
  SponsorRejected: { retryable: 'maybe', lace: ['sponsor-exhausted'] },
  NetworkMismatch: { retryable: false, lace: [] },
  ApiVersionUnsupported: { retryable: false, lace: [] },
  Aborted: { retryable: true, lace: [] },
  InternalError: { retryable: false, lace: [] },
};

test('the error-code table is the design §3.3 table, frozen', () => {
  assert.deepEqual(p.PASSPORT_ERRORS, TABLE);
  assert.ok(Object.isFrozen(p.PASSPORT_ERRORS));
  for (const info of Object.values(p.PASSPORT_ERRORS)) {
    assert.ok(Object.isFrozen(info) && Object.isFrozen(info.lace));
  }
});

test('isRetryable follows the table; "maybe" and unknown codes are not retryable', () => {
  const retryable = Object.keys(TABLE).filter((code) => p.isRetryable(code));
  assert.deepEqual(retryable, ['UserCancelled', 'WrongPasskey', 'ProverUnavailable', 'Aborted']);
  assert.equal(p.isRetryable('SponsorRejected'), false);
  assert.equal(p.isRetryable('SomeFutureCode'), false);
});

test('fromLaceCode maps every lace-platform code onto its v1 code, and back', () => {
  for (const [code, { lace }] of Object.entries(TABLE)) {
    for (const laceCode of lace) assert.equal(p.fromLaceCode(laceCode), code, laceCode);
  }
  const laceCodes = Object.values(p.PASSPORT_ERRORS).flatMap((info) => info.lace);
  assert.equal(new Set(laceCodes).size, laceCodes.length, 'a lace code maps to one v1 code');
});

test('anything else from lace-platform is InternalError', () => {
  for (const other of ['some-new-lace-code', 'UserCancelled', 'toString', '', undefined, 7]) {
    assert.equal(p.fromLaceCode(other), 'InternalError', String(other));
  }
});

test('an unknown code is treated as InternalError', () => {
  for (const code of Object.keys(TABLE)) assert.equal(p.asPassportErrorCode(code), code);
  for (const other of ['SomeFutureCode', 'toString', '__proto__', 'user-cancelled', null, 1]) {
    assert.equal(p.asPassportErrorCode(other), 'InternalError', String(other));
  }
});

test('the progress steps and phases are the design §3.4 lists, frozen', () => {
  assert.deepEqual(p.PASSPORT_STEPS, [
    'passkey.create',
    'passkey.probe',
    'passkey.prf',
    'passkey.identify',
    'passkey.sign',
    'service.config',
    'deploy',
    'deploy.wave',
    'deploy.retire',
    'activate',
    'prove',
    'prove.queue',
    'sponsor.balance',
    'sponsor.submit',
    'chain.finality',
    'chain.read',
    'counter.scan',
    'directory.read',
    'directory.write',
  ]);
  assert.deepEqual(p.PASSPORT_EVENT_PHASES, ['start', 'end', 'error']);
  assert.ok(Object.isFrozen(p.PASSPORT_STEPS) && Object.isFrozen(p.PASSPORT_EVENT_PHASES));
});

test('the deprecated prototype names still resolve to the same values', () => {
  assert.equal(p.PASSPORT_CONNECTOR_VERSION, '0.1.0-prototype');
  assert.equal(p.PASSPORT_NETWORK_UNDEPLOYED, 'undeployed');
  assert.deepEqual(p.PASSPORT_ERROR_CODES, [
    'UserCancelled',
    'UnsupportedAuthenticator',
    'AccountNotFound',
    'ArtefactIntegrity',
    'ProverUnavailable',
    'SponsorRejected',
    'NetworkMismatch',
    'InternalError',
  ]);
  assert.ok(Object.isFrozen(p.PASSPORT_ERROR_CODES));
  for (const code of p.PASSPORT_ERROR_CODES) assert.ok(Object.hasOwn(p.PASSPORT_ERRORS, code));
});

// The rest is checked by the compiler (checkJs): the shapes accept what the design says they do.

test('the v1 shapes type-check against design-shaped values', async () => {
  /** @type {import('../packages/protocol/dist/index.js').AbortSignalLike} */
  const signal = new AbortController().signal;
  /** @type {import('../packages/protocol/dist/index.js').PassportEvent[]} */
  const events = [];
  /** @type {import('../packages/protocol/dist/index.js').CreateAccountOptionsV1} */
  const options = {
    userName: 'alice',
    retireAuthority: true,
    signal,
    onEvent: (event) => events.push(event),
  };
  options.onEvent?.({
    id: 'e1',
    flowId: 'f1',
    step: 'deploy.wave',
    phase: 'end',
    at: 0,
    clock: 'service',
    durationMs: 5,
    detail: { wave: 1, of: 10 },
  });
  /** @type {import('../packages/protocol/dist/index.js').ServiceWire.Job<import('../packages/protocol/dist/index.js').ServiceWire.DeployResult>} */
  const job = { state: 'done', events, cursor: '1', result: { address: 'ab', txIds: ['t1'] } };
  /** @type {import('../packages/protocol/dist/index.js').PassportErrorShapeV1} */
  const error = Object.assign(
    new Error('x'),
    /** @type {const} */ ({
      type: p.PASSPORT_ERROR_TYPE,
      code: 'Aborted',
      retryable: true,
      step: 'prove',
    }),
  );
  /** @type {import('../packages/protocol/dist/index.js').CreateAccountStep} */
  const prototypeStep = 'deploying';
  // The plain names are the v1 shapes; the V1 names are their aliases.
  /** @type {import('../packages/protocol/dist/index.js').CreateAccountOptions} */
  const plain = options;
  /** @type {import('../packages/protocol/dist/index.js').PassportAccount} */
  const account = {
    address: 'ab',
    networkId: 'undeployed',
    bindingId: 'acc-45721e1',
    scheme: 'p256-webauthn',
    state: async () => ({
      booted: true,
      authNonce: 0n,
      deviceEpoch: 0n,
      entryCount: 1,
      specVersion: 2,
    }),
    rotateEncryptionKey: async () => ({ txHash: 't' }),
  };
  /** @type {import('../packages/protocol/dist/index.js').PassportConnectorAPIV1} */
  const api = {
    apiVersion: p.PASSPORT_API_VERSION,
    networkId: 'undeployed',
    bindingId: 'acc-45721e1',
    createAccount: async () => account,
    openAccount: async () => account,
  };
  /** @type {import('../packages/protocol/dist/index.js').PassportConnectorDescriptor} */
  const descriptor = {
    rdns: 'io.lace.passport',
    name: 'Lace',
    apiVersion: p.PASSPORT_API_VERSION,
    bindings: ['acc-45721e1'],
    connect: async () => api,
  };
  assert.equal(plain.retireAuthority, true);
  assert.equal((await descriptor.connect('undeployed')).bindingId, 'acc-45721e1');
  assert.equal(job.events[0]?.step, 'deploy.wave');
  assert.equal(error.code, 'Aborted');
  assert.equal(prototypeStep, 'deploying');
  assert.equal(options.signal?.aborted, false);
});
