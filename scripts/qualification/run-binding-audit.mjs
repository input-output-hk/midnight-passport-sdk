import { auditBindingSources } from './binding-audit.mjs';
if (!process.env.PASSPORT_REPO) throw new Error('set PASSPORT_REPO to the public source checkout');
const report = auditBindingSources({ repository: process.env.PASSPORT_REPO });
if (
  !report.declarationsEqual ||
  report.executableChanges.length !== 1 ||
  report.executableChanges[0] !== 'contract/contracts/account.compact'
)
  throw new Error('source drift needs renewed binding review');
console.log(JSON.stringify(report));
