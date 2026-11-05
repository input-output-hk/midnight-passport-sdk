// Opt-in source qualification only: synthetic credentials, actual native proofs and node.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { privateFiles, boundedWait, publicEvent } from './private-files.ts';
import {
  createPassportAccounts,
  spendUnshieldedWithGrant,
  checkUnshieldedGrant,
} from '../../../packages/account/dist/index.js';
import type {
  AccountRecord,
  AccountHint,
  CallRequest,
  PassportPorts,
} from '../../../packages/account/dist/ports/index.js';
import type { StagedJubjubGrant } from '../../../packages/account/dist/index.js';
import type { GrantScopeInput } from '../../../packages/protocol/dist/index.js';
import { createSessionJubjubAuthoriser } from '../../../packages/keys/dist/index.js';
import type { SessionKeyContext } from '../../../packages/keys/dist/index.js';
import {
  createHostedAccChain,
  createMidnightGrantSource,
} from '../../../packages/adapter-midnight-js/dist/index.js';
import { resolveBinding } from '../../../packages/contract/dist/index.js';
import * as binding from '../../../packages/contract/generated/acc-s3r1.1/index.js';
import { createDemoSession } from '../../passport-dapp/src/session.ts';
import { grantHandoffFromOpening } from '../../passport-dapp/src/grant-handoff.ts';
import {
  createSoftwareIdentity,
  softwareParticipant,
} from '../../../scripts/qualification/identities.mjs';
import {
  SESSION_ENDPOINTS,
  sessionProject,
} from '../../../scripts/qualification/session-profile.mjs';
import { dedicatedIndexerReadiness } from '../../../scripts/qualification/indexer-readiness.mjs';
import { confirmOriginalFunding } from '../../../examples/application-acc/native-funding.mjs';

const root = process.argv[2]!;
assert.ok(root && isAbsolute(root));
assert.equal(process.env.PASSPORT_SESSION_NATIVE, '1');
assert.equal(process.env.PASSPORT_RC_LOCALNET, '1');
assert.equal(process.env.MN_NETWORK_ID, 'undeployed');
assert.equal(process.env.MN_NODE_URL, SESSION_ENDPOINTS.nodeUrl);
assert.equal(process.env.MN_INDEXER_URL, SESSION_ENDPOINTS.indexerUrl);
assert.equal(process.env.MN_INDEXER_WS_URL, SESSION_ENDPOINTS.indexerWsUrl);
assert.equal(process.env.MN_PROOF_SERVER_URL, SESSION_ENDPOINTS.proverUrl);
assert.equal(process.env.WALLET_SEED, undefined);
assert.equal(process.env.PASSPORT_SPONSOR_SEED, undefined);
assert.equal(process.env.PASSPORT_SPONSOR_SEED_FILE, undefined);
const parent = JSON.parse(readFileSync(join(root, 'parent-receipt.private.json'), 'utf8'));
assert.equal(parent.project, process.env.PASSPORT_SESSION_PROJECT);
assert.equal(sessionProject(parent.project.slice('mn-passport-session-'.length)), parent.project);
assert.equal(parent.verdict, 'IN_PROGRESS');
assert.equal((await dedicatedIndexerReadiness(SESSION_ENDPOINTS)).ready, true);
const files = privateFiles(root);
assert.equal(
  files.exists('worker-started.json'),
  false,
  'Never replay a failed/uncertain session run.',
);
files.save('worker-started.json', { pid: process.pid, at: Date.now() });
process.chdir(root);
const contract = process.env.PASSPORT_CONTRACT_DIR!;
const req = createRequire(join(contract, 'package.json'));
const load = (name: string) => import(pathToFileURL(req.resolve(name)).href);
const reference = (name: string) => import(pathToFileURL(join(contract, name)).href);
const wallet = await reference('src/node/wallet.ts');
const wave = await reference('src/wallet/wave-deploy.ts');
const setup = await reference('src/node/setup.ts');
const { submitCallTx, deployContract } = await load('@midnight-ntwrk/midnight-js-contracts');
const ledger = await load('@midnightntwrk/ledger-v9');
const pure = binding.pureCircuits;
const { nativeBlockCapacity } = await import('../../../scripts/qualify-published-native-host.mjs');
const hex = (v: Uint8Array) => Buffer.from(v).toString('hex');
const hash = (v: Uint8Array) => createHash('sha256').update(v).digest('hex');
const rnd = () => new Uint8Array(randomBytes(32));
const recipientSeed = hex(rnd());
files.save('recipient-private.json', { seed: recipientSeed });
let funding: any,
  recipient: any,
  proofs = 0,
  proofAttempts = 0,
  attempts = 0;
const transactions: Array<{
  ordinal: number;
  hash: string;
  bytesSha256: string;
  phase: string;
  id?: string;
}> = [];
const arms: Array<{
  arm: string;
  account: string;
  asset: string;
  cases: string[];
  expiresAt: number;
  grantId: string;
}> = [];
const checkpoint = () =>
  files.save('effects-private.json', { proofs, proofAttempts, attempts, transactions });
const wire = (providers: any) => {
  const prove = providers.proofProvider.proveTx.bind(providers.proofProvider);
  providers.proofProvider.proveTx = async (...args: any[]) => {
    proofAttempts++;
    checkpoint();
    const result = await prove(...args);
    proofs++;
    checkpoint();
    return result;
  };
  const submit = providers.midnightProvider.submitTx.bind(providers.midnightProvider);
  providers.midnightProvider.submitTx = async (tagged: any) => {
    assert.equal(tagged.version, 'v9');
    const data = tagged.tx.serialize();
    const tx = {
      ordinal: transactions.length + 1,
      hash: tagged.tx.transactionHash(),
      bytesSha256: hash(data),
      phase: 'retained-before-send',
    };
    writeFileSync(join(root, `submitted-${tx.ordinal}.private.bin`), data, {
      flag: 'wx',
      mode: 0o600,
    });
    const retainedFd = openSync(join(root, `submitted-${tx.ordinal}.private.bin`), 'r');
    try {
      fsyncSync(retainedFd);
    } finally {
      closeSync(retainedFd);
    }
    const directoryFd = openSync(root, 'r');
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
    transactions.push(tx);
    checkpoint();
    attempts++;
    checkpoint();
    const id = await submit(tagged);
    Object.assign(tx, { id, phase: 'send-acknowledged' });
    checkpoint();
    return id;
  };
  return providers;
};
const post = async (url: string, body: unknown) => {
  // Reuse the existing canonical-finality verifier while mapping its historical dedicated URLs.
  const target =
    url === 'http://127.0.0.1:19954'
      ? SESSION_ENDPOINTS.nodeUrl
      : url === 'http://127.0.0.1:18098/api/v4/graphql'
        ? SESSION_ENDPOINTS.indexerUrl
        : undefined;
  assert.ok(target, 'Unexpected finality transport');
  const response = await fetch(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(response.ok);
  return response.json();
};
const finality = async (txHash: string) => confirmOriginalFunding(txHash, { post });
const cleanup = async () => {
  const result = await Promise.allSettled(
    [recipient, funding].filter(Boolean).map((c) => c.wallet.stop()),
  );
  files.save('wallet-cleanup.json', {
    wallets: result.length,
    stopped: result.filter((r) => r.status === 'fulfilled').length,
  });
  assert.ok(result.every((r) => r.status === 'fulfilled'));
};
process.once('SIGTERM', () => {
  void cleanup().finally(() => process.exit(143));
});
let exit = 1;
try {
  const { ApiPromise, WsProvider } = await load('@polkadot/api');
  const api = await ApiPromise.create({
    provider: new WsProvider('ws://127.0.0.1:19964'),
    noInitWarn: true,
  });
  try {
    const samples: unknown[] = [];
    let previous: string | undefined;
    await boundedWait(async () => {
      const hash = (await api.rpc.chain.getHeader()).hash.toHex();
      if (hash === previous) return false;
      previous = hash;
      const weights = await api.query.system.blockWeight.at(hash);
      const limits = api.consts.system.blockWeights;
      const values = {
        maxBlock: limits.maxBlock.refTime.toString(),
        maxNormal: limits.perClass.normal.maxExtrinsic.unwrap().refTime.toString(),
        baseExtrinsic: limits.perClass.normal.baseExtrinsic.refTime.toString(),
        mandatory: weights.mandatory.refTime.toString(),
        operational: weights.operational.refTime.toString(),
      };
      if (nativeBlockCapacity(values)) samples.push({ hash, ...values });
      else samples.length = 0;
      return samples.length === 3;
    }, 180000);
    files.save('node-capacity.json', { samples });
  } finally {
    await api.disconnect();
  }
  funding = await wallet.createWallet('0'.repeat(63) + '1');
  await wallet.syncWallet(funding, 'isolated-session-public-genesis');
  recipient = await wallet.createWallet(recipientSeed);
  await wallet.syncWallet(recipient, 'isolated-session-recipient');
  const providers = wire(await wallet.createProviders(funding));
  const compiled = setup.compiledAccountContract();
  const recipientAddress = hex(wallet.userAddressBytes(recipient));
  const sponsorAddress = wallet.userAddressBytes(funding);
  const faucetProviders = wire(
    await wallet.createProviders(funding, join(contract, 'contracts/managed/faucet')),
  );
  const faucet = await deployContract(faucetProviders, {
    compiledContract: setup.compiledFaucetContract(),
    privateStateId: 'session-faucet',
    initialPrivateState: {},
  });
  const faucetAddress = faucet.deployTxData.public.contractAddress;
  const expiryChecks: Array<() => Promise<void>> = [];
  publicEvent({ stage: 'faucet-deployed' });
  for (const arm of ['jubjub', 'p256'] as const) {
    const identity = await createSoftwareIdentity();
    files.save(`identity-${arm}.json`, identity);
    const participant = softwareParticipant(identity, arm);
    let ownerSigns = 0,
      childDerivations = 0;
    const authoriser = {
      ...participant.authoriser,
      authorise: async (request: Parameters<typeof participant.authoriser.authorise>[0]) => {
        ownerSigns++;
        return participant.authoriser.authorise(request);
      },
    };
    let record: AccountRecord | undefined, hint: AccountHint | undefined;
    const journal = new Map<string, StagedJubjubGrant>();
    const published = new Set<string>();
    let address: string | undefined;
    const readLedger = async (acc: string) => {
      assert.equal(acc, address);
      const state = await providers.publicDataProvider.queryContractState(acc);
      return state ? binding.ledger(state.data) : undefined;
    };
    const call = async (request: CallRequest) => {
      assert.equal(request.address, address);
      if (request.signal?.aborted) throw Error('Cancelled before native call');
      return submitCallTx(providers, {
        compiledContract: compiled,
        contractAddress: address,
        circuitId: request.circuit,
        privateStateId: `session-${arm}`,
        args: request.args,
      });
    };
    const chain = createHostedAccChain({
      network: { bindingId: 'acc-s3r1.1', manifestSha256: parent.binding.compilerManifestSha256 },
      binding: { id: 'acc-s3r1.1', ...resolveBinding('acc-s3r1.1') },
      readLedger,
      connectHandle: async (acc) => {
        assert.equal(acc, address);
        return {
          callTx: new Proxy(
            {},
            {
              get:
                (_target, name) =>
                (...args: unknown[]) =>
                  call({ address: acc, circuit: String(name), args }),
            },
          ),
        };
      },
    });
    const network = {
      networkId: 'undeployed',
      bindingId: 'acc-s3r1.1',
      manifestSha256: parent.binding.compilerManifestSha256,
      ...SESSION_ENDPOINTS,
      indexerWsUrl: SESSION_ENDPOINTS.indexerWsUrl,
      artefactUrl: '',
    };
    const grants = createMidnightGrantSource({
      network,
      binding,
      openings: {
        readReadPublicKey: async (_acc, id) => journal.get(id)?.bookkeeping.readPublicKey,
      },
      publicDataProvider: providers.publicDataProvider,
    });
    const ports: PassportPorts = {
      network,
      binding,
      chain,
      authoriser,
      credentials: participant.credentials,
      viewingKey: participant.keyring,
      encryptionKey: {
        publicKey: async () => {
          throw Error('Sealed flow only');
        },
      },
      directory: {
        get: async () => hint,
        put: async (_network, value) => {
          hint = value;
          files.save(`hint-${arm}.json`, hint);
        },
      },
      records: {
        read: async () => record,
        exists: async () => !!record,
        write: async (value) => {
          record = value;
          files.save(`record-${arm}.json`, record);
        },
      },
      holdings: { selectHeldEntries: async () => [] },
      readGrants: grants,
      grants,
      grantCommitments: grants,
      grantDetails: grants,
      grantRoster: grants,
      grantOrigin: 'localhost',
      grantJournal: {
        stage: async (opening) => {
          journal.set(opening.bookkeeping.grantId, opening);
          files.save(`grants-${arm}.json`, [...journal]);
        },
        load: async (_acc, id) => journal.get(id),
        pending: async () => [...journal.keys()].filter((id) => !published.has(id)),
        markPublished: async (_acc, id) => {
          published.add(id);
          files.save(`published-${arm}.json`, [...published]);
        },
      },
      deployer: {
        deploy: async (request) => {
          const first = transactions.length;
          address = await wave.deployAccountInWaves(providers, compiled, {
            firstArm: arm,
            privateStateId: `session-${arm}`,
            initialPrivateState: {},
            retireAuthority: true,
            args: [
              request.boot,
              request.encKey,
              pure.compute_public_point_with_jubjub(13n),
              new Uint8Array(64),
              60n,
            ],
          });
          files.save(`address-${arm}.json`, { address });
          const state = await providers.publicDataProvider.queryContractState(address);
          const installed = ledger.ContractState.deserialize(state.serialize());
          assert.equal(installed.operations().length, 52);
          for (const [id, expected] of Object.entries(binding.expectedVk))
            assert.equal(hash(installed.operation(id).verifierKey), expected);
          assert.deepEqual(installed.maintenanceAuthority.committee, []);
          assert.equal(installed.maintenanceAuthority.threshold, 1);
          return { address: address!, txIds: transactions.slice(first).map((tx) => tx.id!) };
        },
      },
      random: (length) => new Uint8Array(randomBytes(length)),
    };
    const account = await createPassportAccounts(ports).createAccount({
      userName: `native-session-${arm}`,
      retireAuthority: true,
    });
    address = account.address;
    const cases: string[] = ['full-acc-deployment-and-sealed-owner-open'];
    const colorDomain = rnd();
    const color = hex(ledger.encodeRawTokenType(ledger.rawTokenType(colorDomain, faucetAddress)));
    // A dedicated exact-value synthetic asset avoids sharing any NIGHT fixture or sponsor UTXO.
    await faucet.callTx.mint_unshielded(colorDomain, 12n, { bytes: sponsorAddress });
    const Rx = await load('rxjs');
    const balance = async (context: any, amount: bigint) =>
      Rx.firstValueFrom(
        context.wallet.state().pipe(
          Rx.filter(
            (s: any) => s.isSynced && BigInt(s.unshielded.balances[color] ?? 0n) === amount,
          ),
          Rx.timeout(120000),
        ),
      );
    await balance(funding, 12n);
    await chain.call({
      address,
      circuit: 'deposit_unshielded',
      args: [Buffer.from(color, 'hex'), 12n],
    });
    assert.equal(
      (await readLedger(address))!.unshielded_balances.lookup(Buffer.from(color, 'hex')),
      12n,
    );
    cases.push('exact-synthetic-asset-deposit-12');
    let sessionContext: SessionKeyContext | undefined;
    const source = {
      ...participant.source,
      deriveSecret: async (input: Parameters<typeof participant.source.deriveSecret>[0]) => {
        childDerivations++;
        return participant.source.deriveSecret(input);
      },
    };
    const session = createDemoSession({
      unlock: async (_account, context) => {
        sessionContext = context;
        return createSessionJubjubAuthoriser(source, pure, context);
      },
      opening: async (_acc, id) =>
        grantHandoffFromOpening(
          journal.get(id)!,
          await grants.readGrantCommitment(address!, id),
          await grants.readGrantSpendContext(address!, id),
          'undeployed',
          pure,
        ),
      spend: async (opening, key, amount, spentPrev, signal) =>
        spendUnshieldedWithGrant(
          { ...opening, amount, spentPrev },
          { pure, source: grants, chain, grantee: key, review: async () => !signal.aborted },
          { signal },
        ),
      changed: (snapshot) => files.save(`checkpoint-${arm}.json`, snapshot),
    });
    const scope: GrantScopeInput = {
      grantee: { scheme: 'jubjub-schnorr', publicKey: '00'.repeat(32) },
      operations: ['withdraw-unshielded'],
      color,
      recipient: { kind: 'user-address', value: recipientAddress },
      maxCoinValue: '12',
      perCallCap: '2',
      cap: '4',
      expiresAt: null,
    };
    await session.start(account, scope, 10, 'localhost');
    assert.equal(session.snapshot().status, 'active');
    assert.equal(childDerivations, 1);
    const firstId = session.snapshot().grantId!;
    const firstOpening = journal.get(firstId)!;
    const oldCopy = await createSessionJubjubAuthoriser(participant.source, pure, sessionContext!);
    cases.push('owner-approved-ten-minute-child-grant');
    const transfer = { color, recipient: recipientAddress, amount: '2' };
    const before = { ownerSigns, childDerivations, proofs, attempts };
    assert.equal(session.matches(account, { ...transfer, amount: '3' }), false);
    assert.equal(session.matches(account, { ...transfer, recipient: '91'.repeat(32) }), false);
    assert.deepEqual({ ownerSigns, childDerivations, proofs, attempts }, before);
    await session.spend(account, transfer);
    assert.equal(ownerSigns, before.ownerSigns);
    assert.equal(childDerivations, before.childDerivations);
    assert.ok(proofs > before.proofs && attempts > before.attempts);
    assert.equal(session.snapshot().spent, '2');
    await balance(recipient, 2n);
    assert.equal(
      (await readLedger(address))!.unshielded_balances.lookup(Buffer.from(color, 'hex')),
      10n,
    );
    cases.push('session-withdrawal-and-distinct-recipient-credit-no-owner-signing');
    const handoff = grantHandoffFromOpening(
      firstOpening,
      await grants.readGrantCommitment(address, firstId),
      await grants.readGrantSpendContext(address, firstId),
      'undeployed',
      pure,
    );
    const intent = { ...handoff, amount: '1', spentPrev: '2' };
    const refusal = async (work: () => Promise<unknown>, expected: RegExp | { code: string }) => {
      const counts = { proofs, proofAttempts, attempts, ownerSigns, childDerivations };
      const state = await providers.publicDataProvider.queryContractState(address);
      const digest = hash(state.serialize());
      await assert.rejects(work, expected);
      assert.deepEqual({ proofs, proofAttempts, attempts, ownerSigns, childDerivations }, counts);
      assert.equal(
        hash((await providers.publicDataProvider.queryContractState(address)).serialize()),
        digest,
      );
    };
    await refusal(
      () =>
        spendUnshieldedWithGrant(
          { ...intent, recipient: '92'.repeat(32) },
          { pure, source: grants, chain, grantee: oldCopy.authoriser, review: async () => true },
        ),
      { code: 'GrantScopeInvalid' },
    );
    await refusal(
      () =>
        spendUnshieldedWithGrant(
          { ...intent, spentPrev: '0' },
          { pure, source: grants, chain, grantee: oldCopy.authoriser, review: async () => true },
        ),
      { code: 'GrantScopeInvalid' },
    );
    cases.push('wrong-recipient-and-stale-spend-opening-refused-before-proof');
    session.lock();
    assert.equal(session.snapshot().status, 'locked');
    const signsBeforeRevoke = ownerSigns;
    await session.revoke(account);
    assert.ok(ownerSigns > signsBeforeRevoke);
    assert.equal((await grants.readGrantSpendContext(address, firstId))!.active, false);
    await refusal(
      () =>
        spendUnshieldedWithGrant(intent, {
          pure,
          source: grants,
          chain,
          grantee: oldCopy.authoriser,
          review: async () => true,
        }),
      { code: 'GrantRevoked' },
    );
    oldCopy.dispose();
    cases.push('fresh-owner-revocation-blocks-copied-child');
    await session.start(account, scope, 10, 'localhost');
    assert.notEqual(session.snapshot().grantId, firstId);
    assert.notEqual(
      journal.get(session.snapshot().grantId!)!.scope.grantee.publicKey,
      firstOpening.scope.grantee.publicKey,
    );
    assert.equal(childDerivations, 2);
    const renewal = session.snapshot();
    const finalOpening = grantHandoffFromOpening(
      journal.get(renewal.grantId!)!,
      await grants.readGrantCommitment(address, renewal.grantId!),
      await grants.readGrantSpendContext(address, renewal.grantId!),
      'undeployed',
      pure,
    );
    cases.push('renewal-uses-distinct-child-and-new-owner-approval');
    arms.push({
      arm,
      account: address,
      asset: color,
      cases,
      expiresAt: renewal.expiresAt!,
      grantId: renewal.grantId!,
    });
    files.save('arms-progress.json', arms);
    expiryChecks.push(async () => {
      assert.equal(session.snapshot().status, 'expired');
      await refusal(() => session.spend(account, transfer), /outside the active session scope/);
      const indexed = await dedicatedIndexerReadiness(SESSION_ENDPOINTS);
      assert.ok(indexed.ready && indexed.timestamp! >= renewal.expiresAt!);
      assert.throws(
        () =>
          checkUnshieldedGrant(
            { ...finalOpening, amount: '1', spentPrev: '0' },
            undefined,
            pure,
            Math.floor(Date.now() / 1000),
          ),
        { code: 'GrantNotFound' },
      );
      const live = await grants.readGrantSpendContext(address!, renewal.grantId!);
      assert.ok(live?.active && live.expiresAt === BigInt(renewal.expiresAt! / 1000));
      assert.throws(
        () =>
          checkUnshieldedGrant(
            { ...finalOpening, amount: '1', spentPrev: '0' },
            live,
            pure,
            Math.floor(indexed.timestamp! / 1000),
          ),
        { code: 'GrantScopeInvalid' },
      );
      cases.push('real-deadline-local-lock-and-indexed-chain-time-expiry-refusal');
      const signs = ownerSigns;
      await session.revoke(account);
      assert.ok(ownerSigns > signs);
      assert.equal((await grants.readGrantSpendContext(address!, renewal.grantId!))!.active, false);
      cases.push('expired-slot-reclaimed-by-fresh-owner-revocation');
      files.save('arms-progress.json', arms);
    });
    publicEvent({
      sessionArm: arm,
      stage: 'renewed-waiting-real-expiry',
      expiresAt: renewal.expiresAt,
    });
  }
  const lastExpiry = Math.max(...arms.map((a) => a.expiresAt));
  while (Date.now() < lastExpiry + 18000) {
    publicEvent({
      stage: 'waiting-real-chain-expiry',
      remainingSeconds: Math.ceil((lastExpiry + 18000 - Date.now()) / 1000),
    });
    await delay(Math.min(15000, Math.max(1, lastExpiry + 18000 - Date.now())));
  }
  await boundedWait(async () => {
    const state = await dedicatedIndexerReadiness(SESSION_ENDPOINTS);
    return !!state.ready && state.timestamp! >= lastExpiry;
  }, 120000);
  for (const check of expiryChecks) await check();
  const confirmed = [];
  for (const tx of transactions) confirmed.push(await finality(tx.hash));
  const receipt = {
    schema: 1,
    kind: 'source-native-session-controller',
    verdict: 'PASS',
    sourceCommit: parent.source.commit,
    arms,
    proofs,
    proofAttempts,
    submissions: attempts,
    retainedBeforeSend: transactions.length,
    canonicalFinality: confirmed,
    syntheticCredentials: true,
    syntheticAssetNotNight: true,
    realProviderQualified: false,
    browserNativeCombined: false,
    maliciousProofNodeRejectionQualified: false,
    limitations: [
      'Synthetic PRF/owner credentials; no real-provider prompts.',
      'Two actual ten-minute demo sessions per arm; expiry refusal is SDK pre-proof against indexed native chain time, not a malicious proof/node rejection.',
      'Native value path uses the hosted Chain port directly; browser HTTP/consent/lock-loss behavior is separately covered by Chromium tests.',
      'Dedicated faucet token, not an additional NIGHT funding qualification.',
      'Source packages, not registry/image acceptance.',
    ],
  };
  files.save('session-receipt.json', receipt);
  exit = 0;
} catch (error) {
  files.save('worker-failure.json', {
    errorSha256: createHash('sha256').update(String(error)).digest('hex'),
    proofs,
    proofAttempts,
    attempts,
  });
  throw error;
} finally {
  await cleanup();
}
process.exit(exit);
