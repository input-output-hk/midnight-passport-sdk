import type { GeneratedAccModule } from '@input-output-hk/mn-passport-adapter-browser/prototype';
// The generated module is supplied by the versioned contract package subpath mapped to `#acc`.
import { Contract, ledger, pureCircuits } from '#acc';

export const accModule: GeneratedAccModule = { Contract, ledger, pureCircuits };
