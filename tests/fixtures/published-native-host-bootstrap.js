// Child of the audited opt-in native runner. Private fixture material never leaves this root.
import assert from 'node:assert/strict';
import { nativeWorkerConfiguration } from './native-worker-inputs.mjs';
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
const runtime = nativeWorkerConfiguration(source, process.env);
assert.equal(runtime.keyDir, keyDir);
const { m } = await import('@laceio/sdk/experimental');
const { PRF_LABEL_AUTHORISER, PRF_LABEL_ROOT, prfSalt } =
  await import('@input-output-hk/mn-passport-keys');
const hostRequire = createRequire(import.meta.resolve('@laceio/sdk/experimental'));
const { defer } = hostRequire('rxjs');
const { ApiPromise, WsProvider } = hostRequire('@polkadot/api');
const ledger = await import(pathToFileURL(hostRequire.resolve('@midnightntwrk/ledger-v9')));
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
writeFileSync(privatePath, JSON.stringify(material) + '\n', {
  flag: 'wx',
  mode: 0o600,
});
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
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode('passport-native-record:v1'),
    },
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
// Connect before constructing TTL-bound transactions; inspect only, never submit here.
const relay = await ApiPromise.create({
  provider: new WsProvider('ws://127.0.0.1:19954'),
  noInitWarn: true,
});
const { nativeBlockCapacity } = await import(
  pathToFileURL(join(sdk, 'scripts/qualify-published-native-host.mjs'))
);
async function waitForCapacity() {
  const deadline = Date.now() + 20 * 60_000;
  const samples = [];
  let previous;
  checkpoint('node-capacity-wait');
  while (samples.length < 3) {
    assert.ok(Date.now() < deadline, 'Node has no normal transaction headroom; no wallet started');
    const hash = (await relay.rpc.chain.getHeader()).hash.toHex();
    if (hash !== previous) {
      previous = hash;
      const blockWeight = await relay.query.system.blockWeight.at(hash);
      const limits = relay.consts.system.blockWeights;
      const values = {
        maxBlock: limits.maxBlock.refTime.toString(),
        maxNormal: limits.perClass.normal.maxExtrinsic.unwrap().refTime.toString(),
        baseExtrinsic: limits.perClass.normal.baseExtrinsic.refTime.toString(),
        mandatory: blockWeight.mandatory.refTime.toString(),
        operational: blockWeight.operational.refTime.toString(),
      };
      if (nativeBlockCapacity(values)) samples.push({ hash, ...values });
      else samples.length = 0;
    }
    if (samples.length < 3) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  writeFileSync(
    join(root, 'node-capacity.public.json'),
    JSON.stringify({ samples }, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  checkpoint('node-capacity-ready', { blocks: samples.length });
}
async function retainBalanced(bytes, count) {
  assert.ok(bytes instanceof Uint8Array && bytes.length > 0);
  assert.ok(Number.isSafeInteger(count) && count > 0);
  const name = 'balanced-' + String(count).padStart(4, '0');
  writeFileSync(join(root, name + '.private.bin'), bytes, {
    flag: 'wx',
    mode: 0o600,
  });
  const tx = ledger.Transaction.deserialize('signature', 'proof', 'binding', bytes);
  const cost = await relay.call.midnightRuntimeApi.getTransactionCost(
    '0x' + Buffer.from(bytes).toString('hex'),
  );
  assert.ok(cost.isOk, 'Node refused transaction cost preflight; preserve balanced bytes');
  const costWeight = cost.asOk.toBigInt();
  // The runtime adds this storage-configured dispatch overhead to ledger gas.
  const extra = await relay.query.midnight.configurableTransactionSizeWeight();
  const overhead = extra.refTime.toBigInt();
  const weight = costWeight + overhead;
  const limits = relay.consts.system.blockWeights;
  const maxExtrinsic = limits.perClass.normal.maxExtrinsic.unwrap().refTime.toBigInt();
  const maxTotal = limits.perClass.normal.maxTotal.unwrap().refTime.toBigInt();
  const baseExtrinsic = limits.perClass.normal.baseExtrinsic.refTime.toBigInt();
  const baseBlock = limits.baseBlock.refTime.toBigInt();
  const metadata = {
    count,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    transactionHash: tx.transactionHash(),
    identifiers: tx.identifiers(),
    ttl: Array.from(tx.intents ?? [], ([segment, intent]) => ({
      segment,
      ttl: intent.ttl.toISOString(),
      actions: intent.actions.length,
    })),
    costWeight: String(costWeight),
    overhead: String(overhead),
    weight: String(weight),
    maxExtrinsic: String(maxExtrinsic),
    maxTotal: String(maxTotal),
    baseExtrinsic: String(baseExtrinsic),
    baseBlock: String(baseBlock),
  };
  writeFileSync(join(root, name + '.public.json'), JSON.stringify(metadata, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  checkpoint('balanced-transaction-retained', {
    count,
    bytes: bytes.length,
    sha256: metadata.sha256,
    costWeight: String(costWeight),
    overhead: String(overhead),
    weight: String(weight),
  });
  assert.ok(
    weight <= maxExtrinsic && weight + baseExtrinsic + baseBlock <= maxTotal,
    'Balanced transaction exceeds normal-class node weight limits; refused before host submission',
  );
}
let signerHarness;
let extension = {};
if (source.profile === 'hosted-authorising') {
  const { createPublicSignerHarness } = await import('./public-signer-harness.js');
  const publicSource = await import(
    pathToFileURL(join(runtime.signerRoot, 'bundle/handlers.mjs')).href
  );
  signerHarness = await createPublicSignerHarness({
    source: publicSource,
    owner,
    root,
    forbiddenSecrets: [material.owner.device, material.owner.root],
  });
  const { loadNativeHdModule, nativeSponsorKeys } = await import('./native-hd.mjs');
  const { createNativeProvingProvider } = await import('./native-proving-provider.mjs');
  const sponsorKeys = nativeSponsorKeys(
    await loadNativeHdModule(hostRequire.resolve('@laceio/sdk/experimental')),
    ledger,
  );
  const lookupKey = publicSource.createManifestKeyMaterialResolver({
    artefactUrl: 'http://127.0.0.1:18798/v1/zk/acc-s3r1.1',
    fetchBytes: async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
      assert.ok(response.ok, 'Pinned proving material fetch failed');
      return new Uint8Array(await response.arrayBuffer());
    },
  });
  extension = {
    validateHostedProver: (prover) => {
      createNativeProvingProvider({ prover, lookupKey, parseCheckResult: ledger.parseCheckResult });
    },
    remote: {
      authoriser: signerHarness.seams.authoriser,
      setDecision: signerHarness.setDecision,
      requestCount: () => signerHarness.stats().requests.length,
    },
    conversions: {
      account: publicSource.AccAddress,
      epoch: publicSource.DeviceEpoch,
      counter: publicSource.UseCounter,
      flow: (flow) => {
        publicSource.decodeSignerFlow(flow);
        return structuredClone(flow);
      },
    },
    sponsorKeys,
    proveTx: async (bytes, prover) => {
      const tx = ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', bytes);
      const proving = createNativeProvingProvider({
        prover,
        parseCheckResult: ledger.parseCheckResult,
        lookupKey,
      });
      const proven = await tx.prove(proving, ledger.CostModel.initialCostModel());
      return { tx: proven.serialize(), provenance: 'remote' };
    },
    submit: async (bytes) => {
      const tx = ledger.Transaction.deserialize('signature', 'proof', 'binding', bytes);
      const ids = tx.identifiers();
      assert.ok(ids.length > 0);
      const txId = ids.at(-1); // Same intent-selection convention as the public host provider.
      assert.match(txId, /^00[a-f0-9]{64}$/);
      checkpoint('sdk-native-submit-start', { txId, bytes: bytes.length });
      // No retry. Any interruption after this call is uncertain and retains the original ID.
      await new Promise((resolve, reject) => {
        let unsubscribe,
          settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          unsubscribe?.();
          error ? reject(error) : resolve();
        };
        relay.tx.midnight
          .sendMnTransaction('0x' + Buffer.from(bytes).toString('hex'))
          .send((result) => {
            if (
              result.dispatchError ||
              result.status.isInvalid ||
              result.status.isDropped ||
              result.status.isUsurped
            )
              finish(Error('Native SDK submission rejected; retain original intent'));
            else if (result.status.isInBlock || result.status.isFinalized) finish();
          })
          .then((stop) => {
            unsubscribe = stop;
            if (settled) stop();
          })
          .catch(reject);
      });
      return txId;
    },
  };
}
try {
  await waitForCapacity();
  const { runNativeHost } = await import('./compiled/native-core.js');
  const receipt = await runNativeHost({
    owner,
    grantee,
    credentialId: Uint8Array.from(Buffer.from(material.owner.id, 'base64url')),
    records,
    readRecord,
    retainBalanced,
    checkpoint,
    ...extension,
  });
  assert.equal(draws.creations, 0);
  assert.ok(draws.owner > 0 && draws.grantee > 0);
  await checkKeys();
  writeFileSync(
    join(root, 'native-result.json'),
    JSON.stringify(
      {
        ...receipt,
        draws,
        keyProfile: profile.name,
        keyCircuits: profile.circuits,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  checkpoint('native-orchestration-complete', {
    testsPassed: receipt.testsPassed,
  });
} finally {
  if (signerHarness) {
    await signerHarness.close();
    writeFileSync(
      join(root, 'signer-transport-result.json'),
      JSON.stringify(signerHarness.stats(), null, 2) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  }
  await relay.disconnect();
  await new Promise((resolve) => server.close(resolve));
}

process.exit(0); // The public wallet API exposes no module-store shutdown; all owned I/O is closed.
