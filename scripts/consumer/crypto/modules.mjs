import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

/** @typedef {{specifier:string,parent:string,path:string,packageName:string,version:string,moduleSha256:string,manifestSha256:string}} CryptoResolution */
/** @param {unknown} value @returns {value is Record<string,unknown>} */
const record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** @param {string} file */
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
/** @param {string} root @param {string} file */
const inside = (root, file) => file === root || file.startsWith(root + sep);

/** Public exports resolve from their actual installed parent, never the tools' graph.
 * @param {string} specifier @param {string} parent @param {string} consumer
 * @returns {CryptoResolution} */
export function resolveCryptoExport(specifier, parent, consumer) {
  if (
    !/^(@[a-z0-9-]+\/)?[a-z0-9-]+(?:\/[a-zA-Z0-9._/-]+)?$/.test(specifier) ||
    specifier.includes('..')
  )
    throw Error('Invalid crypto public export');
  const modules = join(realpathSync(consumer), 'node_modules');
  const path = realpathSync(createRequire(parent).resolve(specifier));
  if (!inside(modules, path)) throw Error('Crypto dependency escapes installed consumer');
  let root = dirname(path);
  for (;;) {
    const manifest = join(root, 'package.json');
    let metadata;
    try {
      metadata = JSON.parse(readFileSync(manifest, 'utf8'));
    } catch {
      /* Find owning package. */
    }
    if (
      record(metadata) &&
      typeof metadata.name === 'string' &&
      typeof metadata.version === 'string'
    )
      return {
        specifier,
        parent,
        path,
        packageName: metadata.name,
        version: metadata.version,
        moduleSha256: hash(path),
        manifestSha256: hash(manifest),
      };
    const next = dirname(root);
    if (!inside(modules, next) || root === next)
      throw Error('Crypto export has no installed package identity');
    root = next;
  }
}

/** @param {{consumer:string,version:string}} pins */
export async function loadCryptoModules(pins) {
  /** @type {CryptoResolution[]} */ const resolutions = [];
  /** @param {string} name @param {string} [parent] */
  const select = (name, parent = import.meta.url) => {
    const selected = resolveCryptoExport(name, parent, pins.consumer);
    resolutions.push(selected);
    return selected.path;
  };
  const bindingName = '@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1';
  const keysName = '@input-output-hk/mn-passport-keys';
  const webauthnName = '@input-output-hk/mn-passport-adapter-webauthn';
  const bindingPath = select(bindingName),
    keysPath = select(keysName);
  select(webauthnName);
  const compactPath = select('@midnight-ntwrk/compact-runtime', bindingPath);
  const browserPath = select('@input-output-hk/mn-passport-adapter-browser');
  const contractsPath = select('@midnight-ntwrk/midnight-js-contracts', browserPath);
  const utilsPath = select('@midnight-ntwrk/midnight-js-utils', contractsPath);
  for (const specifier of [
    '@noble/curves/nist.js',
    '@noble/hashes/sha2.js',
    '@noble/hashes/sha3.js',
  ])
    select(specifier, compactPath);
  select('@noble/hashes/sha2.js', utilsPath);
  select('@noble/curves/misc.js', keysPath);
  if (
    resolutions.some(
      (row) => row.specifier.startsWith('@input-output-hk/') && row.version !== pins.version,
    )
  )
    throw Error('Crypto SDK version differs from candidate');
  // Versions/SRIs of dependencies belong to the separately admitted graph, not a crypto allowlist.
  return {
    resolutions,
    binding: await import(bindingName),
    keys: await import(keysName),
    webauthn: await import(webauthnName),
    runtime: await import(pathToFileURL(compactPath).href),
    utils: await import(pathToFileURL(utilsPath).href),
  };
}
