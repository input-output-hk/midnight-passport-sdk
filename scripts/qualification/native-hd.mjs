// Resolve the audited host's HD package through its declared ESM export, never require().
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
/** @param {string} hostEntry The checked physical @laceio/sdk/experimental entry. */
export async function loadNativeHdModule(hostEntry) {
  const root = realpathSync(join(dirname(hostEntry), '../../..', '@midnightntwrk/wallet-sdk-hd'));
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@midnightntwrk/wallet-sdk-hd');
  assert.equal(manifest.exports['.'].import, './dist/index.js');
  return import(pathToFileURL(join(root, manifest.exports['.'].import)).href);
}
/** Public standalone genesis seed only; this is not a user-wallet derivation API.
 * @param {{HDWallet:{fromSeed(seed:Uint8Array):any},Roles:{Zswap:any}}} hdModule
 * @param {{ZswapSecretKeys:{fromSeed(seed:Uint8Array):{coinPublicKey:string,encryptionPublicKey:string,clear():void}}}} ledger
 */
export function nativeSponsorKeys(hdModule, ledger) {
  const seed = new Uint8Array(32);
  seed[31] = 1;
  const hd = hdModule.HDWallet.fromSeed(seed);
  seed.fill(0);
  assert.equal(hd.type, 'seedOk');
  let derived, keys;
  try {
    derived = hd.hdWallet.selectAccount(0).selectRoles([hdModule.Roles.Zswap]).deriveKeysAt(0);
    assert.equal(derived.type, 'keysDerived');
    keys = ledger.ZswapSecretKeys.fromSeed(derived.keys[hdModule.Roles.Zswap]);
    assert.match(keys.coinPublicKey, /^[a-f0-9]{64}$/);
    assert.match(keys.encryptionPublicKey, /^[a-f0-9]{64}$/);
    return {
      coinPublicKey: keys.coinPublicKey,
      encryptionPublicKey: keys.encryptionPublicKey,
    };
  } finally {
    keys?.clear();
    derived?.keys?.[hdModule.Roles.Zswap]?.fill(0);
    hd.hdWallet.clear();
  }
}
