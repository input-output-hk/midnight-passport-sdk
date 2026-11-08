import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { qualityFile } from '../installed-quality-inputs.mjs';

/** The crypto lane executes WASM; this reviewed Node feature probe returns absent window.
 * This does not alter the stricter import-only guard or admit any dependency version. */
export const cryptoFeatureProfiles = Object.freeze({
  wasm: {
    sha256: '94a66c4e3dacd46fb6beae76d82e03ebd31f03b76b5b8ef9b216ee34ec99250c',
    functionName: '__wbg_static_accessor_WINDOW_f8727f0cf888e0bd',
  },
  zod: { sha256: 'd99bf396f177afe547703eff48b9746c360bfc2a2708adfd4a43e73768107b6c' },
});

/** @typedef {{name:'window'|'navigator',prefix:string,file:ReturnType<typeof qualityFile>}} FeatureProbe */
/** @param {FeatureProbe[]} probes */
export function cryptoNodeGuard(probes) {
  return `const probes=${JSON.stringify(probes.map(({ name, prefix }) => ({ name, prefix })))};
for(const name of ['window','document','indexedDB','navigator'])Object.defineProperty(globalThis,name,{configurable:true,get(){
const caller=(new Error().stack??'').split('\\n')[2]?.trim()??'';
if(probes.some(probe=>probe.name===name&&caller.startsWith(probe.prefix))){process.stderr.write('CRYPTO_NODE_FEATURE_PROBE '+JSON.stringify({name,caller})+'\\n');return undefined;}
throw Error('Unexpected ambient browser access: '+name);}});`;
}

/** Fail closed on unreviewed feature-probe bytes; this is harness scope, not crypto rejection.
 * @param {import('../installed-quality-inputs.mjs').InstalledQualityContext} context */
export function installedCryptoGuard(context) {
  const contract = context.roots.find((pkg) => pkg.name.endsWith('-contract'));
  const account = context.roots.find((pkg) => pkg.name.endsWith('-account'));
  if (!contract || !account) throw Error('Missing installed crypto guard roots');
  const compact = createRequire(join(contract.root, 'package.json')).resolve(
    '@midnight-ntwrk/compact-runtime',
  );
  const onchain = createRequire(compact).resolve('@midnightntwrk/onchain-runtime-v4');
  const wasm = qualityFile(join(dirname(onchain), 'midnight_onchain_runtime_wasm_bg.js'));
  const zodPackage = createRequire(join(account.root, 'package.json')).resolve('zod/package.json');
  const zod = qualityFile(join(dirname(zodPackage), 'v4/core/util.js'));
  for (const file of [wasm, zod])
    if (!file.path.startsWith(join(context.consumer, 'node_modules') + sep))
      throw Error('Crypto Node feature probe escapes consumer');
  if (
    wasm.sha256 !== cryptoFeatureProfiles.wasm.sha256 ||
    zod.sha256 !== cryptoFeatureProfiles.zod.sha256
  )
    throw Error('Unreviewed crypto Node feature probe bytes');
  const functionName = cryptoFeatureProfiles.wasm.functionName;
  if (
    !readFileSync(wasm.path, 'utf8').includes(
      `export function ${functionName}() {\n    const ret = typeof window === 'undefined' ? null : window;`,
    )
  )
    throw Error('Unsupported crypto Node feature probe');
  /** @type {FeatureProbe[]} */ const probes = [
    { name: 'window', prefix: `at ${functionName} (${pathToFileURL(wasm.path).href}:`, file: wasm },
    { name: 'navigator', prefix: `at ${pathToFileURL(zod.path).href}:`, file: zod },
  ];
  return { code: cryptoNodeGuard(probes), probes };
}
