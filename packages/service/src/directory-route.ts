import type { ServiceWire } from '@input-output-hk/mn-passport-protocol';
import { HttpError, json, readJson, type Route } from './http.js';

const PATH = /^\/v1\/accounts\/([a-z0-9-]{1,32})\/([0-9a-f]{2,512})$/;
const ADDRESS = /^[0-9a-f]{64}$/;
const COORDINATE = /^(0|[1-9a-f][0-9a-f]{0,63})$/;
const HEX = /^(?:[0-9a-f]{2})+$/;
const MAX_BODY = 64 * 1024;

/** Storage must compare and write atomically; the host owns persistence and process coordination. */
export interface DirectoryStore {
  read(networkId: string, key: string): Promise<ServiceWire.AccountHintBody | undefined>;
  compareAndSet(
    networkId: string,
    key: string,
    expected: ServiceWire.AccountHintBody | undefined,
    next: ServiceWire.AccountHintBody,
  ): Promise<boolean>;
}

/** Optional possession check for a caller that supplies an ownership proof. */
export interface OwnershipVerifier {
  verify(
    networkId: string,
    key: string,
    hint: ServiceWire.AccountHintBody,
    proof: ServiceWire.OwnershipProofBody,
  ): Promise<boolean>;
}

export interface DirectoryRouteOptions {
  readonly networkId: string;
  readonly store: DirectoryStore;
  readonly verifier?: OwnershipVerifier;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function point(value: unknown): ServiceWire.PointBody {
  if (
    !record(value) ||
    typeof value.x !== 'string' ||
    typeof value.y !== 'string' ||
    !COORDINATE.test(value.x) ||
    !COORDINATE.test(value.y)
  )
    throw new HttpError(400, 'invalid directory public key');
  return { x: value.x, y: value.y };
}

/** Project only wire fields; never persist unexpected or secret request members. */
function hintOf(value: unknown, key: string): ServiceWire.AccountHintBody {
  if (!record(value) || !ADDRESS.test(String(value.address)) || value.credentialId !== key)
    throw new HttpError(400, 'invalid directory hint');
  const scheme = value.scheme;
  if (scheme !== 'p256-webauthn' && scheme !== 'jubjub-schnorr' && scheme !== 'k256-ecdsa')
    throw new HttpError(400, 'invalid directory scheme');
  if (value.status !== 'deployed' && value.status !== 'active')
    throw new HttpError(400, 'invalid directory status');
  if (
    (value.salt !== undefined && (typeof value.salt !== 'string' || !ADDRESS.test(value.salt))) ||
    (value.status === 'deployed' && value.salt === undefined)
  )
    throw new HttpError(400, 'invalid directory salt');
  let policy: ServiceWire.AccountHintBody['policy'];
  if (scheme === 'p256-webauthn') {
    if (
      !record(value.policy) ||
      typeof value.policy.rp_id_hash !== 'string' ||
      typeof value.policy.origin !== 'string' ||
      !ADDRESS.test(value.policy.rp_id_hash) ||
      !/^[0-9a-f]{42}$/.test(value.policy.origin)
    )
      throw new HttpError(400, 'invalid directory WebAuthn policy');
    policy = { rp_id_hash: value.policy.rp_id_hash, origin: value.policy.origin };
  } else if (value.policy !== undefined) {
    throw new HttpError(400, 'unexpected directory WebAuthn policy');
  }
  let keyEntries: readonly string[] | undefined;
  if (value.keyEntries !== undefined) {
    if (
      scheme !== 'jubjub-schnorr' ||
      !Array.isArray(value.keyEntries) ||
      value.keyEntries.length > 16 ||
      !value.keyEntries.every((entry) => typeof entry === 'string' && /^[0-9a-f]{384}$/.test(entry))
    )
      throw new HttpError(400, 'invalid sealed directory entries');
    keyEntries = [...value.keyEntries] as string[];
  }
  return {
    address: value.address as string,
    scheme,
    credentialId: key,
    publicKey: point(value.publicKey),
    ...(policy === undefined ? {} : { policy }),
    ...(value.salt === undefined ? {} : { salt: value.salt as string }),
    ...(keyEntries === undefined ? {} : { keyEntries }),
    status: value.status,
  };
}

function proofOf(
  value: unknown,
  scheme: ServiceWire.AccountHintBody['scheme'],
): ServiceWire.OwnershipProofBody {
  if (
    !record(value) ||
    value.scheme !== scheme ||
    typeof value.challenge !== 'string' ||
    !HEX.test(value.challenge)
  )
    throw new HttpError(400, 'invalid directory ownership proof');
  if (scheme === 'p256-webauthn') {
    if (
      typeof value.authenticatorData !== 'string' ||
      !HEX.test(value.authenticatorData) ||
      typeof value.clientDataJSON !== 'string' ||
      !HEX.test(value.clientDataJSON) ||
      typeof value.signature !== 'string' ||
      !HEX.test(value.signature)
    )
      throw new HttpError(400, 'invalid directory WebAuthn proof');
    return {
      scheme,
      challenge: value.challenge,
      authenticatorData: value.authenticatorData,
      clientDataJSON: value.clientDataJSON,
      signature: value.signature,
    };
  }
  if (scheme === 'jubjub-schnorr' && typeof value.sigS === 'string' && COORDINATE.test(value.sigS))
    return { scheme, challenge: value.challenge, sigR: point(value.sigR), sigS: value.sigS };
  throw new HttpError(400, 'invalid directory Schnorr proof');
}

/** A directory hint is an untrusted pointer; the account core verifies it against the ACC. */
export function directoryRoute(options: DirectoryRouteOptions): Route {
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/v1/accounts/')) return false;
    const match = PATH.exec(url.pathname);
    if (!match || match[2]!.length % 2 !== 0) throw new HttpError(400, 'invalid directory path');
    const networkId = match[1]!;
    const key = match[2]!;
    if (networkId !== options.networkId) throw new HttpError(404, 'network not found');
    if (req.method === 'GET') {
      const hint = await options.store.read(networkId, key);
      if (!hint) throw new HttpError(404, 'account not found');
      let publicHint: ServiceWire.AccountHintBody;
      try {
        publicHint = hintOf(hint, key);
      } catch {
        throw new HttpError(500, 'stored directory hint is invalid');
      }
      json(res, 200, publicHint);
      return true;
    }
    if (req.method !== 'PUT') return false;
    const body = await readJson(req, MAX_BODY);
    if (!record(body)) throw new HttpError(400, 'request body must be a JSON object');
    const next = hintOf(body.hint, key);
    if (body.proof !== undefined) {
      const proof = proofOf(body.proof, next.scheme);
      if (!options.verifier) throw new HttpError(501, 'ownership proof verifier unavailable');
      if (!(await options.verifier.verify(networkId, key, next, proof)))
        throw new HttpError(403, 'ownership proof refused');
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const stored = await options.store.read(networkId, key);
      let current: ServiceWire.AccountHintBody | undefined;
      if (stored) {
        try {
          current = hintOf(stored, key);
        } catch {
          throw new HttpError(500, 'stored directory hint is invalid');
        }
      }
      if (current) {
        const identity = (hint: ServiceWire.AccountHintBody) =>
          JSON.stringify({ ...hint, status: undefined });
        if (
          identity(current) !== identity(next) ||
          (current.status === 'active' && next.status === 'deployed')
        )
          throw new HttpError(409, 'account hint is write-once');
        if (current.status === next.status) {
          res.writeHead(204);
          res.end();
          return true;
        }
      }
      if (await options.store.compareAndSet(networkId, key, current, next)) {
        res.writeHead(204);
        res.end();
        return true;
      }
    }
    throw new HttpError(409, 'directory changed during update');
  };
}
