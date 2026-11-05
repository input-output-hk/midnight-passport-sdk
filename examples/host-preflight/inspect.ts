import {
  ACC_CAPABILITIES,
  getAccCircuitCapability,
  inspectAccProofProfile,
} from '@input-output-hk/mn-passport-contract/capabilities';
import {
  inspectAccountConfiguration,
  getAccountProofRequirements,
  type AccountPreflightRequest,
} from '@input-output-hk/mn-passport-account/preflight';
import type { PassportPorts } from '@input-output-hk/mn-passport-account/ports';

/** Call before opening a key session. Keep host construction, consent and UI in the host. */
export function inspectHost(ports: Partial<PassportPorts>, request: AccountPreflightRequest) {
  const configuration = inspectAccountConfiguration(ports, request);
  const arm =
    configuration.ownerScheme === 'jubjub-schnorr'
      ? 'jubjub'
      : configuration.ownerScheme === 'p256-webauthn'
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

/** Supply parsed /v1/profile and /v1/manifest answers from the chosen key endpoint. */
export function inspectHostProofs(
  ports: Partial<PassportPorts>,
  request: AccountPreflightRequest,
  profile: unknown,
  manifest: unknown,
) {
  const host = inspectHost(ports, request);
  const scheme = host.configuration.ownerScheme;
  if (
    (scheme !== 'p256-webauthn' && scheme !== 'jubjub-schnorr') ||
    (request.operation === 'issue-grant' && typeof request.grantRead !== 'boolean')
  )
    return { ...host, requirements: undefined, proofProfile: undefined };
  const requirements = getAccountProofRequirements(scheme, request);
  const proofProfile = inspectAccProofProfile(profile, manifest, requirements.proofCircuits);
  return { ...host, requirements, proofProfile };
}
