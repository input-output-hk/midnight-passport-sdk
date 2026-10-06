// DEV ONLY. A software passkey that replaces `navigator.credentials`, so the real UI path runs end
// to end in a browser with no authenticator. Open http://localhost:5173/?mockPasskey under
// `pnpm dev`; main.ts loads this module only when `import.meta.env.DEV` is true, so production
// builds never contain it.
//
// It behaves as the wa-json134 profile expects of a platform authenticator:
// - create: a P-256 key from WebCrypto (extractable, so it can persist), an `attestationObject`
//   with fmt "none", and `getPublicKey()` / `getPublicKeyAlgorithm()` as `browserPasskey` reads them;
// - get: signs `authData || SHA-256(clientDataJSON)` (DER), where clientDataJSON is the adapter's
//   own wa-json134 template and authData is 37 bytes with flags UP+UV (0x05), no extensions;
// - PRF: `results.first` / `.second` are HMAC-SHA256(prfSecret, salt), with a random 32-byte
//   secret per credential. A PRF ceremony also sets the ED flag and appends extension data, as a
//   real authenticator does, so it can never pass for a signing assertion.
//
// Credentials, private keys and PRF secrets included, persist in localStorage under
// MOCK_PASSKEY_STORAGE_KEY, so "Open with passkey" works after a reload. Acceptable for a dev
// mock only; the page says so in its banner.
import {
  base64url,
  clientDataJSON,
  fromBase64url,
} from '@midnight-ntwrk/mn-passport-adapter-browser';

export const MOCK_PASSKEY_STORAGE_KEY = 'passport-dev:mock-passkey:v1';

/** The part of `Storage` the mock needs; tests pass an in-memory one. */
export interface MockPasskeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredCredential {
  readonly id: string; // base64url
  readonly rpId: string;
  readonly userHandle: string; // base64url
  readonly privateKey: JsonWebKey;
  readonly prfSecret: string; // base64url
  counter: number;
}

type Cbor = number | string | boolean | Uint8Array | Map<number | string, Cbor>;
/** The CBOR subset WebAuthn needs: small ints, text, bytes, booleans and maps. */
function cbor(value: Cbor): Uint8Array {
  const head = (major: number, n: number): number[] =>
    n < 24
      ? [(major << 5) | n]
      : n < 0x100
        ? [(major << 5) | 24, n]
        : [(major << 5) | 25, n >> 8, n & 0xff];
  if (typeof value === 'boolean') return Uint8Array.of(value ? 0xf5 : 0xf4);
  if (typeof value === 'number')
    return Uint8Array.from(value >= 0 ? head(0, value) : head(1, -1 - value));
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return Uint8Array.from([...head(3, bytes.length), ...bytes]);
  }
  if (value instanceof Uint8Array) return Uint8Array.from([...head(2, value.length), ...value]);
  const parts = [...value].flatMap(([k, v]) => [...cbor(k), ...cbor(v)]);
  return Uint8Array.from([...head(5, value.size), ...parts]);
}

/** WebCrypto's ECDSA signature is r || s; WebAuthn carries DER. */
function derSignature(raw: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array): number[] => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    const body = [...bytes.subarray(i)];
    if ((body[0] ?? 0) & 0x80) body.unshift(0);
    return [0x02, body.length, ...body];
  };
  const body = [...integer(raw.subarray(0, 32)), ...integer(raw.subarray(32))];
  return Uint8Array.from([0x30, body.length, ...body]);
}

const sha256 = async (data: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data)));
const buffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;
const bytesOf = (source: BufferSource): Uint8Array =>
  source instanceof ArrayBuffer
    ? new Uint8Array(source)
    : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
const notAllowed = (message: string): DOMException => new DOMException(message, 'NotAllowedError');

/** A CredentialsContainer stand-in over `storage`, answering for pages at `origin`. */
export function createMockCredentials(opts: {
  storage: MockPasskeyStorage;
  origin: string;
}): CredentialsContainer & { readonly mock: true } {
  const origin = new TextEncoder().encode(opts.origin);
  const load = (): StoredCredential[] =>
    JSON.parse(opts.storage.getItem(MOCK_PASSKEY_STORAGE_KEY) ?? '[]') as StoredCredential[];
  const save = (all: StoredCredential[]): void =>
    opts.storage.setItem(MOCK_PASSKEY_STORAGE_KEY, JSON.stringify(all));

  /** rpIdHash (32) | flags | signCount (4, big-endian) | rest. */
  const authenticatorData = async (
    rpId: string,
    flags: number,
    counter: number,
    rest: Uint8Array = new Uint8Array(),
  ): Promise<Uint8Array> => {
    const data = new Uint8Array(37 + rest.length);
    data.set(await sha256(new TextEncoder().encode(rpId)));
    data[32] = flags;
    new DataView(data.buffer).setUint32(33, counter);
    data.set(rest, 37);
    return data;
  };

  const prfResults = async (stored: StoredCredential, salts: AuthenticationExtensionsPRFValues) => {
    const key = await crypto.subtle.importKey(
      'raw',
      buffer(fromBase64url(stored.prfSecret)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const evaluate = (salt: BufferSource) => crypto.subtle.sign('HMAC', key, buffer(bytesOf(salt)));
    return {
      first: await evaluate(salts.first),
      ...(salts.second !== undefined && { second: await evaluate(salts.second) }),
    };
  };

  return {
    mock: true,
    async create(options?: CredentialCreationOptions): Promise<Credential | null> {
      const pk = options?.publicKey;
      if (!pk) throw new DOMException('mock passkey: publicKey options only', 'NotSupportedError');
      if (!pk.pubKeyCredParams.some((p) => p.alg === -7)) {
        throw new DOMException('mock passkey: ES256 only', 'NotSupportedError');
      }
      const rpId = pk.rp.id ?? new URL(opts.origin).hostname;
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
        'sign',
        'verify',
      ]);
      const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
      const point = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)); // 04 | x | y
      const id = crypto.getRandomValues(new Uint8Array(16));
      const stored: StoredCredential = {
        id: base64url(id),
        rpId,
        userHandle: base64url(bytesOf(pk.user.id)),
        privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey),
        prfSecret: base64url(crypto.getRandomValues(new Uint8Array(32))),
        counter: 0,
      };
      save([...load(), stored]);

      const coseKey = cbor(
        new Map<number, Cbor>([
          [1, 2], // kty: EC2
          [3, -7], // alg: ES256
          [-1, 1], // crv: P-256
          [-2, point.subarray(1, 33)],
          [-3, point.subarray(33, 65)],
        ]),
      );
      // AAGUID (16 zero bytes) | credential id length (2) | credential id | COSE key
      const attested = Uint8Array.from([
        0,
        0,
        ...new Uint8Array(14),
        0,
        id.length,
        ...id,
        ...coseKey,
      ]);
      const authData = await authenticatorData(rpId, 0x45, 0, attested); // UP | UV | AT
      const clientData = new TextEncoder().encode(
        JSON.stringify({
          type: 'webauthn.create',
          challenge: base64url(bytesOf(pk.challenge)),
          origin: opts.origin,
          crossOrigin: false,
        }),
      );
      const attestationObject = cbor(
        new Map<string, Cbor>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ]),
      );
      const prfAsked = pk.extensions?.prf !== undefined;
      return {
        id: stored.id,
        type: 'public-key',
        rawId: buffer(id),
        authenticatorAttachment: 'platform',
        response: {
          clientDataJSON: buffer(clientData),
          attestationObject: buffer(attestationObject),
          getAuthenticatorData: () => buffer(authData),
          getPublicKey: () => buffer(spki),
          getPublicKeyAlgorithm: () => -7,
          getTransports: () => ['internal'],
        },
        getClientExtensionResults: () => (prfAsked ? { prf: { enabled: true } } : {}),
      } as unknown as PublicKeyCredential;
    },

    async get(options?: CredentialRequestOptions): Promise<Credential | null> {
      const pk = options?.publicKey;
      if (!pk) throw new DOMException('mock passkey: publicKey options only', 'NotSupportedError');
      const rpId = pk.rpId ?? new URL(opts.origin).hostname;
      const all = load();
      const allowed = (pk.allowCredentials ?? []).map((c) => base64url(bytesOf(c.id)));
      const candidates = all.filter(
        (c) => c.rpId === rpId && (allowed.length === 0 || allowed.includes(c.id)),
      );
      // A discoverable prompt picks the most recently created passkey for this relying party.
      const stored = candidates.at(-1);
      if (!stored) throw notAllowed('mock passkey: no matching credential (create one first)');
      stored.counter += 1;
      save(all);

      const salts = pk.extensions?.prf?.eval;
      // A PRF ceremony carries extension data (ED flag, a CBOR map), as hmac-secret does.
      const authData = salts
        ? await authenticatorData(
            rpId,
            0x85,
            stored.counter,
            cbor(new Map([['hmac-secret', crypto.getRandomValues(new Uint8Array(32))]])),
          )
        : await authenticatorData(rpId, 0x05, stored.counter);
      const clientData = clientDataJSON(bytesOf(pk.challenge), origin);
      const message = Uint8Array.from([...authData, ...(await sha256(clientData))]);
      const privateKey = await crypto.subtle.importKey(
        'jwk',
        stored.privateKey,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign'],
      );
      const raw = new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, message),
      );
      const results = salts ? await prfResults(stored, salts) : undefined;
      return {
        id: stored.id,
        type: 'public-key',
        rawId: buffer(fromBase64url(stored.id)),
        authenticatorAttachment: 'platform',
        response: {
          authenticatorData: buffer(authData),
          clientDataJSON: buffer(clientData),
          signature: buffer(derSignature(raw)),
          userHandle: buffer(fromBase64url(stored.userHandle)),
        },
        getClientExtensionResults: () => (results ? { prf: { results } } : {}),
      } as unknown as PublicKeyCredential;
    },

    async store(): Promise<undefined> {
      throw new DOMException('mock passkey: store is not supported', 'NotSupportedError');
    },
    async preventSilentAccess(): Promise<void> {},
  };
}

/** Replaces `navigator.credentials` with the mock, persisting in this origin's localStorage. */
export function installMockPasskey(): void {
  const mock = createMockCredentials({ storage: localStorage, origin: location.origin });
  Object.defineProperty(navigator, 'credentials', { value: mock, configurable: true });
  console.warn(
    `MOCK PASSKEY — dev only: navigator.credentials is a software passkey stored in localStorage["${MOCK_PASSKEY_STORAGE_KEY}"].`,
  );
}
