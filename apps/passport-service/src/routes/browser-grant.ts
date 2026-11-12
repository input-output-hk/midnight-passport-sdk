import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { createBrowserGrantNonceStore } from '@input-output-hk/mn-passport-account';
import type {
  MutationSubmissionContext,
  MutationByteStore,
} from '@input-output-hk/mn-passport-account/ports';
import {
  verifyOriginalBrowserP256GrantRequest,
  verifyRetainedBrowserP256GrantRequest,
  type VerifiedBrowserP256GrantRequest,
} from '@input-output-hk/mn-passport-adapter-webauthn';
import { MAX_HOST_GRANT_ISSUE_BYTES } from '@input-output-hk/mn-passport-protocol';
import {
  hostHash,
  HttpError,
  json,
  readJson,
  type Route,
} from '@input-output-hk/mn-passport-service';
import { z } from 'zod';
import {
  createBrowserGrantDispatchStore,
  relayDigest,
  relayHex32,
  relayUnsettled,
} from '../browser-grant-admission.ts';
import { browserGrantHostInput } from '../browser-grant-sponsor.ts';

const root = '/v1/browser-grant';
const networkId = 'undeployed';
const bindingId = 'acc-s3r1.1';
const maxFragment = 16_400;
const circuit = 'issue_grant_with_p256';
const input = z.strictObject({ account: relayHex32, fragment: z.string().max(maxFragment) });
const original = input.extend({ requestId: z.uuid(), intentSha256: relayHex32 });
const issue = original.extend({
  proved: z
    .string()
    .min(2)
    .max(MAX_HOST_GRANT_ISSUE_BYTES * 2)
    .regex(/^[0-9a-f]+$/)
    .refine((value) => value.length % 2 === 0),
});
const receipt = z.object({
  txHash: relayHex32,
  blockHeight: z.number().int().nonnegative().optional(),
});

const operation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('claim'), data: input }),
  z.object({ action: z.literal('read'), data: input }),
  z.object({ action: z.literal('execute'), data: issue }),
  z.object({ action: z.literal('reconcile'), data: original }),
]);

export interface BrowserGrantRelayOwner {
  /** Stable opaque digest identifying the verified credential across renewed sessions. */
  readonly credential: string;
  readonly account: string;
  readonly networkId: string;
  readonly bindingId: string;
  /** Checks the request's exact authenticated session, expiry and live owner membership. */
  current(): Promise<boolean>;
}

export interface BrowserGrantRelayOptions {
  readonly issuer: string;
  readonly store: MutationByteStore;
  /** Must authenticate the browser session. This route checks origin separately. */
  readonly authenticate: (
    request: IncomingMessage,
    account: string,
  ) => Promise<BrowserGrantRelayOwner | undefined>;
  readonly sponsor: {
    execute(
      bytes: Uint8Array,
      request: MutationSubmissionContext & { readonly address: string; readonly circuit: string },
      context: BrowserGrantRelayContext,
    ): Promise<unknown>;
    reconcile(
      original: { readonly requestId: string; readonly intentSha256: string },
      context: BrowserGrantRelayContext,
    ): Promise<unknown>;
  };
  readonly nowSeconds?: () => number;
}

export interface BrowserGrantRelayContext {
  readonly signal: AbortSignal;
  readonly beforeDispatch: () => Promise<boolean>;
  readonly expectedInputSha256?: string;
}

type Admission = {
  readonly holder: VerifiedBrowserP256GrantRequest;
  readonly owner: BrowserGrantRelayOwner;
};

const notAuthenticated = () => new HttpError(401, 'An active Passport owner session is required.');

function requireFresh({ holder }: Admission, now: number) {
  if (now > holder.validUntilSeconds || now >= (holder.scope.expiresAt ?? 0))
    throw new HttpError(409, 'The signed grant request expired.');
}

function dispatchSignal(res: Parameters<Route>[1]): AbortSignal {
  const controller = new AbortController();
  if (res.destroyed) controller.abort();
  res.once('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}

async function admit(
  request: IncomingMessage,
  data: z.infer<typeof input>,
  options: BrowserGrantRelayOptions,
  now: number,
  readOnly: boolean,
): Promise<Admission> {
  const owner = await options.authenticate(request, data.account);
  if (
    !owner ||
    owner.account !== data.account ||
    owner.networkId !== networkId ||
    owner.bindingId !== bindingId ||
    !relayHex32.safeParse(owner.credential).success ||
    (await owner.current()) !== true
  )
    throw notAuthenticated();

  let holder: VerifiedBrowserP256GrantRequest;
  try {
    const verify = readOnly
      ? verifyRetainedBrowserP256GrantRequest
      : verifyOriginalBrowserP256GrantRequest;
    holder = verify(data.fragment, {
      authoriserOrigin: options.issuer,
      networkId,
      account: data.account,
      nowSeconds: now,
    });
  } catch {
    throw new HttpError(400, 'The signed holder request is invalid.');
  }
  return { holder, owner };
}

function nonceIntent({ holder, owner }: Admission, issuer: string) {
  return {
    issuer,
    networkId,
    account: owner.account,
    requestDigest: relayDigest(JSON.stringify([holder.requestDigest, owner.credential])),
    nonce: holder.nonce,
    validUntilSeconds: holder.validUntilSeconds,
  };
}

/** Standalone reference composition. Mount only behind a same-origin HTTPS host. */
export function browserGrantRelay(options: BrowserGrantRelayOptions): Route {
  const origin = new URL(options.issuer);
  if (origin.origin !== options.issuer || origin.protocol !== 'https:')
    throw new Error('Browser grant relay requires a canonical HTTPS issuer.');
  const now = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const nonces = createBrowserGrantNonceStore(options.store, randomUUID);
  const dispatches = createBrowserGrantDispatchStore(options.store);

  function dispatchContext(admission: Admission, signal: AbortSignal): BrowserGrantRelayContext {
    return {
      signal,
      async beforeDispatch() {
        const allowed = await admission.owner.current();
        requireFresh(admission, now());
        return allowed;
      },
    };
  }

  async function execute(data: z.infer<typeof issue>, admission: Admission, signal: AbortSignal) {
    requireFresh(admission, now());
    const { requestId, intentSha256, account: address } = data;
    const request = {
      requestId,
      intentSha256,
      address,
      circuit,
      validUntilSeconds: admission.holder.validUntilSeconds,
    };
    const hostInputSha256 = hostHash(browserGrantHostInput(data.proved, request));
    if (!(await dispatches.reserve(requestId, { intentSha256, hostInputSha256 })))
      throw relayUnsettled();
    requireFresh(admission, now());
    if ((await admission.owner.current()) !== true || signal.aborted) throw relayUnsettled();
    requireFresh(admission, now());
    return options.sponsor.execute(
      Buffer.from(data.proved, 'hex'),
      request,
      dispatchContext(admission, signal),
    );
  }

  return async (req, res, url) => {
    if (!url.pathname.startsWith(root + '/')) return false;
    res.setHeader('cache-control', 'no-store');
    if (req.headers.origin !== options.issuer || req.headers['sec-fetch-site'] !== 'same-origin')
      throw new HttpError(403, 'Browser grant requests require the issuer origin.');
    const action = url.pathname.slice(root.length + 1);
    if (
      req.method !== 'POST' ||
      req.url !== url.pathname ||
      !['claim', 'read', 'execute', 'reconcile'].includes(action)
    )
      throw new HttpError(404, 'Unknown browser grant operation.');
    const body = await readJson(
      req,
      action === 'execute' ? MAX_HOST_GRANT_ISSUE_BYTES * 2 + maxFragment + 512 : maxFragment + 512,
    );
    const parsed = operation.safeParse({ action, data: body });
    if (!parsed.success) throw new HttpError(400, 'Malformed browser grant request.');
    const command = parsed.data;
    const admission = await admit(
      req,
      command.data,
      options,
      now(),
      command.action === 'read' || command.action === 'reconcile',
    );
    const nonce = nonceIntent(admission, options.issuer);
    try {
      if (command.action === 'claim') {
        requireFresh(admission, now());
        const claimed = await nonces.claim(nonce);
        if ((await admission.owner.current()) !== true) throw notAuthenticated();
        json(res, 200, claimed);
      } else {
        const requestId = await nonces.read(nonce);
        if (command.action === 'read') {
          if ((await admission.owner.current()) !== true) throw notAuthenticated();
          json(res, 200, { requestId });
          return true;
        }
        if (!requestId || command.data.requestId !== requestId) throw relayUnsettled();
        const signal = dispatchSignal(res);
        const result =
          command.action === 'execute'
            ? await execute(command.data, admission, signal)
            : await reconcile(command.data, admission, signal);
        // A confirmed original belongs to this already authenticated invocation.
        // Session expiry after the send fence must not erase its receipt.
        json(
          res,
          result === undefined ? 202 : 200,
          result === undefined ? {} : receipt.parse(result),
        );
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw relayUnsettled();
    }
    return true;
  };

  async function reconcile(
    { requestId, intentSha256 }: z.infer<typeof original>,
    admission: Admission,
    signal: AbortSignal,
  ) {
    const dispatch = await dispatches.read(requestId);
    if (dispatch?.intentSha256 !== intentSha256) throw relayUnsettled();
    if ((await admission.owner.current()) !== true || signal.aborted) throw relayUnsettled();
    return options.sponsor.reconcile(
      { requestId, intentSha256 },
      { ...dispatchContext(admission, signal), expectedInputSha256: dispatch.hostInputSha256 },
    );
  }
}
