// Compile in the checked external consumer. This is a type contract, not a native receipt.
import type { m } from '@laceio/sdk/experimental';
import { parseCheckResult, type ProvingProvider } from '@midnightntwrk/ledger-v9';
import { createNativeProvingProvider } from './native-proving-provider.mjs';
type HostProver = Parameters<typeof m.createPassportAccountModule>[0]['prover'];
export function nativeProviderForHost(
  prover: HostProver,
  lookupKey: ProvingProvider['lookupKey'],
): ProvingProvider {
  return createNativeProvingProvider({ prover, lookupKey, parseCheckResult });
}
