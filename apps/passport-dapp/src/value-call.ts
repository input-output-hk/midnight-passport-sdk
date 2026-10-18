import type { CallRequest, TxResult } from '@input-output-hk/mn-passport-account/ports';
import { tracedFetch } from './operation-trace.js';

/** The server receives circuit arguments, never an arbitrary transaction to sign. */
export async function demoValueCall(serviceUrl: string, request: CallRequest): Promise<TxResult> {
  if (
    request.heldCoin ||
    ![
      'withdraw_unshielded_with_p256',
      'withdraw_unshielded_with_jubjub',
      'withdraw_unshielded_with_grant_jubjub',
    ].includes(request.circuit)
  )
    throw new Error('This demo value route does not support the requested circuit.');
  const response = await tracedFetch(`${serviceUrl}/v1/demo/value-call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(request.signal && { signal: request.signal }),
    body: JSON.stringify(
      { accountAddress: request.address, circuit: request.circuit, args: request.args },
      (_key, value: unknown) =>
        typeof value === 'bigint'
          ? { $bigint: value.toString() }
          : value instanceof Uint8Array
            ? { $bytes: Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('') }
            : value,
    ),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    throw new Error(typeof body.error === 'string' ? body.error : 'Value call failed.');
  if (typeof body.txHash !== 'string' || !/^[0-9a-f]{64,66}$/i.test(body.txHash))
    throw new Error('The value service returned an invalid transaction ID.');
  return {
    txHash: body.txHash,
    ...(typeof body.blockHeight === 'number' && { blockHeight: body.blockHeight }),
  };
}
