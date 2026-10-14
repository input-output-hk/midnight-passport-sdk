import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchCheckedConfig,
  fetchCheckedV1Config,
  remoteDeployer,
  remoteDirectory,
  remoteProver,
  remoteSponsor,
} from '../packages/adapter-service/dist/index.js';

/** @param {number} status @param {unknown} body */
const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('v1 config checks service version and binding-specific artefact URL against host pins', async () => {
  const pin = {
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    manifestSha256: 'a'.repeat(64),
    artefactUrl: 'http://service/v1/zk/acc-s3r1.1',
  };
  const config = {
    ...pin,
    indexerUri: 'http://indexer',
    indexerWsUri: 'ws://indexer',
    nodeUri: 'http://node',
    proofServerUri: 'http://proof',
    zkBaseUrl: pin.artefactUrl,
    coinPublicKey: 'aa',
    encryptionPublicKey: 'bb',
    apiVersions: ['1.0.0-pre.0'],
  };
  /** @type {import('../packages/account/dist/ports/index.js').FetchLike} */
  const good = async (url) => {
    assert.equal(url, 'http://service/v1/config');
    return reply(200, config);
  };
  assert.deepEqual(await fetchCheckedV1Config('http://service/', pin, { fetch: good }), config);
  /** @type {[Record<string, unknown>, string][]} */
  const cases = [
    [{ networkId: 'another' }, 'NetworkMismatch'],
    [{ bindingId: 'another' }, 'BindingUnsupported'],
    [{ manifestSha256: 'b'.repeat(64) }, 'ArtefactIntegrity'],
    [{ apiVersions: ['0.1.0'] }, 'ApiVersionUnsupported'],
    [{ zkBaseUrl: 'http://service/v1/zk/another' }, 'ArtefactIntegrity'],
  ];
  for (const [change, code] of cases) {
    /** @type {import('../packages/account/dist/ports/index.js').FetchLike} */
    const wrong = async () => reply(200, { ...config, ...change });
    await assert.rejects(fetchCheckedV1Config('http://service', pin, { fetch: wrong }), { code });
  }
});

test('remote prover sends an unproven transaction and returns a remote proof', async () => {
  /** @type {import('../packages/account/dist/ports/index.js').FetchLike} */
  const fetchFn = async (url, init) => {
    assert.equal(url, 'http://service/prove-tx');
    assert.deepEqual(JSON.parse(init?.body ?? ''), {
      tx: '0102',
      networkId: 'undeployed',
      bindingId: 'acc-test',
      circuits: ['rotate_enc_key_with_p256'],
    });
    return reply(200, { tx: '0304' });
  };
  const proof = await remoteProver('http://service/', { fetch: fetchFn }).proveTx(
    Uint8Array.of(1, 2),
    { networkId: 'undeployed', bindingId: 'acc-test', circuits: ['rotate_enc_key_with_p256'] },
  );
  assert.deepEqual(proof, { tx: Uint8Array.of(3, 4), provenance: 'remote' });
});

test('remote sponsor and deployer use the transaction endpoints and preserve the abort gate', async () => {
  /** @type {string[]} */
  const paths = [];
  /** @type {import('../packages/account/dist/ports/index.js').FetchLike} */
  const fetchFn = async (url, init) => {
    paths.push(url);
    const body = JSON.parse(init?.body ?? '');
    if (url.endsWith('/sponsor/balance')) {
      assert.deepEqual(body, { tx: '01' });
      return reply(200, { tx: '02' });
    }
    if (url.endsWith('/sponsor/submit')) {
      assert.deepEqual(body, { tx: '02' });
      return reply(200, { txId: 'submission' });
    }
    assert.deepEqual(body, { boot: '03', encKey: '04', retireAuthority: true, firstArm: 'jubjub' });
    return reply(200, { address: 'account', txHashes: ['wave-1'] });
  };
  const sponsor = remoteSponsor('http://service', { fetch: fetchFn });
  assert.deepEqual(await sponsor.balanceAndSign(Uint8Array.of(1)), Uint8Array.of(2));
  assert.equal(await sponsor.submit(Uint8Array.of(2)), 'submission');
  const deployer = remoteDeployer('http://service', { fetch: fetchFn });
  await assert.rejects(
    deployer.deploy({
      boot: Uint8Array.of(3),
      encKey: Uint8Array.of(4),
      retireAuthority: true,
      signal: { aborted: true, addEventListener() {}, removeEventListener() {} },
    }),
    { code: 'Aborted' },
  );
  assert.deepEqual(
    await deployer.deploy({
      boot: Uint8Array.of(3),
      encKey: Uint8Array.of(4),
      retireAuthority: true,
      firstArm: 'jubjub',
    }),
    { address: 'account', txIds: ['wave-1'] },
  );
  assert.equal(paths.length, 3, 'aborted deploy made no request');
});

test('remote directory carries hints and proofs on the versioned wire', async () => {
  const hint = {
    address: 'account',
    scheme: /** @type {const} */ ('p256-webauthn'),
    credentialId: Uint8Array.of(1),
    publicKey: { x: 2n, y: 3n },
    policy: { rp_id_hash: Uint8Array.of(4), origin: Uint8Array.of(5) },
    salt: Uint8Array.of(6),
    status: /** @type {const} */ ('deployed'),
  };
  /** @type {import('../packages/account/dist/ports/index.js').FetchLike} */
  const fetchFn = async (url, init) => {
    assert.equal(url, 'http://service/v1/accounts/undeployed/01');
    if (init?.method === 'PUT') {
      assert.deepEqual(JSON.parse(init.body ?? ''), {
        hint: {
          address: 'account',
          scheme: 'p256-webauthn',
          credentialId: '01',
          publicKey: { x: '2', y: '3' },
          policy: { rp_id_hash: '04', origin: '05' },
          salt: '06',
          status: 'deployed',
        },
        proof: {
          scheme: 'p256-webauthn',
          challenge: '07',
          authenticatorData: '08',
          clientDataJSON: '09',
          signature: '0a',
        },
      });
      return reply(204, undefined);
    }
    return reply(200, {
      address: 'account',
      scheme: 'p256-webauthn',
      credentialId: '01',
      publicKey: { x: '2', y: '3' },
      policy: { rp_id_hash: '04', origin: '05' },
      salt: '06',
      status: 'deployed',
    });
  };
  const directory = remoteDirectory('http://service/', { fetch: fetchFn });
  await directory.put('undeployed', hint, {
    scheme: 'p256-webauthn',
    challenge: Uint8Array.of(7),
    authenticatorData: Uint8Array.of(8),
    clientDataJSON: Uint8Array.of(9),
    signature: Uint8Array.of(10),
  });
  assert.deepEqual(
    await directory.get('undeployed', { kind: 'credential-id', credentialId: Uint8Array.of(1) }),
    hint,
  );
});

test('directory round-trips a sealed JubJub creation entry and refuses a malformed one', async () => {
  const sealed = new Uint8Array(192).fill(0xd1);
  const hint = {
    address: 'ab'.repeat(32),
    scheme: /** @type {const} */ ('jubjub-schnorr'),
    credentialId: Uint8Array.of(1),
    publicKey: { x: 2n, y: 3n },
    salt: new Uint8Array(32),
    keyEntries: [sealed],
    status: /** @type {const} */ ('deployed'),
  };
  let returnedEntry = Buffer.from(sealed).toString('hex');
  /** @type {import('../packages/account/dist/ports/index.js').FetchLike} */
  const fetchFn = async (_url, init) => {
    if (init?.method === 'PUT') {
      assert.deepEqual(JSON.parse(init.body ?? '').hint.keyEntries, [returnedEntry]);
      return reply(204, undefined);
    }
    return reply(200, {
      address: hint.address,
      scheme: hint.scheme,
      credentialId: '01',
      publicKey: { x: '2', y: '3' },
      salt: '00'.repeat(32),
      keyEntries: [returnedEntry],
      status: 'deployed',
    });
  };
  const directory = remoteDirectory('http://service', { fetch: fetchFn });
  await directory.put('undeployed', hint);
  assert.deepEqual(
    await directory.get('undeployed', { kind: 'credential-id', credentialId: Uint8Array.of(1) }),
    hint,
  );
  returnedEntry = 'ff';
  await assert.rejects(
    directory.get('undeployed', { kind: 'credential-id', credentialId: Uint8Array.of(1) }),
    { code: 'InternalError' },
  );
});

test('checked config rejects a service whose binding or manifest differs from the app pin', async () => {
  const pin = {
    networkId: 'undeployed',
    bindingId: 'acc-test',
    manifestSha256: 'a'.repeat(64),
    indexerUrl: '',
    indexerWsUrl: '',
    nodeUrl: '',
    artefactUrl: '',
  };
  const config = {
    networkId: 'undeployed',
    bindingId: 'acc-test',
    manifestSha256: pin.manifestSha256,
    indexerUri: '',
    indexerWsUri: '',
    nodeUri: '',
    proofServerUri: '',
    zkBaseUrl: '',
    coinPublicKey: '',
    encryptionPublicKey: '',
  };
  /** @type {import('../packages/account/dist/ports/index.js').FetchLike} */
  const good = async () => reply(200, config);
  assert.deepEqual(await fetchCheckedConfig('http://service', pin, { fetch: good }), config);
  /** @type {import('../packages/account/dist/ports/index.js').FetchLike} */
  const wrong = async () => reply(200, { ...config, manifestSha256: 'b'.repeat(64) });
  await assert.rejects(fetchCheckedConfig('http://service', pin, { fetch: wrong }), {
    code: 'ArtefactIntegrity',
  });
});
