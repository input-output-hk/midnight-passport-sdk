// External browser-only qualification entry. Actual client/handlers, fake chain, virtual credential.
import * as source from './prepared/handlers.mjs';
import { createRemotePasskeySigner, createRemotePassportSeams } from '@laceio/sdk/experimental';
import { hostedJubjubAuthoriser } from '@input-output-hk/mn-passport-adapter-browser/hosted-jubjub';
import { addJubjubAuthorisingDevice } from '@input-output-hk/mn-passport-account';
import { pureCircuits as pure } from '@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1';
import { jubjub } from '@noble/curves/misc.js';
import { of, defer } from 'rxjs';
const hex = (v) => Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('');
const status = (v) => {
  document.querySelector('#status').textContent = v;
};
const q = {
  ready: false,
  errors: [],
  calls: 0,
  assertions: 0,
  approvals: [],
  requests: [],
  decision: 'approve',
  originAllowed: true,
  held: false,
};
window.qualification = q;
if (location.pathname === '/signer/') {
  const material = () => {
    const id = localStorage.getItem('passport-qualification-credential');
    if (!id) throw Error('Virtual credential not enrolled');
    return source.createPasskeySessionKeySource({
      credentialId: id,
      rpId: 'localhost',
      credentials: {
        create: async () => {
          throw Error('Existing credential only');
        },
        get: async (options) => {
          q.assertions++;
          return navigator.credentials.get(options);
        },
      },
    });
  };
  let stop;
  const start = () => {
    const collections = new Map();
    const handlers = source.createPassportSignerHandlers({
      keySource: material(),
      sessionTimeoutMs: 1000,
      createKeyValueStorage: ({ collectionId }) => {
        if (!collections.has(collectionId)) collections.set(collectionId, new Map());
        const values = collections.get(collectionId);
        return {
          getValues: (keys) =>
            defer(() => {
              const result = keys.map((k) => values.get(k));
              return result.includes(undefined) ? of() : of(structuredClone(result));
            }),
          setValue: (key, value) =>
            defer(() => {
              values.set(key, structuredClone(value));
              return of(undefined);
            }),
        };
      },
    });
    q.shutdown = async () => {
      try {
        await handlers['flow-close']({ outcome: 'failed', code: 'test-cleanup' }, location.origin);
      } finally {
        stop?.();
      }
    };
    stop = source.serveSignerRequests({
      handlers,
      rpId: 'localhost',
      assertOriginAllowed: (kind, origin) => {
        if (origin !== q.allowedOrigin || !q.originAllowed)
          throw Object.assign(Error('Origin denied'), { code: 'origin-denied' });
      },
      onRequest: async (request, origin) => {
        q.approvals.push({
          kind: request.kind,
          flow: structuredClone(request.payload?.flow),
          origin,
        });
        if (q.holdApproval)
          await new Promise((resolve) => {
            q.releaseApproval = resolve;
          });
        return q.decision;
      },
    });
    q.ready = true;
    status('Signer ready');
  };
  q.allowedOrigin = new URL(document.referrer).origin;
  document.querySelector('#start').textContent = 'Enroll virtual credential';
  document.querySelector('#start').onclick = async () => {
    try {
      const credential = await navigator.credentials.create({
        publicKey: {
          rp: { id: 'localhost', name: 'Passport qualification only' },
          user: {
            id: crypto.getRandomValues(new Uint8Array(16)),
            name: 'qualification',
            displayName: 'Synthetic qualification',
          },
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
          extensions: { prf: {} },
        },
      });
      if (!credential?.getClientExtensionResults().prf?.enabled)
        throw Error('Virtual authenticator PRF unavailable');
      localStorage.setItem('passport-qualification-credential', credential.id);
      start();
    } catch (error) {
      q.errors.push(error.name);
      status('Credential refused');
    }
  };
  if (localStorage.getItem('passport-qualification-credential')) start();
} else {
  let client, seams, sdk, popup;
  const conversions = {
    account: source.AccAddress,
    epoch: source.DeviceEpoch,
    counter: source.UseCounter,
    flow: (v) => {
      source.decodeSignerFlow(v);
      return structuredClone(v);
    },
  };
  q.open = () => {
    client = createRemotePasskeySigner({ signerUrl: q.signerUrl });
    popup = client.open();
    q.connecting = client
      .connect()
      .then(() => {
        seams = createRemotePassportSeams(client);
        sdk = hostedJubjubAuthoriser(seams.authoriser, conversions);
        q.connected = true;
        return true;
      })
      .catch((error) => {
        q.connectionError = error.code ?? error.name;
        return false;
      });
  };
  document.querySelector('#start').onclick = q.open;
  q.request = (kind, payload) => client.request(kind, payload);
  q.close = () => client.close();
  q.signin = () => sdk.withKeySession(() => sdk.devicePublicKey(), { kind: 'sign-in' });
  q.scope = async (kind = 'sign-in') =>
    sdk.withKeySession(
      async () => {
        q.held = true;
        await new Promise((resolve) => {
          q.release = resolve;
        });
        return sdk.devicePublicKey();
      },
      { kind },
    );
  q.account = 'ab'.repeat(32);
  q.exercise = async () => {
    const account = q.account,
      self = { bytes: Uint8Array.from(account.match(/../g), (x) => parseInt(x, 16)) };
    const point = await q.signin(),
      joining = pure.compute_public_point_with_jubjub(23n);
    let entries = [pure.derive_device_entry_with_jubjub(self, point, 0n, 0n)],
      record = {
        address: account,
        bindingId: 'acc-s3r1.1',
        scheme: 'jubjub-schnorr',
        credentialId: new Uint8Array([1]),
        localUseCounter: 0n,
      };
    const input = {
      hint: {
        address: account,
        scheme: 'jubjub-schnorr',
        status: 'active',
        publicKey: point,
        credentialId: new Uint8Array([1]),
      },
      joiningPublicKey: joining,
    };
    const result = await addJubjubAuthorisingDevice(input, {
      bindingId: 'acc-s3r1.1',
      pure,
      authoriser: sdk,
      records: {
        read: async () => record,
        write: async (v) => {
          record = v;
        },
      },
      chain: {
        readAccount: async () => ({
          specVersion: 3,
          booted: true,
          deviceEpoch: 0n,
          authNonce: 0n,
          hasEntry: (e) => entries.some((v) => hex(v) === hex(e)),
        }),
        call: async (request) => {
          const [entry, pk, counter, R, S, grind] = request.args;
          if (
            request.address !== account ||
            request.circuit !== 'add_device_with_jubjub' ||
            counter !== 0n ||
            pk.x !== point.x ||
            pk.y !== point.y
          )
            throw Error('Unexpected authorization');
          const c = BigInt(
            '0x' +
              hex(
                pure
                  .challenge_add_device_with_jubjub(self, R, pk, entry, 0n, grind)
                  .slice()
                  .reverse(),
              ),
          );
          if (c >= jubjub.Point.Fn.ORDER) throw Error('Invalid challenge');
          const G = jubjub.Point.fromAffine(pure.compute_public_point_with_jubjub(1n));
          if (
            !G.multiply(S).equals(
              jubjub.Point.fromAffine(R).add(jubjub.Point.fromAffine(pk).multiply(c)),
            )
          )
            throw Error('Invalid signature');
          q.calls++;
          entries = [pure.derive_device_entry_with_jubjub(self, point, 0n, 1n), entry];
          return { txId: '00' + 'cd'.repeat(32) };
        },
      },
    });
    if (result.nextUseCounter !== 1n || record.localUseCounter !== 1n)
      throw Error('Record not advanced');
    return {
      commitmentHex: result.commitmentHex,
      calls: q.calls,
      nextUseCounter: '1',
      readerDelivery: false,
    };
  };
  q.unsupported = () => {
    for (const kind of ['rotate-encryption-key', 'withdraw-shielded', 'withdraw-unshielded']) {
      let refused = false;
      try {
        sdk.withKeySession(
          async () => {
            q.calls++;
          },
          { kind, account: q.account },
        );
      } catch {
        refused = true;
      }
      if (!refused) throw Error('Unsupported consent admitted');
    }
    return true;
  };
  q.ready = true;
  status('DApp ready');
}
