// Run inside an independent consumer with the four candidate packages installed.
// Actual generated circuit execution and software signatures; no proof or node.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as runtime from '@midnight-ntwrk/compact-runtime';
import { prepareJubjubGrant } from '@input-output-hk/mn-passport-account';
import { resolveBinding } from '@input-output-hk/mn-passport-contract';
import * as acc from '@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1';
import { recipeJubjubAuthoriser } from '@input-output-hk/mn-passport-keys';
import { prepareMerchantPayment } from './prepare-payment.mjs';

const [dependencyArg, merchantArg, outputArg] = process.argv.slice(2);
if (!dependencyArg || !merchantArg || !outputArg || process.argv.length !== 5)
  throw Error('usage: node qualify-offline.mjs <export-root> <compiled-merchant> <new-receipt>');
const dependency = resolve(dependencyArg);
const merchantRoot = resolve(merchantArg);
const output = resolve(outputArg);
// Reserve evidence before running anything. A failed run cannot be overwritten.
writeFileSync(output, JSON.stringify({ outcome: 'started', tier: 'compiled-offline' }) + '\n', {
  flag: 'wx',
  mode: 0o600,
});
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const b32 = (value) => new Uint8Array(Buffer.from(value, 'hex'));
const now = 1_800_000_000;
const color = new Uint8Array(randomBytes(32));
const recipient = new Uint8Array(randomBytes(32));
const p = acc.pureCircuits;
const completedCases = [];
let importedMerchant;
let exportedFiles;

function packageVersions() {
  return Object.fromEntries(
    ['protocol', 'account', 'keys', 'contract'].map((name) => {
      const packageName = `@input-output-hk/mn-passport-${name}`;
      const entry = fileURLToPath(import.meta.resolve(packageName));
      const metadata = JSON.parse(readFileSync(join(entry, '../../package.json'), 'utf8'));
      assert.equal(metadata.name, packageName);
      return [packageName, metadata.version];
    }),
  );
}

function verifyDependency() {
  const binding = resolveBinding('acc-s3r1.1');
  const manifestBytes = readFileSync(join(dependency, 'account/compiler/contract-manifest.json'));
  assert.equal(sha(manifestBytes), binding.manifestSha256);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  exportedFiles = {};
  for (const directory of ['contract', 'compiler', 'keys', 'zkir']) {
    for (const [name, pin] of Object.entries(manifest[directory])) {
      if (name === 'type' || name.endsWith('.prover')) continue;
      const bytes = readFileSync(join(dependency, 'account', directory, name));
      assert.equal(bytes.length, pin.size);
      assert.equal(sha(bytes), pin.hash);
      exportedFiles[`${directory}/${name}`] = pin.hash;
    }
  }
  // Do not use a receipt as its own authority: all file pins came from the
  // independently pinned compiler manifest above, not export-receipt.json.
  return binding.manifestSha256;
}

function signer(scalar) {
  const source = {
    withSession: async (work) => work(),
    deviceSecret: async () => {
      const bytes = new Uint8Array(32);
      bytes[0] = scalar;
      return bytes;
    },
    deriveSecret: async () => {
      throw Error('this software signing fixture derives no reader or HD seed');
    },
  };
  return recipeJubjubAuthoriser(source, p);
}

async function setup({ capacity = 3n } = {}) {
  const owner = signer(11);
  const grantee = signer(7);
  const ownerKey = await owner.devicePublicKey();
  const grantKey = await grantee.devicePublicKey();
  const accountAddress = runtime.sampleContractAddress();
  const appAddress = runtime.sampleContractAddress();
  const coinPublicKey = hex(randomBytes(32));
  const self = { bytes: b32(accountAddress) };
  const contract = new acc.Contract({
    held_coin: () => {
      throw Error('shielded witnesses are outside this example');
    },
  });
  const bootSalt = new Uint8Array(randomBytes(32));
  const init = await contract.initialState(
    runtime.createConstructorContext({}, coinPublicKey),
    p.derive_boot_commitment_with_jubjub(bootSalt, ownerKey),
    new Uint8Array(randomBytes(32)),
    p.compute_public_point_with_jubjub(13n),
    new Uint8Array(64),
    60n,
  );
  const state = init.currentContractState;
  // The state provider models an indexer with the real pinned operation keys.
  // This is not evidence of a deployment or a node-validated transcript.
  for (const [name, pin] of Object.entries(acc.expectedVk)) {
    const op = new runtime.ContractOperation();
    op.verifierKey = new Uint8Array(
      readFileSync(join(dependency, 'account/keys', `${name}.verifier`)),
    );
    assert.equal(sha(op.verifierKey), pin);
    state.setOperation(name, op);
  }
  const accountCall = async (circuitId, ...args) => {
    const result = await contract.impureCircuits[circuitId](
      runtime.createCircuitContext({
        circuitId,
        contractAddress: accountAddress,
        coinPublicKeyOrZswapState: coinPublicKey,
        contractState: state,
        privateState: {},
        time: now,
      }),
      ...args,
    );
    state.data = result.context.callContext.currentQueryContext.state;
  };
  await accountCall('activate_initial_device_with_jubjub', ownerKey, bootSalt);
  await accountCall('deposit_unshielded', color, 100n);
  const application = new importedMerchant.Contract({});
  const merchantInit = await application.initialState(
    runtime.createConstructorContext({}, coinPublicKey),
    self,
    color,
    { bytes: recipient },
    4n,
    capacity,
  );
  const appState = merchantInit.currentContractState;
  const prepared = prepareJubjubGrant(
    {
      account: accountAddress,
      origin: 'localhost',
      nowSeconds: now,
      activeGrantIds: [],
      scope: {
        grantee: { scheme: 'jubjub-schnorr', publicKey: await grantee.devicePublicKeyHex() },
        operations: ['withdraw-unshielded'],
        color: hex(color),
        recipient: { kind: 'user-address', value: hex(recipient) },
        maxCoinValue: '10',
        perCallCap: '4',
        cap: '12',
        expiresAt: now + 1000,
        caller: appAddress,
      },
    },
    p,
  );
  let ownerCounter = 0n;
  const ownerCall = async (operation, args, challengeArgs = args) => {
    const authNonce = acc.ledger(state.data).auth_nonce;
    const signature = await owner.authorise({
      account: accountAddress,
      circuit: `${operation}_with_jubjub`,
      args,
      witnessValues: [],
      authNonce,
      useCounter: ownerCounter,
      challenge: (r, grind) =>
        p[`challenge_${operation}_with_jubjub`](
          self,
          r,
          ownerKey,
          ...challengeArgs,
          authNonce,
          grind,
        ),
    });
    await accountCall(
      `${operation}_with_jubjub`,
      ...args,
      signature.pk,
      ownerCounter,
      signature.sigR,
      signature.sigS,
      signature.grindNonce,
    );
    ownerCounter++;
  };
  await ownerCall(
    'issue_grant',
    [b32(prepared.grantId), ...prepared.scopeArgs, prepared.scopeSalt],
    [b32(prepared.grantId), prepared.scopeDigest],
  );
  const liveGrant = () => acc.ledger(state.data).grants.lookup(b32(prepared.grantId));
  const read = async () => {
    const grant = liveGrant();
    const merchant = importedMerchant.ledger(appState.data);
    return {
      merchant: {
        address: appAddress,
        account: hex(merchant.payer.bytes),
        color: hex(merchant.asset),
        recipient: hex(merchant.merchant.bytes),
        price: merchant.price.toString(),
      },
      grant: {
        active: grant.active,
        issuedAt: grant.issued_at,
        nonce: grant.nonce,
        spentCommit: grant.spent_commit,
        objectCommit: grant.scope.object_commit,
        withdrawUnshielded: grant.scope.op_withdraw_unshielded,
        perCallCap: grant.scope.per_call_cap,
        cap: grant.scope.cap,
        expiresAt: grant.scope.expires_at,
        callerCommit: grant.scope.caller_commit,
      },
    };
  };
  const prepare = async (spentPrev = '0') =>
    prepareMerchantPayment(
      {
        account: accountAddress,
        grantId: prepared.grantId,
        granteePublicKey: await grantee.devicePublicKeyHex(),
        origin: 'localhost',
        slot: prepared.slot,
        scopeSalt: hex(prepared.scopeSalt),
        color: hex(color),
        amount: '4',
        recipient: hex(recipient),
        maxCoinValue: '10',
        spentPrev,
      },
      { pure: p, grantee, read, review: async () => true, nowSeconds: () => now },
    );
  const snapshot = () => ({
    account: sha(state.serialize()),
    application: sha(appState.serialize()),
  });
  const execute = async (approval, { address = appAddress, time = now, module = acc } = {}) => {
    const result = await application.circuits.pay(
      runtime.createCircuitContext({
        circuitId: 'pay',
        contractAddress: address,
        coinPublicKeyOrZswapState: coinPublicKey,
        contractState: appState,
        privateState: {},
        time,
        parentBlockHash: 'de'.repeat(32),
        crossContract: {
          stateProvider: {
            getContractState: async (_block, target) =>
              target === accountAddress ? state : undefined,
          },
          moduleProvider: {
            resolve: (target) => (target === accountAddress ? async () => module : undefined),
          },
        },
      }),
      approval,
    );
    assert.deepEqual(
      result.context.callProofDataTrace.map((entry) => entry.circuitId),
      ['withdraw_unshielded_with_grant_jubjub', 'pay'],
    );
    assert.ok(result.context.callProofDataTrace[0].commCommData);
    const accountAfter = result.context.queryContexts[accountAddress].state;
    const appAfter = result.context.queryContexts[address].state;
    // Commit both candidate states only after the entire call returns. Node
    // admission/rollback guarantees require the separate native qualification.
    state.data = accountAfter;
    appState.data = appAfter;
    return result;
  };
  return {
    prepare,
    execute,
    snapshot,
    grant: liveGrant,
    revoke: () => ownerCall('revoke_grant', [b32(prepared.grantId)]),
    balance: () => acc.ledger(state.data).unshielded_balances.lookup(color),
    payments: () => importedMerchant.ledger(appState.data).payments,
  };
}

async function check(name, work) {
  await work();
  completedCases.push(name);
}

try {
  const manifestSha256 = verifyDependency();
  importedMerchant = await import(pathToFileURL(join(merchantRoot, 'contract/index.js')).href);
  await check(
    'positive payment executes real ACC sub-call and increments merchant count',
    async () => {
      const f = await setup();
      await f.execute((await f.prepare()).approval);
      assert.equal(f.balance(), 96n);
      assert.equal(f.payments(), 1n);
      assert.equal(f.grant().nonce, 1n);
    },
  );
  for (const kind of [
    'wrong caller',
    'invalid signature',
    'expired',
    'revoked',
    'module substitution',
  ]) {
    await check(`${kind} refuses without committing either original state`, async () => {
      const f = await setup();
      const { approval } = await f.prepare();
      if (kind === 'revoked') await f.revoke();
      const before = f.snapshot();
      if (kind === 'invalid signature') approval.sig_s += 1n;
      await assert.rejects(
        f.execute(approval, {
          ...(kind === 'wrong caller' ? { address: runtime.sampleContractAddress() } : {}),
          ...(kind === 'expired' ? { time: now + 1001 } : {}),
          ...(kind === 'module substitution' ? { module: { ...acc, expectedVk: {} } } : {}),
        }),
        kind === 'wrong caller'
          ? /caller mismatch/
          : kind === 'expired'
            ? /grant expired/
            : kind === 'revoked'
              ? /grant revoked/
              : kind === 'module substitution'
                ? (error) => error.failure?.kind === 'ImplementationMismatch'
                : /signature/,
      );
      assert.deepEqual(f.snapshot(), before);
    });
  }
  await check('replay cannot debit or count twice', async () => {
    const f = await setup();
    const { approval } = await f.prepare();
    await f.execute(approval);
    const before = f.snapshot();
    await assert.rejects(f.execute(approval));
    assert.deepEqual(f.snapshot(), before);
    assert.equal(f.balance(), 96n);
    assert.equal(f.payments(), 1n);
  });
  await check(
    'merchant capacity failure after ACC execution commits neither candidate state',
    async () => {
      const f = await setup({ capacity: 1n });
      await f.execute((await f.prepare()).approval);
      const next = await f.prepare('4');
      const before = f.snapshot();
      await assert.rejects(f.execute(next.approval), /merchant payment limit reached/);
      assert.deepEqual(f.snapshot(), before);
      assert.equal(f.balance(), 96n);
      assert.equal(f.grant().nonce, 1n);
    },
  );
  const receipt = {
    schemaVersion: 1,
    tier: 'compiled-offline',
    outcome: 'passed',
    bindingId: 'acc-s3r1.1',
    compilerManifestSha256: manifestSha256,
    packageVersions: packageVersions(),
    merchantModuleSha256: sha(readFileSync(join(merchantRoot, 'contract/index.js'))),
    harnessSha256: sha(readFileSync(new URL(import.meta.url))),
    clientSha256: sha(readFileSync(new URL('./prepare-payment.mjs', import.meta.url))),
    verifiedDependencyFiles: Object.keys(exportedFiles).length,
    completedCases,
    nativeProofs: 0,
    nodeTransactions: 0,
    providerCeremonies: 0,
  };
  writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} catch (error) {
  writeFileSync(
    output,
    JSON.stringify(
      {
        schemaVersion: 1,
        tier: 'compiled-offline',
        outcome: 'failed',
        completedCases,
        nativeProofs: 0,
        nodeTransactions: 0,
        providerCeremonies: 0,
      },
      null,
      2,
    ) + '\n',
  );
  throw error;
}
