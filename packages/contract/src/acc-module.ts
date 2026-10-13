// Shape validation for the pinned acc-s3r1.1 generated module. Integrity is
// checked by the artefact manifest; this check catches accidental ABI drift.
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger, PureCircuits, Witnesses } from '../generated/acc-s3r1.1/index.js';
import { ACC_REGISTRY } from './registry.js';

export type AccPureCircuits = PureCircuits;
export type AccWitnessContext<PS = unknown> = WitnessContext<Ledger, PS>;
export type AccWitnesses<PS = unknown> = Witnesses<PS>;
export type AccContractModule = Pick<
  typeof import('../generated/acc-s3r1.1/index.js'),
  'Contract' | 'ledger' | 'pureCircuits'
>;
export type AccContractInstance = InstanceType<AccContractModule['Contract']>;

/** A loaded module has the wrong generated ACC shape. */
export class AccModuleShapeError extends Error {
  override readonly name = 'AccModuleShapeError';
  readonly code = 'ACC_MODULE_SHAPE';
  constructor(readonly detail: string) {
    super(`The loaded module is not the acc-s3r1.1 generated contract module — ${detail}.`);
  }
}

/** Check every pinned pure-circuit name, then freeze a copy of the module surface. */
export function bindAccModule(module: unknown): AccContractModule {
  if (module === null || typeof module !== 'object') {
    throw new AccModuleShapeError('not an object');
  }
  const candidate = module as Record<string, unknown>;
  const contract = candidate.Contract;
  const ledger = candidate.ledger;
  if (typeof contract !== 'function') throw new AccModuleShapeError('missing the Contract class');
  if (typeof ledger !== 'function') throw new AccModuleShapeError('missing the ledger projection');
  const pure = candidate.pureCircuits;
  if (pure === null || typeof pure !== 'object') {
    throw new AccModuleShapeError('missing pure circuits');
  }
  const copied: Record<string, unknown> = {};
  const pins = ACC_REGISTRY.versions[ACC_REGISTRY.current]?.circuits;
  if (!pins) throw new AccModuleShapeError('missing release circuit catalogue');
  for (const [name, pin] of Object.entries(pins)) {
    if (!pin.pure) continue;
    const fn = (pure as Record<string, unknown>)[name];
    if (typeof fn !== 'function') throw new AccModuleShapeError(`missing the pure circuit ${name}`);
    copied[name] = fn;
  }
  return Object.freeze({
    Contract: contract,
    ledger,
    pureCircuits: Object.freeze(copied),
  }) as AccContractModule;
}
