/** Shared workspace/installed-consumer contract checks for the local quality API increment. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const qualityNodeTypes = `
import {AccountAddressSchema,AssetIdSchema,AmountSchema,type AccountAddress,type AssetId,type Amount} from '@input-output-hk/mn-passport-account/validation';
import {createMemorySecretStore} from '@input-output-hk/mn-passport-account/secret-store';
import {createAccountAuthorisation} from '@input-output-hk/mn-passport-account/authorization';
import {createBackgroundClient} from '@input-output-hk/mn-passport-account/background';
import type {SecretStore,BackgroundPort} from '@input-output-hk/mn-passport-account/ports';
import type {PassportAccount} from '@input-output-hk/mn-passport-protocol';
const account:AccountAddress=AccountAddressSchema.parse('ab'.repeat(32));
const asset:AssetId=AssetIdSchema.parse('00'.repeat(32));
const amount:Amount=AmountSchema.parse('1');
// @ts-expect-error An ACC address is not an asset even though both encode 32 bytes.
const wrongAsset:AssetId=account;
// @ts-expect-error Plain strings must be parsed before receiving the account brand.
const unchecked:AccountAddress='ab';
// @ts-expect-error Decimal amount brands must be validated.
const uncheckedAmount:Amount='1';
export function compose(primary:PassportAccount,port:BackgroundPort) {
  const store:SecretStore=createMemorySecretStore();
  const consent=createAccountAuthorisation({primary,isContextCurrent:()=>true /* fixed account scope for this compile fixture */,consent:{review:async(request)=>request.route==='primary'}});
  // @ts-expect-error Context guards are synchronous; an async predicate cannot authorize work.
  createAccountAuthorisation({primary,isContextCurrent:async()=>true,consent:{review:async()=>true}});
  // @ts-expect-error Both signing routes require an explicit host context guard.
  createAccountAuthorisation({primary,consent:{review:async()=>true}});
  const client=createBackgroundClient(port,{channel:'node-read-worker'});
  return {store,consent,client,account,asset,amount,wrongAsset,unchecked,uncheckedAmount};
}
`;

export const qualityWebTypes = `
import {createBrowserSecretStore} from '@input-output-hk/mn-passport-adapter-browser/secret-store';
import {browserBackgroundPort} from '@input-output-hk/mn-passport-adapter-browser/background';
import type {SecretStore,BackgroundPort} from '@input-output-hk/mn-passport-account/ports';
export async function compose(worker:Worker,messagePort:MessagePort) {
  const store:SecretStore=await createBrowserSecretStore({indexedDB,databaseName:'example',allowPlaintext:true});
  const port:BackgroundPort=browserBackgroundPort(worker,()=>worker.terminate());
  const channel:BackgroundPort=browserBackgroundPort(messagePort,()=>messagePort.close());
  // @ts-expect-error Plaintext persistence always needs an explicit true opt-in.
  createBrowserSecretStore({indexedDB,databaseName:'example',allowPlaintext:false});
  return {store,port,channel};
}
`;

export const qualityWorkerTypes = `
import {browserBackgroundPort} from '@input-output-hk/mn-passport-adapter-browser/background';
import {serveBackgroundTasks} from '@input-output-hk/mn-passport-account/background';
declare const scope:DedicatedWorkerGlobalScope;
export function serve(port:MessagePort) {
  const channel=browserBackgroundPort(port,()=>port.close());
  const worker=browserBackgroundPort(scope,()=>scope.close());
  return [serveBackgroundTasks(channel,{channel:'worker-port',methods:{async echo(input){return input;}}}),worker];
}
`;

export const qualityConfigTypes = `
import {fetchCheckedV1Config} from '@input-output-hk/mn-passport-adapter-service/config';
import type {FetchLike,NetworkConfig} from '@input-output-hk/mn-passport-account/ports';
export function configuration(pin:NetworkConfig,fetch:FetchLike) {
  return fetchCheckedV1Config('https://service.example',pin,{fetch,timeoutMs:30000});
}
`;

export const qualityRuntimeSmoke = `
import assert from 'node:assert/strict';
import {createMemorySecretStore} from '@input-output-hk/mn-passport-account/secret-store';
import {AccountAddressSchema} from '@input-output-hk/mn-passport-account/validation';
import {createAccountAuthorisation} from '@input-output-hk/mn-passport-account/authorization';
import {createBackgroundClient} from '@input-output-hk/mn-passport-account/background';
import {createBrowserSecretStore} from '@input-output-hk/mn-passport-adapter-browser/secret-store';
import {browserBackgroundPort} from '@input-output-hk/mn-passport-adapter-browser/background';
assert.equal(typeof createAccountAuthorisation,'function');
assert.equal(typeof createBackgroundClient,'function');
assert.equal(typeof createBrowserSecretStore,'function'); // importing does not access IndexedDB
assert.equal(typeof browserBackgroundPort,'function');
const ref={namespace:'consumer',networkId:'undeployed',bindingId:'acc-s3r1.1',account:AccountAddressSchema.parse('ab'.repeat(32)),id:'sample'};
const store=createMemorySecretStore();
const result=await store.write(ref,Uint8Array.of(7),null);
let read;
try {
  read=await store.read(ref);assert.ok(read);
  assert.deepEqual([...read.bytes],[7]);
  await store.remove(ref,result.version);
} finally {store.close();result.bytes.fill(0);read?.bytes.fill(0);}
console.log('quality API Node imports and custody contract passed');
`;

/** @param {string} consumer */
export function checkQualityConsumer(consumer) {
  const directory = join(consumer, 'quality-contracts');
  mkdirSync(directory);
  for (const { name, source, lib } of [
    { name: 'node', source: qualityNodeTypes, lib: ['ES2022'] },
    { name: 'web', source: qualityWebTypes, lib: ['ES2022', 'DOM'] },
  ]) {
    writeFileSync(join(directory, `${name}.mts`), source);
    const config = {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noEmit: true,
        skipLibCheck: false,
        types: [],
        lib,
      },
      files: [`${name}.mts`],
    };
    writeFileSync(join(directory, `${name}.json`), JSON.stringify(config));
    execFileSync('pnpm', ['exec', 'tsc', '-p', join(directory, `${name}.json`)], {
      cwd: consumer,
      stdio: 'inherit',
    });
  }
  writeFileSync(join(directory, 'runtime.mjs'), qualityRuntimeSmoke);
  execFileSync(process.execPath, [join(directory, 'runtime.mjs')], {
    cwd: consumer,
    stdio: 'inherit',
  });
}
