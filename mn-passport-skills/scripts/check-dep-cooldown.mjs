#!/usr/bin/env node
// Keep the policy entrypoint; bounded, checked implementation lives with CI tools.
import { cooldown } from '../../scripts/ci/cooldown.mjs';
try {
  const result = await cooldown(process.cwd(), process.argv[2] ?? 'origin/main', process.env.PR_BODY ?? '');
  if (result.versions.length === 0) console.log('No new package versions introduced.');
  else {
    console.log('Checked '+result.versions.length+' new versions through '+result.metadata.calls+' bounded metadata calls.');
    for (const row of result.violations) console.log(row.pair+': '+row.ageDays.toFixed(2)+' days old ('+row.published+').');
    if (result.override && result.violations.length > 0)
      console.log('::warning::Known recent versions consciously admitted: '+result.override.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A'));
    if (!result.passed) console.log('::error::7-day dependency cooldown violated. An urgent security patch needs a documented Cooldown-override reason.');
  }
  process.exitCode = result.passed ? 0 : 1;
} catch {
  console.log('::error::Dependency cooldown could not establish complete publish-age evidence. Missing metadata is never safe or overrideable.');
  process.exitCode = 1;
}
