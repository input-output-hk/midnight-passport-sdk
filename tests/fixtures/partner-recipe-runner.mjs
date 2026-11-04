// Execute the emitted public-import composition with a real adapter/journal and fake value/finality.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { webauthnPasskey } from '../../packages/adapter-webauthn/dist/index.js';
import { fileMutationByteStore } from '../../packages/service/dist/index.js';
import { softwareAuthenticator, RP, ORIGIN } from './software-authenticator.mjs';
import { depositWorld, depositPins, depositRequest } from './shielded-deposit-world.mjs';
const compiledRecipe = process.argv[2];
assert.ok(compiledRecipe);
const { approvedDepositOperations } = await import(pathToFileURL(compiledRecipe).href);
const root = mkdtempSync(join(tmpdir(), 'passport-emitted-recipe-'));
try {
  const auth = softwareAuthenticator();
  const adapter = webauthnPasskey({ rpId: RP, origin: ORIGIN, credentials: auth.container });
  await adapter.credentials.create({ name: 'synthetic-recipe' });
  const world = depositWorld(root);
  const operations = approvedDepositOperations({
    pins: depositPins,
    journalKeySource: adapter.prf,
    store: fileMutationByteStore(join(root, 'recipe-journal')),
    senderPorts: world.ports,
    evidence: world.ports.recovery,
  });
  const first = await operations.deposit(depositRequest);
  const later = await operations.resume(depositRequest);
  assert.deepEqual(first, later);
  assert.equal(world.stats().effects, 1);
  assert.equal(world.stats().sends, 1);
  assert.equal(auth.gets.filter((o) => o.extensions?.prf).length, 2);
  console.log(
    JSON.stringify({
      kind: 'emitted-public-import-recipe',
      sameIdPreserved: true,
      senderEffects: 1,
      prfAssertionsPerOperation: [1, 1],
      native: false,
      realProvider: false,
    }),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

const compiledHost = process.argv[3];
assert.ok(compiledHost);
const { inspectHostProofs } = await import(pathToFileURL(compiledHost).href);
let getterCalls = 0;
const accessorPorts = Object.defineProperty({}, 'authoriser', {
  get() {
    getterCalls++;
    throw Error('port getter must stay uncalled');
  },
});
assert.equal(
  inspectHostProofs(accessorPorts, { operation: 'withdraw-unshielded' }, {}, {}).configuration
    .status,
  'configuration-incomplete',
);
assert.equal(getterCalls, 0);
