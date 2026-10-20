#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { qualifyRepeatedRuns } from './qualification/receipt.mjs';
import { SCENARIOS, SUITES } from './qualification/catalog.mjs';
import { planSuite, runSuite } from './qualification/runner.mjs';
const [command, suite, flag, output, ...rest] = process.argv.slice(2);
if (command === 'repeat' && suite && flag && output && !rest.length) {
  const receipts = await Promise.all(
    [suite, flag, output].map(async (file) => JSON.parse(await readFile(file, 'utf8'))),
  );
  console.log(JSON.stringify(qualifyRepeatedRuns(receipts), null, 2));
} else if (command === 'list' && !suite) {
  console.log(JSON.stringify({ suites: SUITES, scenarios: SCENARIOS }, null, 2));
} else if (command === 'plan' && suite && !flag) {
  console.log(
    JSON.stringify(
      planSuite(suite).map(({ command: ignored, ...scope }) => scope),
      null,
      2,
    ),
  );
} else if (command === 'run' && suite && flag === '--output' && output && !rest.length) {
  if (!process.env.IN_NIX_SHELL) throw new Error('run qualification through nix develop');
  const receipt = await runSuite(suite, output);
  console.log(JSON.stringify(receipt, null, 2));
  if (!receipt.allRequiredPassed) process.exitCode = 1;
} else
  throw new Error(
    'usage: qualify.mjs list | plan <suite> | run <suite> --output <new-receipt.json> | repeat <receipt1> <receipt2> <receipt3>',
  );
