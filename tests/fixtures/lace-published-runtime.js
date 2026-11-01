// Executed only inside a prepared external consumer against actual public export conditions.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createRemotePassportSeams, m } from '@laceio/sdk/experimental';
import { hostedJubjubAuthoriser } from '@input-output-hk/mn-passport-adapter-browser/hosted-jubjub';
import {
  toJubjubGrantScope,
  toJubjubGrantBookkeeping,
  jubjubGrantInbox,
} from './host-example/jubjub-grant-scope.js';

const cases = [];
const account = 'ab'.repeat(32),
  commitment = 'cd'.repeat(32);
const conversions = {
  account: (v) => v,
  epoch: (v) => v,
  counter: (v) => v,
  flow: (v) => structuredClone(v),
};
function fixture(reply = () => undefined) {
  const requests = [];
  const seams = createRemotePassportSeams({
    request: async (kind, payload) => {
      requests.push(structuredClone({ kind, payload }));
      return reply(kind, payload);
    },
  });
  const sdk = hostedJubjubAuthoriser(seams.authoriser, conversions);
  return { requests, seams, sdk };
}
async function check(name, fn) {
  await fn();
  cases.push(name);
}
const remove = {
  kind: 'remove-device',
  account,
  commitmentHex: commitment,
  devices: ['ef'.repeat(32)],
};
await check(
  'supported device consent and commitment batch cross the public host transport',
  async () => {
    const f = fixture((kind) =>
      kind === 'device-commitments' ? [commitment, commitment] : undefined,
    );
    const result = await f.sdk.withKeySession(
      () => f.sdk.deviceCommitments(account, 0n, [0n, 1n]),
      remove,
    );
    assert.deepEqual(result, [commitment, commitment]);
    assert.deepEqual(f.requests, [
      { kind: 'flow-open', payload: { flow: remove } },
      { kind: 'device-commitments', payload: { account, epoch: '0', counters: ['0', '1'] } },
      { kind: 'flow-close', payload: { outcome: 'completed' } },
    ]);
  },
);
await check('missing flow is refused before transport or callback', async () => {
  const f = fixture();
  let called = false;
  await assert.rejects(
    () =>
      f.sdk.withKeySession(async () => {
        called = true;
      }),
    /must name the flow/,
  );
  assert.equal(called, false);
  assert.equal(f.requests.length, 0);
});
await check('missing required device consent field is refused before transport', async () => {
  const f = fixture();
  let called = false;
  await assert.rejects(
    () =>
      f.sdk.withKeySession(
        async () => {
          called = true;
        },
        { kind: 'remove-device', account, commitmentHex: commitment },
      ),
    /flow.devices/,
  );
  assert.equal(called, false);
  assert.equal(f.requests.length, 0);
});
await check('open refusal cannot execute the operation', async () => {
  const refused = Error('synthetic denied approval');
  const f = fixture(() => {
    throw refused;
  });
  let called = false;
  await assert.rejects(
    () =>
      f.sdk.withKeySession(async () => {
        called = true;
      }, remove),
    (e) => e === refused,
  );
  assert.equal(called, false);
  assert.deepEqual(
    f.requests.map((r) => r.kind),
    ['flow-open'],
  );
});
await check('failed operation retains its code even if close also fails', async () => {
  const original = Object.assign(Error('synthetic operation failure'), { code: 'test-refused' });
  const f = fixture((kind) => {
    if (kind === 'flow-close') throw Error('synthetic close failure');
  });
  await assert.rejects(
    () =>
      f.sdk.withKeySession(async () => {
        throw original;
      }, remove),
    (e) => e === original,
  );
  assert.deepEqual(f.requests.at(-1), {
    kind: 'flow-close',
    payload: { outcome: 'failed', code: 'test-refused' },
  });
});
await check('malformed commitment count cannot become a successful SDK result', async () => {
  const f = fixture((kind) => (kind === 'device-commitments' ? [] : undefined));
  await assert.rejects(() =>
    f.sdk.withKeySession(() => f.sdk.deviceCommitments(account, 0n, [0n]), remove),
  );
  assert.equal(f.requests.at(-1).payload.outcome, 'failed');
});
await check('unsupported SDK rotation and withdrawal kinds never reach the host', async () => {
  const f = fixture();
  let called = false;
  for (const kind of ['rotate-encryption-key', 'withdraw-unshielded', 'withdraw-shielded'])
    assert.throws(
      () =>
        f.sdk.withKeySession(
          async () => {
            called = true;
          },
          { kind, account },
        ),
      /no .* consent descriptor/,
    );
  assert.equal(called, false);
  assert.equal(f.requests.length, 0);
});
await check('lossy consent conversion never opens a host session', async () => {
  const f = fixture();
  const sdk = hostedJubjubAuthoriser(f.seams.authoriser, {
    ...conversions,
    flow: () => ({ kind: 'sign-in' }),
  });
  assert.throws(() => sdk.withKeySession(async () => {}, remove), /consent descriptor changed/);
  assert.equal(f.requests.length, 0);
});
await check('non-JubJub circuit is refused before the host request', async () => {
  const f = fixture();
  assert.throws(
    () =>
      f.sdk.authorise({
        account,
        circuit: 'remove_device_with_p256',
        args: [],
        witnessValues: [],
        authNonce: 0n,
        useCounter: 0n,
      }),
    /does not use the JubJub arm/,
  );
  assert.equal(f.requests.length, 0);
  assert.equal(f.seams.authoriser.storageKey, undefined);
});
await check(
  'public module construction validates endpoints without network or key access',
  async () => {
    const f = fixture();
    const network = {
      networkId: 'undeployed',
      indexerUrl: 'http://127.0.0.1:1/graphql',
      indexerWsUrl: 'ws://127.0.0.1:1/graphql/ws',
      nodeUrl: 'http://127.0.0.1:2',
      artefactUrl: 'http://127.0.0.1:3',
    };
    const forbidden = async () => {
      throw Error('network/proving is outside this probe');
    };
    const props = {
      ...f.seams,
      network,
      sponsor: { balanceAndSign: forbidden },
      prover: { prove: forbidden, check: forbidden },
      rpId: 'localhost',
    };
    const module = m.createPassportAccountModule(props);
    assert.equal(module.moduleName, 'passport-account');
    assert.throws(
      () =>
        m.createPassportAccountModule({
          ...props,
          network: { ...network, nodeUrl: 'ws://127.0.0.1:2' },
        }),
      /must use/,
    );
    assert.equal(f.requests.length, 0);
  },
);
await check(
  'remote record presence stays signer-owned and empty inbox is not validation',
  async () => {
    const f = fixture((kind) => {
      assert.equal(kind, 'record-exists');
      return 'absent';
    });
    const presence = await new Promise((resolve, reject) =>
      f.seams.accountRecordStore.presence().subscribe({ next: resolve, error: reject }),
    );
    assert.equal(presence, 'absent');
    assert.equal(f.requests.length, 1);
    const result = await f.seams.encryptionKey.openInbox(
      'undeployed',
      { account, encKey: new Uint8Array(32), envelopes: [] },
      [],
    );
    assert.deepEqual(result, []);
    assert.equal(f.requests.length, 1);
  },
);
await check('wider host grantee schemes require explicit refusal without relabelling', async () => {
  const input = {
    grantee: { scheme: 'secp256k1-ecdsa', publicKey: '02' + 'ab'.repeat(32) },
    read: false,
  };
  assert.throws(() => toJubjubGrantScope(input), /requires a JubJub/);
  assert.equal(input.grantee.scheme, 'secp256k1-ecdsa');
  const supported = { ...input, grantee: { scheme: 'jubjub-schnorr', publicKey: commitment } };
  assert.deepEqual(toJubjubGrantScope(supported), supported);
  assert.throws(
    () =>
      toJubjubGrantBookkeeping({
        granteeScheme: 'secp256k1-ecdsa',
        granteePublicKey: input.grantee.publicKey,
      }),
    /requires a JubJub/,
  );
  const legacy = { granteePublicKey: commitment };
  assert.deepEqual(toJubjubGrantBookkeeping(legacy), legacy);
});
await check('public host decoded grant scheme is refused at the SDK inbox boundary', async () => {
  const f = fixture((kind) => {
    assert.equal(kind, 'open-inbox');
    return [
      {
        kind: 'grant',
        record: {
          part: 'grant',
          grantId: account,
          slot: 0,
          scopeSalt: commitment,
          granteeScheme: 'secp256k1-ecdsa',
          granteePublicKey: '02' + commitment,
        },
      },
    ];
  });
  const port = jubjubGrantInbox(f.seams.encryptionKey);
  await assert.rejects(
    () =>
      port.openInbox(
        'undeployed',
        { account, encKey: new Uint8Array(32), envelopes: [new Uint8Array(192)] },
        [new Uint8Array(192)],
      ),
    /grant inbox requires a JubJub/,
  );
  assert.equal(f.requests.length, 1);
});
const receipt = {
  schemaVersion: 1,
  kind: 'published-host-public-protocol',
  cases,
  testsPassed: cases.length,
  syntheticTransport: true,
  hostSignerHandlers: false,
  signerPage: false,
  nativeProof: false,
  fullCompatibility: false,
  realProvider: false,
};
writeFileSync('public-protocol-receipt.json', JSON.stringify(receipt, null, 2) + '\n', {
  flag: 'wx',
  mode: 0o600,
});
console.log(JSON.stringify({ publicHostProtocolCases: cases.length, fullCompatibility: false }));
