import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { MutationPins } from '@input-output-hk/mn-passport-account/ports';
import type { RemoteHostJobIdentity } from './host-jobs.js';
import { toHex } from './hex.js';

export const HEX = /^[0-9a-f]{64}$/;
export const WATCH = /^(?:[0-9a-f]{64}|[0-9a-f]{66})$/;
const ID = /^[0-9a-f]{32}:(0|[1-9][0-9]{0,2})$/;
export const fail = (): never => {
  throw new PassportConnectorError(
    'MutationUnsettled',
    'Host job is unsettled. Retain the original identity and explicitly reconcile; do not create a replacement.',
  );
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export const fields = (
  v: unknown,
  allowed: readonly string[],
  required = allowed,
): v is Record<string, unknown> =>
  object(v) &&
  Object.keys(v).every((k) => allowed.includes(k)) &&
  required.every((k) => Object.hasOwn(v, k));
export const whole = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export const cursor = (v: unknown): v is string =>
  typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v) && whole(Number(v));
export const samePins = (a: MutationPins, b: MutationPins) =>
  a.networkId === b.networkId &&
  a.bindingId === b.bindingId &&
  a.manifestSha256 === b.manifestSha256 &&
  a.scheme === b.scheme;
export function identityCheck(i: RemoteHostJobIdentity): void {
  if (
    !fields(i, ['pins', 'requestId', 'intentSha256', 'kind']) ||
    !fields(i.pins, ['networkId', 'bindingId', 'manifestSha256', 'scheme']) ||
    typeof i.requestId !== 'string' ||
    !ID.test(i.requestId) ||
    Number(i.requestId.split(':')[1]) > 511 ||
    typeof i.intentSha256 !== 'string' ||
    !HEX.test(i.intentSha256) ||
    !['call', 'deploy'].includes(i.kind) ||
    typeof i.pins.networkId !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(i.pins.networkId) ||
    i.pins.bindingId !== 'acc-s3r1.1' ||
    i.pins.manifestSha256 !== '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f' ||
    !['p256-webauthn', 'jubjub-schnorr'].includes(i.pins.scheme)
  )
    fail();
}
/** Hash only the fixed scalar identity structure. No Node imports or kernel dependency. */
export async function identityHashes(i: RemoteHostJobIdentity) {
  identityCheck(i);
  const p = i.pins;
  const hash = async (text: string) =>
    toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
  return {
    jobId: (
      await hash(
        JSON.stringify({
          bindingId: p.bindingId,
          domain: 'mn-passport:host-job-id:v1',
          networkId: p.networkId,
          requestId: i.requestId,
        }),
      )
    ).slice(0, 32),
    identitySha256: await hash(
      JSON.stringify({
        intentSha256: i.intentSha256,
        kind: i.kind,
        pins: {
          bindingId: p.bindingId,
          manifestSha256: p.manifestSha256,
          networkId: p.networkId,
          scheme: p.scheme,
        },
        requestId: i.requestId,
      }),
    ),
  };
}
export function inputCheck(i: RemoteHostJobIdentity, input: unknown) {
  if (i.kind === 'deploy') {
    if (
      !fields(input, ['boot', 'encKey', 'retireAuthority', 'firstArm']) ||
      typeof input.boot !== 'string' ||
      !HEX.test(input.boot) ||
      typeof input.encKey !== 'string' ||
      !HEX.test(input.encKey) ||
      typeof input.retireAuthority !== 'boolean' ||
      input.firstArm !== (i.pins.scheme === 'p256-webauthn' ? 'p256' : 'jubjub')
    )
      fail();
  } else if (
    !fields(input, ['address', 'circuit', 'tx']) ||
    typeof input.address !== 'string' ||
    !HEX.test(input.address) ||
    typeof input.circuit !== 'string' ||
    !/^[a-z][a-z0-9_]{0,127}$/.test(input.circuit) ||
    typeof input.tx !== 'string' ||
    !/^(?:[0-9a-f]{2})+$/.test(input.tx)
  )
    fail();
  if (new TextEncoder().encode(JSON.stringify(input)).length > 4 * 1024 * 1024) fail();
}
