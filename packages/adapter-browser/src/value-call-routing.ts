import type { Chain } from '@input-output-hk/mn-passport-account/ports';
import { PassportConnectorError } from '@input-output-hk/mn-passport-account';

/** A finalized-ID fence needs the direct chain's pre-dispatch callback. */
export function routeBrowserValueCalls(
  chain: Chain,
  valueCalls?: Pick<Chain, 'call'> & Partial<Pick<Chain, 'supportsBeforeSubmit'>>,
): Chain {
  if (!valueCalls) return chain;
  const { supportsBeforeSubmit: _chainFence, ...plainChain } = chain;
  return {
    ...plainChain,
    ...(valueCalls.supportsBeforeSubmit === true && { supportsBeforeSubmit: true as const }),
    call: (request) => {
      if (request.beforeSubmit && valueCalls.supportsBeforeSubmit !== true)
        throw new PassportConnectorError(
          'BindingUnsupported',
          'The selected value transport cannot fence a finalized withdrawal.',
        );
      return request.circuit.startsWith('withdraw_unshielded')
        ? valueCalls.call(request)
        : chain.call(request);
    },
  };
}
