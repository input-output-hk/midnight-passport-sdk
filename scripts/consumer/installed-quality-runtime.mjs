// Import real public exports in a bounded child; never call wallet/network constructors.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { previewBrowserGuard } from './preview-quality.mjs';
import { qualityRuntimeSmoke } from './quality-contracts.mjs';
import {
  installedRuntimeExports,
  qualityFile,
  assertQualityUnchanged,
} from './installed-quality-inputs.mjs';

/** @typedef {import('./installed-quality-inputs.mjs').InstalledQualityContext} Context */

/** @param {Context} context @param {string} output @param {{custodySmoke?:boolean}} [options] */
export function importInstalledExports(context, output, options = {}) {
  mkdirSync(output);
  const exports = installedRuntimeExports(context.roots);
  if (!exports.length) throw Error('no installed runtime exports were admitted');
  const guard = join(output, 'guard.mjs'),
    loader = join(output, 'loader.mjs'),
    entry = join(output, 'entry.mjs');
  // Resolve Zod through the installed account dependency, not a developer workspace alias.
  const account = context.roots.find((pkg) => pkg.name.endsWith('-account'));
  const navigatorProbes = [];
  if (account) {
    const require = createRequire(join(account.root, 'package.json'));
    try {
      const probe = join(dirname(require.resolve('zod/package.json')), 'v4/core/util.js');
      if (existsSync(probe)) navigatorProbes.push(probe);
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'MODULE_NOT_FOUND')
        throw error;
    }
  }
  writeFileSync(guard, previewBrowserGuard(navigatorProbes), { flag: 'wx', mode: 0o600 });
  writeFileSync(
    loader,
    `import{realpathSync}from'node:fs';import{fileURLToPath}from'node:url';import{join,sep}from'node:path';
const consumer=${JSON.stringify(context.consumer)},output=${JSON.stringify(output)},roots=${JSON.stringify(context.roots.map(({ name, root }) => ({ name, root })))};
const inside=(root,file)=>file===root||file.startsWith(root+sep);
export async function resolve(specifier,context,next){const result=await next(specifier,context);
if(result.url.startsWith('file:')){const file=realpathSync(fileURLToPath(result.url));
if(!inside(join(consumer,'node_modules'),file)&&!inside(output,file))throw Error('Runtime import escapes installed consumer');
if(specifier.startsWith('@input-output-hk/mn-passport-')){const name=specifier.split('/').slice(0,2).join('/'),pkg=roots.find(value=>value.name===name);
if(!pkg||!inside(pkg.root,file))throw Error('SDK runtime import escapes audited package');}}
return result;}`,
    { flag: 'wx', mode: 0o600 },
  );
  writeFileSync(
    entry,
    `${options.custodySmoke === false ? '' : qualityRuntimeSmoke}
import{realpathSync as physical}from'node:fs';import{fileURLToPath as filePath}from'node:url';
for(const item of ${JSON.stringify(exports)}){
 const resolved=physical(filePath(import.meta.resolve(item.specifier)));
 if(resolved!==item.file)throw Error('Public export resolved to a different installed target');
 await import(item.specifier,item.json?{with:{type:'json'}}:undefined);
 console.log('IMPORTED_EXPORT '+JSON.stringify(item.specifier));
}`,
    { flag: 'wx', mode: 0o600 },
  );
  const generatedBefore = [guard, loader, entry].map(qualityFile);
  const result = spawnSync(
    process.execPath,
    ['--import', guard, '--experimental-loader', loader, entry],
    {
      cwd: context.consumer,
      env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8' },
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  writeFileSync(join(output, 'stdout.log'), result.stdout ?? '', { flag: 'wx', mode: 0o600 });
  writeFileSync(join(output, 'stderr.log'), result.stderr ?? '', { flag: 'wx', mode: 0o600 });
  assertQualityUnchanged(generatedBefore, [guard, loader, entry].map(qualityFile));
  if (result.error || result.status !== 0)
    throw Error('installed export import failed; inspect runtime stdout/stderr logs');
  const imported = (result.stdout ?? '')
    .split('\n')
    .filter((line) => line.startsWith('IMPORTED_EXPORT '))
    .map((line) => JSON.parse(line.slice('IMPORTED_EXPORT '.length)));
  assertQualityUnchanged(
    exports.map((item) => item.specifier),
    imported,
  );
  return {
    exports,
    imported: imported.length,
    navigatorProbes,
    generated: generatedBefore,
    stdoutSha256: qualityFile(join(output, 'stdout.log')).sha256,
    stderrSha256: qualityFile(join(output, 'stderr.log')).sha256,
  };
}
