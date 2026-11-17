import type { PreparedValueSubmission } from '@input-output-hk/mn-passport-protocol';
import { PassportConnectorError } from './errors.js';
import type { Chain } from './ports/index.js';

/** Refuse an unfenced value adapter before entering an owner credential session. */
export async function requireValueSubmissionChain(
  select: () => Promise<Chain>,
  beforeSubmit: ((submission: PreparedValueSubmission) => Promise<void>) | undefined,
): Promise<Chain> {
  const chain = await select();
  if (beforeSubmit && chain.supportsBeforeSubmit !== true)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'The selected chain cannot fence a finalized withdrawal before submission.',
    );
  return chain;
}
