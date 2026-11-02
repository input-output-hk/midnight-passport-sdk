// Fresh checked consumer child. Run before Docker start; never connects a wallet or proof server.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadNativeHdModule, nativeSponsorKeys } from './native-hd.mjs';
import { createNativeProvingProvider } from './native-proving-provider.mjs';
assert.equal(process.env.PASSPORT_NATIVE_CHILD, '1');
const hostRequire = createRequire(import.meta.resolve('@laceio/sdk/experimental'));
const ledger = await import(pathToFileURL(hostRequire.resolve('@midnightntwrk/ledger-v9')).href);
const keys = nativeSponsorKeys(
  await loadNativeHdModule(hostRequire.resolve('@laceio/sdk/experimental')),
  ledger,
);
assert.match(keys.coinPublicKey, /^[a-f0-9]{64}$/);
let proofCalls = 0,
  lookupCalls = 0;
const provider = createNativeProvingProvider({
  prover: {
    prove: async () => {
      proofCalls++;
      throw Error('No proof may run during offline preflight');
    },
    check: async () => new Uint8Array(),
  },
  lookupKey: async () => {
    lookupCalls++;
    throw Error('No key fetch may run during offline preflight');
  },
  parseCheckResult: ledger.parseCheckResult,
});
await assert.rejects(provider.check(new Uint8Array(), 'offline-invalid-check'));
assert.equal(proofCalls, 0);
assert.equal(lookupCalls, 0);
assert.equal(typeof ledger.Transaction.deserialize, 'function');
assert.equal(typeof ledger.CostModel.initialCostModel, 'function');
const receipt = {
  kind: 'native-bootstrap-offline-preflight',
  hdDeclaredEsm: true,
  syntheticPublicKeys: true,
  actualLedgerCheckDecoder: true,
  malformedCheckRefused: true,
  nativeProof: false,
  wallet: false,
  network: false,
};
writeFileSync(
  join(import.meta.dirname, 'bootstrap-preflight.public.json'),
  JSON.stringify(receipt, null, 2) + '\n',
  { flag: 'wx', mode: 0o600 },
);
console.log(JSON.stringify(receipt));
