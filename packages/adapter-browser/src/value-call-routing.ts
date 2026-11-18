import type { Chain } from '@input-output-hk/mn-passport-account/ports';

/** A finalized-ID fence needs the direct chain's pre-dispatch callback. */
export function routeBrowserValueCalls(
  chain: Chain,
  valueCalls?: Pick<Chain, 'call'> & Partial<Pick<Chain, 'supportsBeforeSubmit'>>,
): Chain {
  if (!valueCalls) return chain;
  return {
    ...chain,
    call: (request) =>
      request.circuit.startsWith('withdraw_unshielded') &&
      (!request.beforeSubmit || valueCalls.supportsBeforeSubmit === true)
        ? valueCalls.call(request)
        : chain.call(request),
  };
}
