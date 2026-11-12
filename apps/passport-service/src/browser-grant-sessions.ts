import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { P256PublicKey, WebAuthnPolicy } from '@input-output-hk/mn-passport-account/ports';
import {
  assertionMaterial,
  equalBytes,
  webauthnPolicy,
} from '@input-output-hk/mn-passport-adapter-webauthn';
import { HttpError, json, readJson, type Route } from '@input-output-hk/mn-passport-service';
import { z } from 'zod';
import { relayDigest, relayHex32 } from './browser-grant-admission.ts';
import type { BrowserGrantRelayOwner } from './routes/browser-grant.ts';

const challengeTtl = 60;
const sessionTtl = 300;
const capacity = 128;
const token = /^[A-Za-z0-9_-]{43}$/;
const challengePath = '/v1/browser-grant/session/challenge';
const verifyPath = '/v1/browser-grant/session/verify';

const identity = z.strictObject({
  account: relayHex32,
  credentialId: z
    .string()
    .min(2)
    .max(512)
    .regex(/^(?:[0-9a-f]{2})+$/),
});
const verify = identity.extend({
  challenge: z.string().regex(token),
  authenticatorData: z.string().regex(/^[0-9a-f]{74}$/),
  clientDataJSON: z.string().regex(/^[0-9a-f]{268}$/),
  signature: z
    .string()
    .min(16)
    .max(144)
    .regex(/^(?:[0-9a-f]{2})+$/),
});
type Identity = z.infer<typeof identity>;

export interface LiveP256GrantOwner {
  readonly publicKey: P256PublicKey;
  readonly policy: WebAuthnPolicy;
  readonly deviceEpoch: bigint;
}

interface BrowserGrantSessionOptions {
  readonly issuer: string;
  /** Return only a currently enrolled P-256 owner for the requested account and credential ID. */
  readonly readOwner: (identity: Identity) => Promise<LiveP256GrantOwner | undefined>;
  readonly nowSeconds?: () => number;
}

interface Expiring {
  readonly expiresAt: number;
}

function sweep(map: Map<string, Expiring>, now: number) {
  for (const [key, entry] of map) if (entry.expiresAt <= now) map.delete(key);
}

function denied() {
  return new HttpError(401, 'Passport owner authentication failed.');
}

function ownerDigest(value: Identity, owner: LiveP256GrantOwner) {
  return relayDigest(
    JSON.stringify([
      'mn-passport:browser-grant-owner:v1',
      value.account,
      value.credentialId,
      owner.publicKey.x.toString(16),
      owner.publicKey.y.toString(16),
      Buffer.from(owner.policy.origin).toString('hex'),
      Buffer.from(owner.policy.rp_id_hash).toString('hex'),
    ]),
  );
}

function isBrowserRequest(req: IncomingMessage, issuer: string) {
  return req.headers.origin === issuer && req.headers['sec-fetch-site'] === 'same-origin';
}

export function createBrowserGrantSessions(options: BrowserGrantSessionOptions) {
  const issuer = new URL(options.issuer);
  if (issuer.protocol !== 'https:' || issuer.origin !== options.issuer)
    throw new Error('Browser grant owner sessions require a canonical HTTPS issuer.');
  const policy = webauthnPolicy(issuer.hostname, issuer.origin);
  const now = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const challenges = new Map<string, Identity & Expiring>();
  const sessions = new Map<
    string,
    Identity &
      Expiring & {
        readonly credential: string;
        readonly deviceEpoch: bigint;
      }
  >();

  async function live(value: Identity) {
    const owner = await options.readOwner(value);
    if (
      !owner ||
      !equalBytes(owner.policy.origin, policy.origin) ||
      !equalBytes(owner.policy.rp_id_hash, policy.rp_id_hash)
    )
      throw denied();
    return owner;
  }

  async function verifyOwner(data: z.infer<typeof verify>) {
    const original = challenges.get(data.challenge);
    if (
      !original ||
      original.expiresAt <= now() ||
      original.account !== data.account ||
      original.credentialId !== data.credentialId
    )
      throw denied();
    challenges.delete(data.challenge);
    const owner = await live(original);
    if (original.expiresAt <= now()) throw denied();
    try {
      assertionMaterial(Buffer.from(data.challenge, 'base64url'), policy, owner.publicKey, {
        authenticatorData: Buffer.from(data.authenticatorData, 'hex'),
        clientDataJSON: Buffer.from(data.clientDataJSON, 'hex'),
        signature: Buffer.from(data.signature, 'hex'),
      });
    } catch {
      throw denied();
    }
    sweep(sessions, now());
    if (sessions.size >= capacity) throw new HttpError(429, 'Too many owner sessions.');
    const session = randomBytes(32).toString('base64url');
    const expiresAt = now() + sessionTtl;
    sessions.set(relayDigest(session), {
      account: original.account,
      credentialId: original.credentialId,
      credential: ownerDigest(original, owner),
      deviceEpoch: owner.deviceEpoch,
      expiresAt,
    });
    return { session, expiresAt };
  }

  const route: Route = async (req, res, url) => {
    if (url.pathname !== challengePath && url.pathname !== verifyPath) return false;
    res.setHeader('cache-control', 'no-store');
    if (!isBrowserRequest(req, issuer.origin))
      throw new HttpError(403, 'Owner authentication requires the issuer origin.');
    if (req.method !== 'POST' || req.url !== url.pathname)
      throw new HttpError(404, 'Unknown browser grant session operation.');
    const body = await readJson(req, 2048);
    if (url.pathname === verifyPath) {
      const data = verify.safeParse(body);
      if (!data.success) throw denied();
      json(res, 200, await verifyOwner(data.data));
    } else {
      const data = identity.safeParse(body);
      if (!data.success) throw denied();
      const time = now();
      sweep(challenges, time);
      if (challenges.size >= capacity) throw new HttpError(429, 'Too many owner challenges.');
      const challenge = randomBytes(32).toString('base64url');
      const expiresAt = time + challengeTtl;
      challenges.set(challenge, { ...data.data, expiresAt });
      json(res, 200, { challenge, expiresAt });
    }
    return true;
  };

  async function authenticate(
    req: IncomingMessage,
    account: string,
  ): Promise<BrowserGrantRelayOwner | undefined> {
    const header = req.headers.authorization;
    if (!isBrowserRequest(req, issuer.origin) || typeof header !== 'string') return undefined;
    const bearer = /^PassportGrant ([A-Za-z0-9_-]{43})$/.exec(header)?.[1];
    if (!bearer) return undefined;
    const key = relayDigest(bearer);
    const session = sessions.get(key);
    if (!session || session.account !== account || session.expiresAt <= now()) return undefined;
    return {
      account,
      bindingId: 'acc-s3r1.1',
      networkId: 'undeployed',
      credential: session.credential,
      async current() {
        const valid = () => sessions.get(key) === session && session.expiresAt > now();
        if (!valid()) return false;
        try {
          const owner = await live(session);
          if (
            owner.deviceEpoch !== session.deviceEpoch ||
            session.credential !== ownerDigest(session, owner)
          ) {
            sessions.delete(key);
            return false;
          }
          return valid();
        } catch (error) {
          if (error instanceof HttpError && error.status === 401) sessions.delete(key);
          return false;
        }
      },
    };
  }

  return { route, authenticate };
}
