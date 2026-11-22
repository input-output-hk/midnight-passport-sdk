import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  Contract,
  ledger,
  pureCircuits,
} from '@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1';
import { resolvePinnedBinding } from '@input-output-hk/mn-passport-contract';
import type { MidnightBinding } from '@input-output-hk/mn-passport-adapter-midnight-js';
import type { FundingConfig } from './config.ts';

const stable: MidnightBinding = { Contract, ledger, pureCircuits };

/** Execute only the verified candidate module bytes against the reference's pinned runtime. */
export async function loadFundingBinding(
  config: Pick<FundingConfig, 'bindingId' | 'contractDir' | 'artefactDir' | 'provisionalLocal'>,
): Promise<MidnightBinding> {
  if (!config.provisionalLocal) return stable;
  const pin = resolvePinnedBinding(config.bindingId);
  if (config.bindingId !== 'acc-s3r1.1-zkir036' || !pin.provisional)
    throw new Error('Candidate funding binding differs from the package pin.');
  const source = readFileSync(join(config.artefactDir, 'contract/index.js'));
  const hash = createHash('sha256').update(source).digest('hex');
  if (hash !== pin.moduleHashes['contract/index.js'])
    throw new Error('Candidate funding module differs from the package pin.');
  const runtime = mkdtempSync(join(tmpdir(), 'passport-funding-candidate-'));
  try {
    symlinkSync(join(config.contractDir, 'node_modules'), join(runtime, 'node_modules'));
    const modulePath = join(runtime, 'account.mjs');
    writeFileSync(modulePath, source, { flag: 'wx', mode: 0o600 });
    const module = (await import(pathToFileURL(modulePath).href)) as Partial<MidnightBinding>;
    if (
      typeof module.Contract !== 'function' ||
      typeof module.ledger !== 'function' ||
      !module.pureCircuits ||
      typeof module.pureCircuits !== 'object'
    )
      throw new Error('Candidate funding module lacks the pinned ACC binding.');
    return module as MidnightBinding;
  } finally {
    rmSync(runtime, { recursive: true, force: true });
  }
}
