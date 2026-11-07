// Shared software authenticator: real ES256, deterministic synthetic PRF; no provider/browser UI.
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { clientDataJSON } from '../../packages/adapter-webauthn/dist/index.js';
export const ORIGIN = 'http://localhost:5173';
export const RP = 'localhost';
export const ID = Uint8Array.of(1, 2, 3, 4);

/**
 * @typedef {{
 *   challenge: Uint8Array;
 *   rpId?: string;
 *   allowCredentials?: { type: string; id: Uint8Array }[];
 *   extensions?: { prf?: { eval: { first: Uint8Array; second?: Uint8Array } } };
 * }} GetOptions
 * @typedef {{
 *   challenge: Uint8Array;
 *   hints?: string[];
 *   extensions?: { prf?: { eval?: { first: Uint8Array; second?: Uint8Array } } };
 * }} CreateOptions
 * What a create that asks for PRF answers: `enabled` only, `enabled` and the results (GPM), or no
 * `enabled` member at all.
 * @typedef {'enabled' | 'results' | 'missing'} PrfAtCreate
 * @typedef {{ prf?: boolean; atCreate?: PrfAtCreate; cancel?: string; highS?: boolean; empty?: boolean }} AuthenticatorOptions
 * What the next signing assertion carries; tests change it between ceremonies.
 * @typedef {{ flags: number; extensionData: boolean; rp: string; wrongChallenge: boolean }} Behaviour
 */

/** @param {Uint8Array} bytes @returns {ArrayBuffer} */
const buffer = (bytes) => bytes.slice().buffer;
/** @param {bigint} n @returns {Uint8Array} A minimal positive DER INTEGER. */
function derInteger(n) {
  let body = Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
  while (body.length > 1 && body[0] === 0 && !((body[1] ?? 0) & 0x80)) body = body.subarray(1);
  if ((body[0] ?? 0) & 0x80) body = Buffer.concat([Buffer.of(0), body]);
  return Uint8Array.from([2, body.length, ...body]);
}
/** @param {bigint} r @param {bigint} s */
function derSignature(r, s) {
  const body = [...derInteger(r), ...derInteger(s)];
  return Uint8Array.from([0x30, body.length, ...body]);
}

/** A software authenticator behind a CredentialsContainer-shaped fake. @param {AuthenticatorOptions} [opts] */
export function softwareAuthenticator({
  prf = true,
  atCreate = 'enabled',
  cancel,
  highS = false,
  empty = false,
} = {}) {
  const sk = p256.utils.randomSecretKey();
  const pub = p256.getPublicKey(sk, false); // 0x04 || x || y
  const spki = new Uint8Array([
    ...Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'),
    ...pub,
  ]);
  /** @type {Behaviour} */
  const behaviour = { flags: 5, extensionData: false, rp: RP, wrongChallenge: false };
  const grease = { remaining: 0 };
  const prfControl = { cancelled: false, unavailable: false, wrongCredential: false };
  const authenticatorData = () =>
    new Uint8Array([
      ...sha256(new TextEncoder().encode(behaviour.rp)),
      behaviour.flags,
      0,
      0,
      0,
      1,
      ...(behaviour.extensionData ? [0xa1, 0x60, 0x00] : []), // a CBOR extensions map
    ]);
  const cancelled = () => Object.assign(new Error('prompt dismissed'), { name: cancel });
  /** A stand-in PRF: a deterministic function of each salt, as the real extension is. */
  const evaluate = (/** @type {{ first: Uint8Array; second?: Uint8Array }} */ salts) => ({
    first: buffer(sha256(new Uint8Array(salts.first))),
    ...(salts.second && { second: buffer(sha256(new Uint8Array(salts.second))) }),
  });
  /** @type {GetOptions[]} */
  const gets = [];
  /** @type {CreateOptions[]} */
  const creates = [];
  return {
    pub,
    gets,
    creates,
    behaviour,
    grease,
    prfControl,
    container: {
      /** @param {{ publicKey: CreateOptions }} options */
      async create({ publicKey }) {
        if (cancel) throw cancelled();
        creates.push(publicKey);
        const salts = publicKey.extensions?.prf?.eval;
        // What a provider reports for the PRF extension requested at creation.
        const reported =
          !prf || atCreate === 'enabled'
            ? { enabled: prf }
            : atCreate === 'results'
              ? { enabled: true, ...(salts && { results: evaluate(salts) }) }
              : {};
        return {
          rawId: buffer(ID),
          response: { getPublicKey: () => buffer(spki), getPublicKeyAlgorithm: () => -7 },
          getClientExtensionResults: () => ({ prf: reported }),
        };
      },
      /** @param {{ publicKey: GetOptions }} options */
      async get({ publicKey }) {
        if (cancel) throw cancelled();
        gets.push(publicKey);
        if (empty) return null;
        if (publicKey.extensions?.prf) {
          if (prfControl.cancelled)
            throw Object.assign(new Error('prompt dismissed'), { name: 'NotAllowedError' });
          if (!prf || prfControl.unavailable)
            return { rawId: buffer(ID), getClientExtensionResults: () => ({}) };
          const results = evaluate(publicKey.extensions.prf.eval);
          return {
            rawId: buffer(prfControl.wrongCredential ? ID.map((x) => x ^ 1) : ID),
            getClientExtensionResults: () => ({ prf: { results } }),
          };
        }
        const authData = authenticatorData();
        const asked = new Uint8Array(publicKey.challenge);
        let clientData = clientDataJSON(
          behaviour.wrongChallenge ? asked.map((v) => v ^ 1) : asked,
          new TextEncoder().encode(ORIGIN),
        );
        if (grease.remaining > 0) {
          grease.remaining--;
          clientData = new TextEncoder().encode(
            new TextDecoder().decode(clientData).slice(0, -1) +
              ',"other_keys_can_be_added_here":"do not compare clientDataJSON against a template. See https://goo.gl/yabPex"}',
          );
        }
        const message = new Uint8Array([...authData, ...sha256(clientData)]);
        let signature = p256.sign(message, sk, { format: 'der', prehash: true });
        if (highS) {
          // The same signature with s replaced by n - s: valid ES256, rejected by low-S-only checkers.
          const { r, s } = p256.Signature.fromBytes(signature, 'der');
          signature = derSignature(r, p256.Point.Fn.ORDER - s);
        }
        return {
          rawId: buffer(ID),
          response: {
            authenticatorData: buffer(authData),
            clientDataJSON: buffer(clientData),
            signature: buffer(signature),
          },
        };
      },
    },
  };
}
