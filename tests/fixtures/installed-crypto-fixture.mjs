import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { installedFixture } from './installed-quality-fixture.mjs';

/** @param {string} modules @param {string} name @param {string} version @param {string} [code] */
export function cryptoPackage(modules, name, version, code = 'export const synthetic=true;\n') {
  const root = join(modules, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name, version, type: 'module', exports: './index.js' }),
  );
  const entry = join(root, 'index.js');
  writeFileSync(entry, code);
  return entry;
}

/** Archive fixture remains unchanged; added public graph is synthetic boundary evidence only. */
export function installedCryptoFixture() {
  const fixture = installedFixture();
  const modules = join(fixture.consumer, 'node_modules');
  const parent = cryptoPackage(modules, 'synthetic-parent', '1.0.0');
  const nested = join(dirname(parent), 'node_modules');
  const selected = cryptoPackage(nested, 'synthetic-dependency', '1.0.0');
  const decoy = cryptoPackage(modules, 'synthetic-dependency', '2.0.0');
  return { ...fixture, modules, parent, selected, decoy };
}
