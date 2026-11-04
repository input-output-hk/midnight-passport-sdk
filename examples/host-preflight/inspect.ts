import {
  ACC_CAPABILITIES,
  getAccCircuitCapability,
} from '@input-output-hk/mn-passport-contract/capabilities';
import {
  inspectAccountConfiguration,
  type AccountPreflightRequest,
} from '@input-output-hk/mn-passport-account/preflight';
import type { PassportPorts } from '@input-output-hk/mn-passport-account/ports';

/** Call before opening a key session. Keep host construction, consent and UI in the host. */
export function inspectHost(ports: Partial<PassportPorts>, request: AccountPreflightRequest) {
  const configuration = inspectAccountConfiguration(ports, request);
  const arm =
    ports.authoriser?.scheme === 'jubjub-schnorr'
      ? 'jubjub'
      : ports.authoriser?.scheme === 'p256-webauthn'
        ? 'p256'
        : undefined;
  const circuit =
    arm &&
    (request.operation === 'withdraw-unshielded' || request.operation === 'withdraw-shielded')
      ? getAccCircuitCapability(
          `withdraw_${request.operation === 'withdraw-shielded' ? 'shielded' : 'unshielded'}_with_${arm}`,
          'proof',
        )
      : undefined;
  return { binding: ACC_CAPABILITIES.binding, configuration, circuit };
}
