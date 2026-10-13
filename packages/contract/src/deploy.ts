// The acc-s3r1.1 constructor takes five values. They are commitments and
// public recovery parameters; passkey or recovery secrets stay with the host.
import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import { BINDING_VERSION, assertBindingCompatible } from './registry.js';

export interface AccDeployInputs {
  /** P-256 boot commitment derived by the generated pure circuit. */
  readonly initialDeviceBoot: Uint8Array;
  readonly encryptionKey: Uint8Array;
  readonly initialRecoveryPk: JubjubPoint;
  readonly initialRecoveryWrap: Uint8Array;
  readonly vetoWindowSeconds: bigint;
}

export interface AccDeployArgs {
  readonly bindingVersion: string;
  /** Positional arguments after the Compact constructor context. */
  readonly constructorArgs: readonly [Uint8Array, Uint8Array, JubjubPoint, Uint8Array, bigint];
}

/** Build the exact acc-s3r1.1 constructor order and reject unsupported bindings. */
export function buildDeployArgs(
  inputs: AccDeployInputs,
  bindingVersion: string = BINDING_VERSION,
): AccDeployArgs {
  assertBindingCompatible(bindingVersion);
  return {
    bindingVersion,
    constructorArgs: [
      inputs.initialDeviceBoot,
      inputs.encryptionKey,
      inputs.initialRecoveryPk,
      inputs.initialRecoveryWrap,
      inputs.vetoWindowSeconds,
    ],
  };
}
