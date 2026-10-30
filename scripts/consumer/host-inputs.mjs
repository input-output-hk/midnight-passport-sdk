// A host version and a manifest are claims; check pinned archive bytes before imports.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { consumerSha256, checkConsumerTarballs } from '../consumer-inputs.mjs';
import {
  auditInstalledBundle,
  auditInstalledPackage,
  packageArchive,
} from './installed-inputs.mjs';

/** @typedef {{name:string, version:string, sha256:string, integrity:string}} HostPin */
/** @param {Uint8Array} bytes @param {HostPin} pin */
export function checkHostArchive(bytes, pin) {
  if (pin.name !== '@laceio/sdk' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pin.version))
    throw Error('host requires its exact package identity');
  if (!/^[a-f0-9]{64}$/.test(pin.sha256) || consumerSha256(bytes) !== pin.sha256)
    throw Error('host archive SHA-256 differs');
  const sri = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  if (pin.integrity !== sri) throw Error('host archive SRI differs');
  const files = packageArchive(bytes);
  const pkg = JSON.parse(/** @type {Buffer} */ (files.get('package.json')).toString());
  if (pkg.name !== pin.name || pkg.version !== pin.version)
    throw Error('host archive package identity differs');
  const entries = ['./experimental', './midnight'].map((entry) => {
    const conditions = pkg.exports?.[entry];
    const hashes = Object.fromEntries(
      ['types', 'import', 'require'].map((condition) => {
        const path = conditions?.[condition];
        if (
          typeof path !== 'string' ||
          !path.startsWith('./') ||
          path
            .slice(2)
            .split('/')
            .some((part) => !part || part === '.' || part === '..' || part.includes('\\'))
        )
          throw Error('host entry target is missing or unsafe');
        const data = files.get(path.slice(2));
        if (!data) throw Error('host entry artifact is absent from the pinned archive');
        return [condition, consumerSha256(data)];
      }),
    );
    return { entry, hashes };
  });
  return { ...pin, entries };
}

/** The supplied receipt must have been authenticated out of band (e.g. detached GPG signature).
 * Its SHA is mandatory: a mutable JSON manifest cannot authenticate its own publisher.
 * @param {string} bundle @param {string} version @param {Uint8Array} receiptBytes
 * @param {string} receiptSha256
 */
export function checkPublicationBundle(bundle, version, receiptBytes, receiptSha256) {
  if (!/^[a-f0-9]{64}$/.test(receiptSha256) || consumerSha256(receiptBytes) !== receiptSha256)
    throw Error('publication receipt external hash differs');
  const inputs = checkConsumerTarballs(bundle, version);
  const receipt = JSON.parse(Buffer.from(receiptBytes).toString());
  if (
    receipt.version !== version ||
    !Array.isArray(receipt.packages) ||
    receipt.packages.length !== 9
  )
    throw Error('publication receipt package set differs');
  const names = new Set();
  for (const p of receipt.packages) {
    const file = inputs.files.find((f) => f.name === p.name);
    if (!file || names.has(p.name) || p.version !== version || p.sha256 !== file.sha256)
      throw Error('publication receipt package identity/hash differs');
    names.add(p.name);
    const data = readFileSync(join(bundle, file.file));
    if (p.integrity !== 'sha512-' + createHash('sha512').update(data).digest('base64'))
      throw Error('publication receipt package SRI differs');
  }
  return inputs;
}

/** @param {string} root @param {string} bundle @param {string} version @param {HostPin} pin */
export function auditHostConsumer(root, bundle, version, pin) {
  const hostBytes = readFileSync(join(bundle, 'host.tgz'));
  const host = checkHostArchive(hostBytes, pin);
  return {
    sdk: auditInstalledBundle(root, bundle, version),
    host: { ...host, installed: auditInstalledPackage(root, hostBytes, pin) },
  };
}
