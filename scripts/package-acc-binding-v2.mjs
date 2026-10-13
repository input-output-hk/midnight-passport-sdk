#!/usr/bin/env node
// Copy the checked generated module into the publishable contract package.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(
  process.env.PASSPORT_ACC_SOURCE_ROOT ??
    join(root, 'experiments/acc-0.35/work/acc-6458ed5/contract'),
  'contracts/managed/account',
);
const binding = JSON.parse(
  readFileSync(join(root, 'packages/contract/acc-binding-v2.generated.json'), 'utf8'),
);
if (
  binding.id !== 'acc-s3r1.1' ||
  binding.source?.revision !== '6458ed5fe6a4843912328bbf11112b97e33abf45'
)
  throw new Error('unexpected ACC binding metadata');

const target = join(root, 'packages/contract/generated/acc-s3r1.1');
for (const [name, pin] of Object.entries({
  'index.js': binding.module.js,
  'index.d.ts': binding.module.types,
  'index.js.map': binding.module.sourceMap,
  'contract-info.json': binding.module.contractInfo,
})) {
  const input = join(source, name === 'contract-info.json' ? 'compiler' : 'contract', name);
  const output = join(target, name);
  const bytes = readFileSync(input);
  if (bytes.length !== pin.size || createHash('sha256').update(bytes).digest('hex') !== pin.sha256)
    throw new Error(`${name} differs from the pinned compiler manifest`);
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(input, output);
  if (statSync(output).size !== pin.size) throw new Error(`incomplete copy of ${name}`);
  console.log(`${name}: ${pin.sha256}`);
}
