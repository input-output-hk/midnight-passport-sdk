import { PassportConnectorError } from '@input-output-hk/mn-passport-account';
import type { CallRequest, TxResult } from '@input-output-hk/mn-passport-account/ports';
import { tracedFetch } from './operation-trace.js';

/** The server receives circuit arguments, never an arbitrary transaction to sign. */
export async function demoValueCall(
  serviceUrl: string,
  request: CallRequest,
  requestId?: string,
): Promise<TxResult> {
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
      {
        accountAddress: request.address,
        circuit: request.circuit,
        args: request.args,
        ...(requestId !== undefined && { requestId }),
      },
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
  if (typeof body.txHash !== 'string' || !/^[0-9a-f]{64}(?:[0-9a-f]{2})?$/i.test(body.txHash))
    throw new Error('The value service returned an invalid transaction ID.');
  return {
    txHash: body.txHash.toLowerCase(),
    ...(typeof body.blockHeight === 'number' && { blockHeight: body.blockHeight }),
  };
}

/** Lock stops new sends, but must not discard the acknowledgement of a started value request. */
export function demoSessionValueCall(
  serviceUrl: string,
  request: CallRequest,
  requestId: string,
): Promise<TxResult> {
  if (request.signal?.aborted)
    return Promise.reject(
      new PassportConnectorError('Aborted', 'Session locked before value submission.'),
    );
  const { signal: _localKeyLifetime, ...observedRequest } = request;
  // The service may prove and submit after POST acceptance. Observe its response even if
  // the key is disposed meanwhile; a real transport loss still leaves the session blocked.
  return demoValueCall(serviceUrl, observedRequest, requestId);
}
