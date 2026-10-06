// The browser adapter's service-backed chain: the delegated prover, the era-tagged wallet and
// submit seams, the deploy and ledger-read legs, the status-to-error mapping (Ruling R16), and
// the shim. The service is a recording fake; the transactions are real ledger-v9 objects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const b = await import(new URL('../packages/adapter-browser/dist/index.js', import.meta.url).href);
// ledger-v9 is the adapter's dependency, so it resolves from the adapter's own manifest.
const ledger = await import(
  pathToFileURL(
    createRequire(new URL('../packages/adapter-browser/package.json', import.meta.url)).resolve(
      '@midnightntwrk/ledger-v9',
    ),
  ).href
);

/**
 * @typedef {{ status: number; body?: unknown; unreadable?: boolean; hang?: boolean }} Reply
 * @typedef {{ method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }} Init
 * @typedef {{ url: string; method: string | undefined; contentType: string | undefined; body: Record<string, unknown> | undefined }} Call
 */

/**
 * A fake service. A reply with `unreadable` has a body that is not JSON, one with `hang` never
 * answers; an `Error` in place of a reply makes the request itself fail, as an unreachable host does.
 * @param {Record<string, Reply | Error>} responses
 */
function recordingFetch(responses) {
  /** @type {Call[]} */
  const calls = [];
  /** @param {string} url @param {Init} [init] */
  const fn = async (url, init = {}) => {
    calls.push({
      url,
      method: init.method,
      contentType: init.headers?.['content-type'],
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const r = responses[new URL(url).pathname];
    if (r === undefined) throw new Error(`no fake reply for ${url}`);
    if (r instanceof Error) throw r;
    if (r.hang) {
      // Never answers; fails only when the caller's signal aborts, as a real fetch does.
      const { signal } = init;
      assert.ok(signal, 'a hanging request must carry an abort signal');
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      });
    }
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => {
        if (r.unreadable) throw new SyntaxError('Unexpected token <');
        return r.body;
      },
    };
  };
  return { fn, calls };
}

/** @param {Call | undefined} call */
const bodyOf = (call) => {
  assert.ok(call, 'the service was called');
  assert.ok(call.body, 'with a body');
  return call.body;
};

/** A real proven, bound (finalized) transaction, with no contract action to prove. */
async function finalizedTx() {
  const proven = await ledger.Transaction.fromParts('undeployed').prove(
    {
      check: async () => [],
      prove: async () => new Uint8Array(),
      lookupKey: async () => undefined,
    },
    ledger.CostModel.initialCostModel(),
  );
  return { unbound: proven, bound: proven.bind() };
}

const hex = (/** @type {Uint8Array} */ bytes) => Buffer.from(bytes).toString('hex');

test('the delegated proving provider sends hex preimage, key location and decimal binding input', async () => {
  const f = recordingFetch({
    '/prove': { status: 200, body: { proof: 'aabb' } },
    '/check': { status: 200, body: { result: ['3', null] } },
  });
  const p = b.delegatedProvingProvider('http://svc', f.fn);
  assert.deepEqual(
    await p.prove(Uint8Array.of(1, 2), 'contract:x/c', 7n),
    Uint8Array.of(0xaa, 0xbb),
  );
  assert.deepEqual(f.calls[0]?.body, {
    preimage: '0102',
    keyLocation: 'contract:x/c',
    overwriteBindingInput: '7',
  });
  assert.deepEqual(await p.check(Uint8Array.of(1), 'k'), [3n, undefined]);
  assert.deepEqual(f.calls[1]?.body, { preimage: '01', keyLocation: 'k' });
  assert.equal(f.calls[0]?.method, 'POST');
});

test('the delegated proving provider omits the binding input when there is none, and holds no key', async () => {
  const f = recordingFetch({ '/prove': { status: 200, body: { proof: '00' } } });
  const p = b.delegatedProvingProvider('http://svc/', f.fn);
  await p.prove(Uint8Array.of(9), 'k');
  assert.deepEqual(f.calls[0]?.body, { preimage: '09', keyLocation: 'k' });
  assert.equal(f.calls[0]?.url, 'http://svc/prove', 'a trailing slash on the base is not doubled');
  assert.equal(await p.lookupKey('k'), undefined);
});

test('a prover failure surfaces as ProverUnavailable', async () => {
  const f = recordingFetch({ '/prove': { status: 502, body: { error: 'down' } } });
  await assert.rejects(
    b.delegatedProvingProvider('http://svc', f.fn).prove(Uint8Array.of(1), 'k'),
    {
      code: 'ProverUnavailable',
      message: 'down',
    },
  );
});

for (const endpoint of ['prove', 'check']) {
  for (const [status, code] of /** @type {const} */ ([
    [502, 'ProverUnavailable'],
    [503, 'ProverUnavailable'],
    [400, 'InternalError'],
    [403, 'InternalError'],
  ])) {
    test(`/${endpoint} ${status} is ${code} and carries the server's message`, async () => {
      const f = recordingFetch({
        [`/${endpoint}`]: { status, body: { error: `server says ${status}` } },
      });
      const p = b.delegatedProvingProvider('http://svc', f.fn);
      const run =
        endpoint === 'prove' ? p.prove(Uint8Array.of(1), 'k') : p.check(Uint8Array.of(1), 'k');
      await assert.rejects(run, {
        code,
        message: `server says ${status}`,
        type: 'PassportConnectorError',
      });
    });
  }
}

test('an unreadable prover answer falls back to the status line, and an unreachable prover is ProverUnavailable', async () => {
  const html = recordingFetch({ '/prove': { status: 503, unreadable: true } });
  await assert.rejects(
    b.delegatedProvingProvider('http://svc', html.fn).prove(Uint8Array.of(1), 'k'),
    {
      code: 'ProverUnavailable',
      message: '/prove failed: HTTP 503',
    },
  );
  const gone = recordingFetch({ '/check': new TypeError('fetch failed') });
  await assert.rejects(
    b.delegatedProvingProvider('http://svc', gone.fn).check(Uint8Array.of(1), 'k'),
    {
      code: 'ProverUnavailable',
    },
  );
});

test('a 200 prover answer without a proof is InternalError, not a silent empty proof', async () => {
  const f = recordingFetch({
    '/prove': { status: 200, body: {} },
    '/check': { status: 200, body: {} },
  });
  const p = b.delegatedProvingProvider('http://svc', f.fn);
  await assert.rejects(p.prove(Uint8Array.of(1), 'k'), { code: 'InternalError' });
  await assert.rejects(p.check(Uint8Array.of(1), 'k'), { code: 'InternalError' });
});

test('the wallet seam takes and returns era-tagged v9 transactions, posting the untagged bytes (R16(a))', async () => {
  const { unbound, bound } = await finalizedTx();
  const f = recordingFetch({
    '/sponsor/balance': { status: 200, body: { tx: hex(bound.serialize()) } },
  });
  const wallet = b.serviceWalletProvider(
    'http://svc',
    { coinPublicKey: 'cpk', encryptionPublicKey: 'epk' },
    f.fn,
  );
  assert.deepEqual(wallet.supportedEras, ['v9']);
  assert.equal(wallet.getCoinPublicKey(), 'cpk');
  assert.equal(wallet.getEncryptionPublicKey(), 'epk');

  const out = await wallet.balanceTx({ version: 'v9', tx: unbound });
  // What went out is the bare transaction's bytes: no tag, no wrapper.
  assert.deepEqual(bodyOf(f.calls[0]), { tx: hex(unbound.serialize()) });
  assert.equal(f.calls[0]?.url, 'http://svc/sponsor/balance');
  // What came back is re-wrapped, and is a live finalized transaction with the bytes the service sent.
  assert.equal(out.version, 'v9');
  assert.ok(out.tx instanceof ledger.Transaction);
  assert.deepEqual(out.tx.serialize(), bound.serialize());
});

test('the wallet seam refuses a v8 payload before it calls the service', async () => {
  const f = recordingFetch({});
  const wallet = b.serviceWalletProvider(
    'http://svc',
    { coinPublicKey: 'c', encryptionPublicKey: 'e' },
    f.fn,
  );
  await assert.rejects(wallet.balanceTx({ version: 'v8', txBytes: Uint8Array.of(1) }));
  assert.equal(f.calls.length, 0);
});

test('the submit seam unwraps the v9 tag, posts hex and answers the transaction id', async () => {
  const { bound } = await finalizedTx();
  const f = recordingFetch({ '/sponsor/submit': { status: 200, body: { txId: 'abc123' } } });
  const midnight = b.serviceMidnightProvider('http://svc', f.fn);
  assert.deepEqual(midnight.supportedEras, ['v9']);
  assert.equal(await midnight.submitTx({ version: 'v9', tx: bound }), 'abc123');
  assert.deepEqual(bodyOf(f.calls[0]), { tx: hex(bound.serialize()) });
  await assert.rejects(midnight.submitTx({ version: 'v8', txBytes: Uint8Array.of(1) }));
  assert.equal(f.calls.length, 1, 'the v8 payload never reached the service');
});

test('the proof seam sends the whole transaction to /prove-tx and answers in the v9 arm', async () => {
  const unproven = ledger.Transaction.fromParts('undeployed');
  // An empty transaction needs no proof, so the local ledger can stand in for the service.
  const unused = {
    check: () => Promise.reject(new Error('unused')),
    prove: () => Promise.reject(new Error('unused')),
    lookupKey: () => Promise.resolve(undefined),
  };
  const proven = await unproven.prove(unused, ledger.CostModel.initialCostModel());
  const f = recordingFetch({ '/prove-tx': { status: 200, body: { tx: hex(proven.serialize()) } } });
  const prover = b.serviceProofProvider('http://svc', f.fn);
  assert.deepEqual(prover.supportedEras, ['v9']);
  const out = await prover.proveTx({ version: 'v9', tx: unproven });
  assert.equal(out.version, 'v9');
  assert.ok(out.tx instanceof ledger.Transaction);
  assert.deepEqual(bodyOf(f.calls[0]), { tx: hex(unproven.serialize()) });
});

for (const path of ['/sponsor/balance', '/sponsor/submit', '/deploy']) {
  for (const [status, code] of /** @type {const} */ ([
    [403, 'SponsorRejected'],
    [429, 'SponsorRejected'],
    [502, 'SponsorRejected'],
    [400, 'InternalError'],
  ])) {
    test(`${path} ${status} is ${code} and carries the server's message`, async () => {
      const f = recordingFetch({ [path]: { status, body: { error: `server says ${status}` } } });
      const config = { coinPublicKey: 'c', encryptionPublicKey: 'e' };
      const { bound } = await finalizedTx();
      const run =
        path === '/sponsor/balance'
          ? b
              .serviceWalletProvider('http://svc', config, f.fn)
              .balanceTx({ version: 'v9', tx: bound })
          : path === '/sponsor/submit'
            ? b.serviceMidnightProvider('http://svc', f.fn).submitTx({ version: 'v9', tx: bound })
            : chainOver(f.fn).deploy({ boot: new Uint8Array(32), encKey: new Uint8Array(32) });
      await assert.rejects(run, { code, message: `server says ${status}` });
    });
  }
}

test('an unreachable sponsor is an InternalError, not a rejection', async () => {
  const f = recordingFetch({ '/deploy': new TypeError('fetch failed') });
  await assert.rejects(
    chainOver(f.fn).deploy({ boot: new Uint8Array(32), encKey: new Uint8Array(32) }),
    {
      code: 'InternalError',
    },
  );
});

const CONFIG = {
  networkId: 'undeployed',
  bindingId: 'acc',
  manifestSha256: 'ab'.repeat(32),
  indexerUri: 'http://indexer/graphql',
  indexerWsUri: 'ws://indexer/graphql/ws',
  nodeUri: 'ws://node',
  zkBaseUrl: 'http://svc/zk/acc',
  coinPublicKey: 'cpk',
  encryptionPublicKey: 'epk',
};

const stubLedger = {
  booted: true,
  auth_nonce: 4n,
  device_epoch: 2n,
  spec_version: 1n,
  devices: { member: (/** @type {Uint8Array} */ e) => e[0] === 1, size: () => 3n },
};

/**
 * A chain over a fake service and a fake indexer.
 * @param {(url: string, init?: Init) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>} fetchFn
 * @param {{ queryContractState(address: string): Promise<unknown> }} [indexer]
 * @param {Record<string, unknown>} [extra] further options, which win
 */
function chainOver(fetchFn, indexer = { queryContractState: async () => null }, extra = {}) {
  return b.createServiceChain({
    serviceUrl: 'http://svc',
    config: CONFIG,
    expectedManifestSha256: CONFIG.manifestSha256,
    module: {
      Contract: class {},
      ledger: (/** @type {unknown} */ data) => (data === 'state-data' ? stubLedger : undefined),
      pureCircuits: {},
    },
    fetchFn,
    publicDataProvider: indexer,
    ...extra,
  });
}

test('deploy posts the constructor arguments as hex and returns the address and hashes', async () => {
  const f = recordingFetch({
    '/deploy': { status: 200, body: { address: 'ff00', txHashes: ['t1', 't2'] } },
  });
  const out = await chainOver(f.fn).deploy({
    boot: new Uint8Array(32).fill(1),
    encKey: new Uint8Array(32).fill(2),
  });
  assert.deepEqual(out, { address: 'ff00', txHashes: ['t1', 't2'] });
  assert.deepEqual(bodyOf(f.calls[0]), { boot: '01'.repeat(32), encKey: '02'.repeat(32) });
  assert.equal(f.calls[0]?.url, 'http://svc/deploy');
});

test('every POST to the service is application/json, so a cross-site page needs a preflight (I1)', async () => {
  const f = recordingFetch({
    '/deploy': { status: 200, body: { address: 'ff00', txHashes: [] } },
    '/prove': { status: 200, body: { proof: 'aa' } },
  });
  await chainOver(f.fn).deploy({ boot: new Uint8Array(32), encKey: new Uint8Array(32) });
  await b.delegatedProvingProvider('http://svc', f.fn).prove(Uint8Array.of(1), 'c');
  assert.equal(f.calls.length, 2);
  for (const call of f.calls) {
    assert.equal(call.method, 'POST');
    assert.equal(call.contentType, 'application/json', call.url);
  }
});

test('deploy without an address in a 200 answer is InternalError', async () => {
  const f = recordingFetch({ '/deploy': { status: 200, body: { txHashes: [] } } });
  await assert.rejects(
    chainOver(f.fn).deploy({ boot: new Uint8Array(32), encKey: new Uint8Array(32) }),
    {
      code: 'InternalError',
    },
  );
});

test('readLedger projects the on-chain state through the generated ledger, and is undefined when there is none', async () => {
  const chain = chainOver(recordingFetch({}).fn, {
    queryContractState: async () => ({ data: 'state-data' }),
  });
  const view = await chain.readLedger('addr');
  assert.ok(view);
  assert.deepEqual(
    { ...view, hasEntry: undefined },
    {
      booted: true,
      authNonce: 4n,
      deviceEpoch: 2n,
      entryCount: 3,
      specVersion: 1,
      hasEntry: undefined,
    },
  );
  assert.equal(view.hasEntry(Uint8Array.of(1)), true);
  assert.equal(view.hasEntry(Uint8Array.of(2)), false);
  assert.equal(await chainOver(recordingFetch({}).fn).readLedger('absent'), undefined);
});

test('the shim installs a descriptor under window.midnight.passport without clobbering others', () => {
  /** @type {{ midnight?: Record<string, unknown> }} */
  const target = { midnight: { devwallet: { name: 'dev' } } };
  const descriptor = {
    name: 'Midnight Passport (prototype)',
    apiVersion: /** @type {const} */ ('0.1.0-prototype'),
    connect: async () => {
      throw new Error('not used');
    },
  };
  b.injectPassportConnector(target, descriptor);
  assert.equal(target.midnight?.passport, descriptor);
  assert.deepEqual(target.midnight?.devwallet, { name: 'dev' });
  assert.ok(Object.isFrozen(target.midnight?.passport));
  /** @type {{ midnight?: Record<string, unknown> }} */
  const empty = {};
  b.injectPassportConnector(empty, descriptor);
  assert.equal(empty.midnight?.passport, descriptor);
});

test('fetchServiceConfig refuses a service on another network', async () => {
  const f = recordingFetch({ '/config': { status: 200, body: { networkId: 'testnet' } } });
  await assert.rejects(b.fetchServiceConfig('http://svc', f.fn, 'undeployed'), {
    code: 'NetworkMismatch',
  });
});

test('fetchServiceConfig returns the service configuration of the bound network', async () => {
  const f = recordingFetch({ '/config': { status: 200, body: { ...CONFIG, extra: 'ignored' } } });
  assert.deepEqual(await b.fetchServiceConfig('http://svc/', f.fn, 'undeployed'), CONFIG);
  assert.equal(f.calls[0]?.url, 'http://svc/config');
});

test('fetchServiceConfig failures are InternalError', async () => {
  const down = recordingFetch({ '/config': { status: 500, body: { error: 'x' } } });
  await assert.rejects(b.fetchServiceConfig('http://svc', down.fn, 'undeployed'), {
    code: 'InternalError',
  });
  const gone = recordingFetch({ '/config': new TypeError('fetch failed') });
  await assert.rejects(b.fetchServiceConfig('http://svc', gone.fn, 'undeployed'), {
    code: 'InternalError',
  });
  const partial = recordingFetch({ '/config': { status: 200, body: { networkId: 'undeployed' } } });
  await assert.rejects(b.fetchServiceConfig('http://svc', partial.fn, 'undeployed'), {
    code: 'InternalError',
    message: 'service /config has no "bindingId"',
  });
});

test('a service whose manifest hash is not the app pin is refused before any request (R18)', () => {
  const f = recordingFetch({});
  /** @type {boolean} */
  let submitted = false;
  assert.throws(
    () =>
      chainOver(f.fn, undefined, {
        expectedManifestSha256: 'cd'.repeat(32),
        submit: async () => {
          submitted = true;
        },
      }),
    { code: 'ArtefactIntegrity', type: 'PassportConnectorError' },
  );
  assert.equal(f.calls.length, 0, 'nothing, /zk included, was fetched');
  assert.equal(submitted, false);
});

test('a pin that is not 64 hex characters is refused, even when /config carries the same value (M1)', () => {
  for (const pin of ['', 'abc', 'zz'.repeat(32), 'ab'.repeat(33)]) {
    const f = recordingFetch({});
    assert.throws(
      () =>
        chainOver(f.fn, undefined, {
          config: { ...CONFIG, manifestSha256: pin },
          expectedManifestSha256: pin,
        }),
      { code: 'ArtefactIntegrity', message: /pin is not 64 hex characters/ },
      JSON.stringify(pin),
    );
    assert.equal(f.calls.length, 0, 'nothing was fetched');
  }
});

test('call forwards the call, maps the finalized record and verifies artefacts against the app pin', async () => {
  /** @type {{ providers: Record<string, unknown>; options: Record<string, unknown> }[]} */
  const seen = [];
  // The pin is the app's (upper-case here), and the service's /config hash merely agrees with it.
  const chain = chainOver(recordingFetch({}).fn, undefined, {
    expectedManifestSha256: CONFIG.manifestSha256.toUpperCase(),
    submit: async (
      /** @type {Record<string, unknown>} */ providers,
      /** @type {Record<string, unknown>} */ options,
    ) => {
      seen.push({ providers, options });
      return { public: { txId: 'the-id', txHash: 'the-hash', blockHeight: 42 } };
    },
  });
  const out = await chain.call('addr', 'activate_initial_device_with_p256', [1n, 'x']);
  // txHash, not txId: the finalized record carries both and PassportTxResult names the hash.
  assert.deepEqual(out, { txHash: 'the-hash', blockHeight: 42 });
  const [only] = seen;
  assert.ok(only);
  assert.equal(only.options.contractAddress, 'addr');
  assert.equal(only.options.circuitId, 'activate_initial_device_with_p256');
  assert.deepEqual(only.options.args, [1n, 'x']);
  assert.ok(only.options.compiledContract);
  assert.equal('privateStateId' in only.options, false, 'the MVP circuits keep no private state');
  assert.equal('privateStateProvider' in only.providers, false);
  // midnight-js keeps the integrity options in a private field; that is the only place they show.
  assert.deepEqual(
    pick(Reflect.get(Object(only.providers.zkConfigProvider), 'integrityOptions'), [
      'verify',
      'expectedManifestHash',
    ]),
    { verify: 'require', expectedManifestHash: CONFIG.manifestSha256 },
  );
  assert.equal(Reflect.get(Object(only.providers.zkConfigProvider), 'baseURL'), CONFIG.zkBaseUrl);
});

test('deploy refuses an answer whose txHashes are not a list of strings', async () => {
  for (const txHashes of [undefined, 'abc', ['t1', 2]]) {
    const f = recordingFetch({ '/deploy': { status: 200, body: { address: 'ff00', txHashes } } });
    await assert.rejects(
      chainOver(f.fn).deploy({ boot: new Uint8Array(32), encKey: new Uint8Array(32) }),
      { code: 'InternalError' },
    );
  }
});

test('/prove that outlasts the timeout is ProverUnavailable, and the abort reaches the request', async () => {
  const f = recordingFetch({ '/prove': { status: 200, hang: true } });
  const p = b.delegatedProvingProvider('http://svc', f.fn, 20);
  // AbortSignal.timeout's timer is unref'd, so a test with nothing else pending must hold the loop.
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    await assert.rejects(p.prove(Uint8Array.of(1), 'k'), {
      code: 'ProverUnavailable',
      message: '/prove: no answer within 20 ms',
    });
  } finally {
    clearTimeout(keepAlive);
  }
  assert.equal(f.calls.length, 1);
});

test('/check carries no timeout signal, so only /prove is bounded', async () => {
  /** @type {Init | undefined} */
  let seenInit;
  const p = b.delegatedProvingProvider(
    'http://svc',
    async (/** @type {string} */ _url, /** @type {Init} */ init) => {
      seenInit = init;
      return { ok: true, status: 200, json: async () => ({ result: [] }) };
    },
  );
  await p.check(Uint8Array.of(1), 'k');
  assert.equal(seenInit?.signal, undefined);
});

/**
 * @param {unknown} value
 * @param {string[]} keys
 */
function pick(value, keys) {
  const source = /** @type {Record<string, unknown>} */ (Object(value));
  return Object.fromEntries(keys.map((k) => [k, source[k]]));
}
