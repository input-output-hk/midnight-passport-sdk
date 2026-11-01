// Child of the audited opt-in native runner. Private fixture material never leaves this root.
import assert from 'node:assert/strict';
import {
  createReadStream,
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  lstatSync,
  renameSync,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

assert.equal(process.env.PASSPORT_NATIVE_CHILD, '1');
assert.equal(process.env.IN_NIX_SHELL !== undefined, true);
assert.equal(process.env.MN_NETWORK_ID, 'undeployed');
const root = resolve(import.meta.dirname);
const sdk = process.env.PASSPORT_NATIVE_SDK_ROOT;
const keyDir = process.env.PASSPORT_KEY_DIR;
assert.ok(sdk && keyDir);
assert.equal(lstatSync(keyDir).isSymbolicLink(), false);
const source = JSON.parse(readFileSync(join(root, 'native-inputs.json'), 'utf8'));
assert.equal(source.kind, 'published-host-native-inputs');
assert.equal(source.keyDirSha256, createHash('sha256').update(keyDir).digest('hex'));
const { m } = await import('@laceio/sdk/experimental');
const { PRF_LABEL_AUTHORISER, PRF_LABEL_ROOT, prfSalt } =
  await import('@input-output-hk/mn-passport-keys');
const { defer } = createRequire(import.meta.resolve('@laceio/sdk/experimental'))('rxjs');
const { loadBundle, createKeyServer } = await import(
  pathToFileURL(join(sdk, 'apps/passport-key-service/src/server.mjs'))
);
const { selectKeyProfile } = await import(
  pathToFileURL(join(sdk, 'apps/passport-key-service/src/profiles.mjs'))
);
const contract = join(root, '..', 'node_modules/@input-output-hk/mn-passport-contract');
const loaded = loadBundle(
  join(contract, 'resources/acc-s3r1.1.zkir.json.gz'),
  'acc-s3r1.1',
  source.compilerManifestSha256,
);
const profile = selectKeyProfile('jubjub-owner-v1', loaded.provers);
async function checkKeys() {
  for (const circuit of profile.circuits) {
    const path = join(keyDir, circuit + '.prover'),
      pin = loaded.provers.get(circuit + '.prover');
    const stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(stat.size, pin.size);
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(path)) hash.update(bytes);
    assert.equal(hash.digest('hex'), pin.hash, 'Existing proving key differs: ' + circuit);
  }
}
await checkKeys();
const server = createKeyServer({
  ...loaded,
  bindingId: 'acc-s3r1.1',
  keyManifestBytes: readFileSync(join(contract, 'resources/acc-s3r1.1.key-manifest.json')),
  keyDir,
  profile,
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(18798, '127.0.0.1', resolve);
});
let sequence = 0;
function checkpoint(stage, data = {}) {
  appendFileSync(
    join(root, 'operations.private.jsonl'),
    JSON.stringify({ sequence: ++sequence, at: Date.now(), stage, ...data }) + '\n',
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ stage, ...data }));
}
checkpoint('verified-key-http-ready', { circuits: profile.circuits.length });
const privatePath = join(root, 'synthetic-identities.private.json');
assert.equal(
  existsSync(privatePath),
  false,
  'Never regenerate credentials in a retained native run',
);
const material = {
  owner: {
    id: randomBytes(16).toString('base64url'),
    device: randomBytes(32).toString('hex'),
    root: randomBytes(32).toString('hex'),
  },
  grantee: {
    id: randomBytes(16).toString('base64url'),
    device: randomBytes(32).toString('hex'),
    root: randomBytes(32).toString('hex'),
  },
};
writeFileSync(privatePath, JSON.stringify(material) + '\n', { flag: 'wx', mode: 0o600 });
const draws = { owner: 0, grantee: 0, creations: 0 };
function keySource(name) {
  const data = material[name],
    id = Buffer.from(data.id, 'base64url');
  return m.createPasskeySessionKeySource({
    credentialId: data.id,
    rpId: 'localhost',
    credentials: {
      create: async () => {
        draws.creations++;
        throw Error('The synthetic credential is already enrolled');
      },
      get: async (options) => {
        assert.equal(options.publicKey.rpId, 'localhost');
        assert.equal(options.publicKey.allowCredentials.length, 1);
        assert.deepEqual(Buffer.from(options.publicKey.allowCredentials[0].id), id);
        const salts = options.publicKey.extensions.prf.eval;
        assert.deepEqual(new Uint8Array(salts.first), prfSalt(PRF_LABEL_AUTHORISER));
        assert.deepEqual(new Uint8Array(salts.second), prfSalt(PRF_LABEL_ROOT));
        draws[name]++;
        return {
          rawId: Uint8Array.from(id).buffer,
          getClientExtensionResults: () => ({
            prf: {
              results: {
                first: Uint8Array.from(Buffer.from(data.device, 'hex')).buffer,
                second: Uint8Array.from(Buffer.from(data.root, 'hex')).buffer,
              },
            },
          }),
        };
      },
    },
  });
}
const owner = keySource('owner'),
  grantee = keySource('grantee');
let recordNumber = 0;
const recordPath = join(root, 'account-record.sealed.json');
mkdirSync(join(root, 'record-history'), { mode: 0o700 });
async function readRecord() {
  if (!existsSync(recordPath)) return undefined;
  const box = JSON.parse(readFileSync(recordPath, 'utf8'));
  const bytes = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: Buffer.from(box.iv, 'hex'),
      additionalData: new TextEncoder().encode('passport-native-record:v1'),
    },
    await owner.recordKey(),
    Buffer.from(box.ciphertext, 'hex'),
  );
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function writeRecord(record) {
  const iv = randomBytes(12);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('passport-native-record:v1') },
    await owner.recordKey(),
    new TextEncoder().encode(JSON.stringify(record)),
  );
  const box =
    JSON.stringify({
      pending: record.deployment !== undefined,
      iv: iv.toString('hex'),
      ciphertext: Buffer.from(encrypted).toString('hex'),
    }) + '\n';
  writeFileSync(
    join(root, 'record-history', String(++recordNumber).padStart(4, '0') + '.json'),
    box,
    { flag: 'wx', mode: 0o600 },
  );
  writeFileSync(recordPath + '.next', box, { flag: 'wx', mode: 0o600 });
  renameSync(recordPath + '.next', recordPath);
  checkpoint('sealed-account-record-written', {
    pending: record.deployment !== undefined,
    recordNumber,
  });
}
const records = {
  read: () => defer(readRecord),
  write: (record) =>
    defer(async () => {
      await writeRecord(record);
    }),
  presence: () =>
    defer(async () =>
      !existsSync(recordPath)
        ? 'absent'
        : JSON.parse(readFileSync(recordPath, 'utf8')).pending
          ? 'pending'
          : 'complete',
    ),
};
try {
  const { runNativeHost } = await import('./compiled/native-core.js');
  const receipt = await runNativeHost({
    owner,
    grantee,
    credentialId: Uint8Array.from(Buffer.from(material.owner.id, 'base64url')),
    records,
    readRecord,
    checkpoint,
  });
  assert.equal(draws.creations, 0);
  assert.ok(draws.owner > 0 && draws.grantee > 0);
  await checkKeys();
  writeFileSync(
    join(root, 'native-result.json'),
    JSON.stringify(
      { ...receipt, draws, keyProfile: profile.name, keyCircuits: profile.circuits },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  checkpoint('native-orchestration-complete', { testsPassed: receipt.testsPassed });
} finally {
  await new Promise((resolve) => server.close(resolve));
}

process.exit(0); // The public wallet API exposes no module-store shutdown; all owned I/O is closed.
