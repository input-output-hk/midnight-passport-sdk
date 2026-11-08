/** Readable orchestration over an existing outer revocation Flow. */
import type { FlowOptions } from '@input-output-hk/mn-passport-protocol';
import type { Flow } from './flow.js';
import type { P256Hint } from './p256-device.js';
import {
  prepareAllGrantRevocation,
  prepareSingleGrantRevocation,
} from './p256-grant-revocation-plan.js';
import {
  recheckAllGrantRevocation,
  recheckSingleGrantRevocation,
  selectGrantRevocationOwner,
  settleAllGrantRevocation,
  settleSingleGrantRevocation,
  signAllGrantRevocation,
  signSingleGrantRevocation,
  submitAllGrantRevocation,
  submitSingleGrantRevocation,
} from './p256-grant-revocation-completion.js';
import type { P256GrantRevocationHost } from './p256-grant-revocation-types.js';

export async function revokeP256Grant(
  host: P256GrantRevocationHost,
  record: P256Hint,
  grantId: string,
  options: FlowOptions,
  flow: Flow,
) {
  const operation = { host, record, options, flow };
  const prepared = await prepareSingleGrantRevocation(operation, grantId);
  const counter = await selectGrantRevocationOwner(
    operation,
    prepared.view,
    'The selected passkey does not own this ACC.',
  );
  const approval = await signSingleGrantRevocation(operation, prepared, counter);
  await recheckSingleGrantRevocation(operation, prepared);
  const tx = await submitSingleGrantRevocation(operation, approval);
  return settleSingleGrantRevocation(operation, prepared, approval, tx);
}

export async function revokeAllP256Grants(
  host: P256GrantRevocationHost,
  record: P256Hint,
  options: FlowOptions,
  flow: Flow,
) {
  const operation = { host, record, options, flow };
  const prepared = await prepareAllGrantRevocation(operation);
  const counter = await selectGrantRevocationOwner(
    operation,
    prepared.view,
    'The selected device does not own this ACC.',
  );
  const approval = await signAllGrantRevocation(operation, prepared, counter);
  await recheckAllGrantRevocation(operation, prepared);
  const tx = await submitAllGrantRevocation(operation, approval);
  return settleAllGrantRevocation(operation, prepared, approval, tx);
}
