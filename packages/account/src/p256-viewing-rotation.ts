/** P-256 rotation owns a Flow even when enrollment already owns its key session. */
import type { FlowOptions } from '@input-output-hk/mn-passport-protocol';
import type { P256Hint } from './p256-device.js';
import { finishP256Removal, switchP256ViewingKey } from './p256-rotation-completion.js';
import {
  prepareP256RotationMaterial,
  publishP256RotationMaterial,
} from './p256-rotation-material.js';
import {
  openP256Rotation,
  planP256Rotation,
  withP256RotationSession,
} from './p256-rotation-plan.js';
import type {
  P256RotationContext,
  P256RotationHost,
  RotationCallback,
  RotationControls,
  RotationResult,
} from './p256-rotation-types.js';

export function createP256ViewingRotation(context: P256RotationContext) {
  const { run, ports } = context;
  const host: P256RotationHost = {
    ...context,
    authoriser: ports.authoriser,
    viewingKey: ports.viewingKey,
    networkId: ports.network.networkId,
  };
  return (
    record: P256Hint,
    options: FlowOptions = {},
    removal?: string,
    excludedGrant?: string | 'all',
    onRotated?: RotationCallback,
    controls: RotationControls = {},
  ) =>
    run(options, async (flow): Promise<RotationResult> => {
      const operation = await planP256Rotation(
        host,
        record,
        flow,
        removal,
        excludedGrant,
        controls,
      );
      return withP256RotationSession(operation, async () => {
        const opened = await openP256Rotation(operation);
        const material = await prepareP256RotationMaterial(operation, opened);
        const published = await publishP256RotationMaterial(operation, opened, material);
        const rotation = await switchP256ViewingKey(operation, material, published, onRotated);
        return finishP256Removal(operation, material, rotation);
      });
    });
}
