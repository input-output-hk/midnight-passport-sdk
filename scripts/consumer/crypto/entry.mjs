// Copied unchanged into the admitted consumer; public SDK code is loaded only there.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCryptoModules } from './modules.mjs';
import { generatedAccountCrypto } from './generated-account.mjs';
import {
  cryptoCaseNames,
  cryptoClaims,
  laceKnownAnswers,
  custodyRoundTrip,
  compactHashAnswers,
  utilsHashAnswers,
} from './contracts.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
/** @type {unknown} */ const pins = JSON.parse(readFileSync(join(directory, 'pins.json'), 'utf8'));
if (
  !pins ||
  typeof pins !== 'object' ||
  !('consumer' in pins) ||
  typeof pins.consumer !== 'string' ||
  !('version' in pins) ||
  typeof pins.version !== 'string'
)
  throw Error('Invalid crypto child pins');
/** @type {{name:string,outcome:string}[]} */ const cases = [];
/** @type {import('./modules.mjs').CryptoResolution[]} */ let resolutions = [];
/** @type {unknown} */ let failure;
try {
  const modules = await loadCryptoModules({ consumer: pins.consumer, version: pins.version });
  resolutions = modules.resolutions;
  const operations = [
    () => generatedAccountCrypto(modules, 'jubjub'),
    () => generatedAccountCrypto(modules, 'p256'),
    () => laceKnownAnswers(modules),
    () => custodyRoundTrip(modules),
    () => compactHashAnswers(modules),
    () => utilsHashAnswers(modules),
  ];
  for (const [index, operation] of operations.entries()) {
    await operation();
    const name = cryptoCaseNames[index];
    if (!name) throw Error('Crypto case inventory differs');
    cases.push({ name, outcome: 'passed' });
  }
} catch (error) {
  failure = error;
}
writeFileSync(
  join(directory, 'crypto-results.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      kind: 'installed-software-crypto',
      outcome: failure === undefined ? 'passed' : 'failed',
      cases,
      resolutions,
      claims: cryptoClaims,
      failure:
        failure instanceof Error
          ? { name: failure.name, message: failure.message }
          : failure === undefined
            ? null
            : String(failure),
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx', mode: 0o600 },
);
if (failure !== undefined) throw failure;
console.log(JSON.stringify({ outcome: 'passed', cases: cases.length }));
