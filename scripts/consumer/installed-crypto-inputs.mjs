import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditInstalledBundle } from './installed-inputs.mjs';
import { checkMidnightRuntimeIdentity } from '../check-midnight-runtime-identity.mjs';
import { resolveCryptoExport } from './crypto/modules.mjs';
import { qualityFile, qualityTree } from './installed-quality-inputs.mjs';

/** @typedef {import('./installed-quality-inputs.mjs').InstalledQualityContext} Context */

/** @param {string} consumer @param {string} output */
export function cryptoOutput(consumer, output) {
  if (!isAbsolute(output) || lstatSync(output, { throwIfNoEntry: false }))
    throw Error('Installed crypto output must be fresh and absolute');
  const root = realpathSync(consumer),
    parent = realpathSync(dirname(resolve(output)));
  if (root !== parent) throw Error('Installed crypto output must be a direct consumer child');
  return join(parent, basename(resolve(output)));
}

export const cryptoFiles = Object.freeze([
  'installed-crypto.mjs',
  'installed-crypto-inputs.mjs',
  'installed-crypto-process.mjs',
  'crypto/entry.mjs',
  'crypto/modules.mjs',
  'crypto/node-guard.mjs',
  'crypto/generated-account.mjs',
  'crypto/contracts.mjs',
]);
const sharedFiles = [
  'installed-quality-inputs.mjs',
  'installed-inputs.mjs',
  '../consumer-inputs.mjs',
  '../release-package-list.mjs',
  '../check-midnight-runtime-identity.mjs',
  '../qualification/process-stop.mjs',
];

/** No source, TypeScript or documentation compiler inputs execute in this lane.
 * @param {Context} context */
export function captureCryptoInputs(context) {
  const prepared = JSON.parse(
    readFileSync(join(context.consumer, 'qualification-inputs.json'), 'utf8'),
  );
  const lock = qualityFile(join(context.consumer, 'pnpm-lock.yaml'));
  const pkg = qualityFile(join(context.consumer, 'package.json'));
  const installed = auditInstalledBundle(
    context.consumer,
    join(context.consumer, 'bundle'),
    context.version,
  );
  if (
    lock.sha256 !== context.lockSha256 ||
    pkg.sha256 !== prepared.packageJsonSha256 ||
    installed.manifestSha256 !== context.manifestSha256 ||
    prepared.nodeVersion !== process.version
  )
    throw Error('Installed crypto consumer inputs differ');
  const runtime = checkMidnightRuntimeIdentity(
    context.consumer,
    context.roots.map(({ name }) => name),
  );
  if (JSON.stringify(Object.keys(runtime).sort()) !== JSON.stringify(prepared.runtimeIdentity))
    throw Error('Installed crypto runtime identity differs');
  return {
    installed,
    lock,
    package: pkg,
    prepared: qualityFile(join(context.consumer, 'qualification-inputs.json')),
    modules: qualityTree(join(context.consumer, 'node_modules'), context.roots),
    runtime,
    tools: [
      qualityFile(process.execPath),
      ...[...cryptoFiles, ...sharedFiles].map((file) =>
        qualityFile(fileURLToPath(new URL(file, import.meta.url))),
      ),
    ],
  };
}

/** @param {Context} context @param {string} directory */
export function cryptoLoader(context, directory) {
  return `import{realpathSync}from'node:fs';import{fileURLToPath}from'node:url';import{join,sep}from'node:path';
const root=${JSON.stringify(context.consumer)},output=${JSON.stringify(directory)},roots=${JSON.stringify(context.roots.map(({ name, root }) => ({ name, root })))};
const inside=(root,file)=>file===root||file.startsWith(root+sep);
export async function resolve(specifier,context,next){const result=await next(specifier,context);
if(result.url.startsWith('file:')){const file=realpathSync(fileURLToPath(result.url));
if(!inside(join(root,'node_modules'),file)&&!inside(output,file))throw Error('Crypto import escapes installed consumer');
if(specifier.startsWith('@input-output-hk/mn-passport-')){const name=specifier.split('/').slice(0,2).join('/'),pkg=roots.find(item=>item.name===name);
if(!pkg||!inside(pkg.root,file))throw Error('Crypto SDK import escapes audited package');}}
return result;}`;
}

/** @param {string} file @returns {unknown} */
export function readCryptoResult(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 256 * 1024)
    throw Error('Invalid installed crypto result file');
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Re-resolve recorded public edges independently after the child has exited.
 * @param {Context} context @param {unknown} values */
export function verifyCryptoResolutions(context, values) {
  if (!Array.isArray(values) || values.length === 0) throw Error('Missing crypto resolutions');
  for (const value of values) {
    if (
      !value ||
      typeof value !== 'object' ||
      typeof value.specifier !== 'string' ||
      typeof value.parent !== 'string'
    )
      throw Error('Invalid crypto resolution');
    const current = resolveCryptoExport(value.specifier, value.parent, context.consumer);
    if (JSON.stringify(value) !== JSON.stringify(current))
      throw Error('Crypto public resolution changed');
  }
}
