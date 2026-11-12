import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { AbortSignalLike } from '@input-output-hk/mn-passport-protocol';

export const browserGrantPath = '/v1/browser-grant/';
type Action = 'session/challenge' | 'session/verify' | 'claim' | 'read' | 'execute' | 'reconcile';

export const unsettledGrant = () =>
  new PassportConnectorError('MutationUnsettled', 'Reconcile the original browser grant request.');

async function responseObject(response: Response): Promise<Record<string, unknown>> {
  if (response.status === 202) {
    await response.body?.cancel();
    return {};
  }
  const reader = response.body?.getReader();
  if (!reader) throw unsettledGrant();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 2048) throw unsettledGrant();
      text += decoder.decode(next.value, { stream: true });
    }
    const result: unknown = JSON.parse(text + decoder.decode());
    if (typeof result !== 'object' || result === null || Array.isArray(result))
      throw unsettledGrant();
    return result as Record<string, unknown>;
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function browserGrantHttp(issuer: string, requestFetch: typeof fetch) {
  return async (
    action: Action,
    body: object,
    token?: string,
    ...signals: (AbortSignalLike | undefined)[]
  ): Promise<Record<string, unknown>> => {
    const abort = new AbortController();
    const cancel = () => abort.abort();
    for (const signal of signals) signal?.addEventListener('abort', cancel);
    try {
      if (signals.some((signal) => signal?.aborted)) throw unsettledGrant();
      const response = await requestFetch(new URL(browserGrantPath + action, issuer), {
        method: 'POST',
        mode: 'same-origin',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: {
          'content-type': 'application/json',
          ...(token && { authorization: 'PassportGrant ' + token }),
        },
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(120_000)]),
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw unsettledGrant();
      }
      return await responseObject(response);
    } catch {
      // Fetch errors and arbitrary response text can contain private route context.
      throw unsettledGrant();
    } finally {
      for (const signal of signals) signal?.removeEventListener('abort', cancel);
    }
  };
}
