// Opt-in worker copied into a fresh, audited external consumer by the operator.
// The parent owns readiness, the stable native lease, container IDs and finality.
// wallet.ts and wave-deploy.ts are separately hash-pinned reference helpers;
// neither is part of the portable Passport package API.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serialize } from 'node:v8';

assert.equal(process.env.IN_NIX_SHELL !== undefined, true);
assert.equal(process.env.PASSPORT_MERCHANT_NATIVE, '1');
assert.equal(process.env.MN_NETWORK_ID, 'undeployed');
assert.equal(process.env.PASSPORT_SPONSOR_SEED, undefined);
assert.equal(process.env.PASSPORT_SPONSOR_SEED_FILE, undefined);
assert.equal(process.env.WALLET_SEED, undefined);
const root = resolve(import.meta.dirname);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const configBytes = readFileSync(join(root, 'native-config.private.json'));
assert.equal(sha(configBytes), process.env.PASSPORT_MERCHANT_CONFIG_SHA256);
const config = JSON.parse(configBytes.toString('utf8'));
for (const [file, pin] of Object.entries(config.files))
  assert.equal(sha(readFileSync(join(root, file))), pin, `Changed input: ${file}`);
for (const file of ['native-funding.mjs', 'native-observation.mjs', 'prepare-payment.mjs'])
  assert.match(config.files[file] ?? '', /^[0-9a-f]{64}$/, `Unpinned helper: ${file}`);
if (config.resumeFrom !== undefined) {
  assert.equal(config.resumeFrom, 'prior-native-run-v1');
  for (const name of [
    'operations.private.jsonl',
    'parent-receipt.private.json',
    'wallet-cleanup.private.json',
    'identities.private.json',
    ...Array.from({ length: 16 }, (_, i) => `submitted-${i + 1}.private.bin`),
  ])
    assert.match(
      config.files[`${config.resumeFrom}/${name}`] ?? '',
      /^[0-9a-f]{64}$/,
      `Unpinned original: ${name}`,
    );
}
const output = join(root, config.output);
assert.match(config.output, /^native-run-[a-z0-9-]+$/);
mkdirSync(output, { mode: 0o700 });
process.chdir(output);
process.env.PASSPORT_MERCHANT_MANAGED = join(root, 'managed');
process.env.MN_NODE_URL = 'http://127.0.0.1:19954';
process.env.MN_INDEXER_URL = 'http://127.0.0.1:18098/api/v4/graphql';
process.env.MN_INDEXER_WS_URL = 'ws://127.0.0.1:18098/api/v4/graphql/ws';
process.env.MN_PROOF_SERVER_URL = 'http://127.0.0.1:16310';
const hex = (value) => Buffer.from(value).toString('hex');
const bytes = (value) => new Uint8Array(Buffer.from(value, 'hex'));
const rnd = (n = 32) => new Uint8Array(randomBytes(n));
const stringify = (value) =>
  JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? String(v) : v));
let sequence = 0;
const event = (stage, data = {}) => {
  appendFileSync(
    join(output, 'operations.private.jsonl'),
    stringify({ sequence: ++sequence, at: Date.now(), stage, ...data }) + '\n',
    { mode: 0o600 },
  );
  console.log(stringify({ stage, ...data }));
};
let funding,
  recipientWallet,
  stage = 'inputs',
  submissions = 0,
  retainedTransactions = 0,
  proofs = 0;
const cases = [];
try {
  const {
    originalFundingInput,
    hasOriginalFundingInput,
    confirmOriginalFunding,
    assertOriginalFundingSpend,
  } = await import('./native-funding.mjs');
  const { merchantContinuation, confirmedCredit } = await import('./native-observation.mjs');
  let continuation;
  const priorFinality = [];
  if (config.resumeFrom !== undefined) {
    assert.equal(config.resumeFrom, 'prior-native-run-v1');
    const prior = (name) => JSON.parse(readFileSync(join(root, config.resumeFrom, name), 'utf8'));
    continuation = merchantContinuation({
      events: readFileSync(join(root, config.resumeFrom, 'operations.private.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
      parent: prior('parent-receipt.private.json'),
      walletCleanup: prior('wallet-cleanup.private.json'),
      source: config.resumeSourceCommit,
    });
    for (let i = 0; i < continuation.transactions.length; i++) {
      const data = readFileSync(join(root, config.resumeFrom, `submitted-${i + 1}.private.bin`));
      assert.equal(sha(data), continuation.transactions[i].hash);
    }
  }
  const [
    acc,
    { prepareJubjubGrant },
    { recipeJubjubAuthoriser },
    { prepareMerchantPayment },
    { CompiledContract },
    { deployContract, submitCallTx },
    wallet,
    wave,
    Rx,
  ] = await Promise.all([
    import('@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1'),
    import('@input-output-hk/mn-passport-account'),
    import('@input-output-hk/mn-passport-keys'),
    import('./prepare-payment.mjs'),
    import('@midnight-ntwrk/compact-js'),
    import('@midnight-ntwrk/midnight-js-contracts'),
    import('./wallet.ts'),
    import('./wave-deploy.ts'),
    import('rxjs'),
  ]);
  const app = await import(pathToFileURL(join(root, 'managed/merchant/contract/index.js')).href);
  const nativeLedger = await import('@midnightntwrk/ledger-v9');
  const pure = acc.pureCircuits;
  const signer = (secret) =>
    recipeJubjubAuthoriser(
      {
        withSession: async (fn) => fn(),
        deviceSecret: async () => secret.slice(),
        deriveSecret: async () => {
          throw Error('No reader/HD derivation in this fixture');
        },
      },
      pure,
    );
  const material = {
    owner: hex(rnd()),
    grantee: hex(rnd()),
    merchantSeed: hex(rnd()),
    bootSalt: hex(rnd()),
    encryptionKey: hex(rnd()),
  };
  if (continuation) {
    const prior = JSON.parse(
      readFileSync(join(root, config.resumeFrom, 'identities.private.json'), 'utf8'),
    );
    assert.match(prior.owner, /^[0-9a-f]{64}$/);
    material.owner = prior.owner;
  }
  writeFileSync(join(output, 'identities.private.json'), stringify(material) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  const owner = signer(bytes(material.owner)),
    grantee = signer(bytes(material.grantee));
  const ownerKey = await owner.devicePublicKey();
  stage = 'wallet-sync';
  funding = await wallet.createWallet('0'.repeat(63) + '1');
  await wallet.syncWallet(funding, 'dedicated public-genesis funding wallet');
  recipientWallet = await wallet.createWallet(material.merchantSeed);
  await wallet.syncWallet(recipientWallet, 'fresh merchant recipient');
  const recipient = wallet.userAddressBytes(recipientWallet),
    color = new Uint8Array(32);
  if (continuation) assert.notEqual(hex(recipient), continuation.originalRecipient);
  // A transfer to this same wallet may be finalized while its live view still reserves inputs.
  // Use a cold view of a separately retained transfer; never resubmit it or infer no send.
  assert.equal(config.fundingTransaction, 'funding-transfer.private.bin');
  assert.match(config.files[config.fundingTransaction] ?? '', /^[0-9a-f]{64}$/);
  const fundingBytes = readFileSync(join(root, config.fundingTransaction));
  assert.equal(sha(fundingBytes), config.files[config.fundingTransaction]);
  const fundingTransaction = nativeLedger.Transaction.deserialize(
    'signature',
    'proof',
    'binding',
    fundingBytes,
  );
  const fundingInput = originalFundingInput(
    fundingTransaction,
    hex(wallet.userAddressBytes(funding)),
  );
  const fundingFinality = await confirmOriginalFunding(fundingInput.hash, {
    post: async (url, body) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(response.ok, true);
      return response.json();
    },
  });
  event('original-funding-canonical', fundingFinality);
  const fundingWalletOwnerBech32 = funding.unshieldedKeystore.getBech32Address().asString();
  const waitForOriginalFunding = () =>
    Rx.firstValueFrom(
      funding.wallet.state().pipe(
        Rx.filter((state) =>
          hasOriginalFundingInput(state, fundingInput, fundingWalletOwnerBech32),
        ),
        Rx.timeout(120000),
      ),
    );
  if (!continuation) await waitForOriginalFunding();
  if (continuation) {
    stage = 'original-payment-reconciliation';
    for (const original of continuation.transactions)
      priorFinality.push(
        await confirmOriginalFunding(original.hash, {
          post: async (url, body) => {
            const response = await fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(15000),
            });
            assert.equal(response.ok, true);
            return response.json();
          },
        }),
      );
    event('original-transactions-canonical', {
      count: continuation.transactions.length,
      source: config.resumeSourceCommit,
    });
  }
  if (!continuation)
    event('original-funding-spendable', {
      txHash: fundingInput.hash,
      intentHash: fundingInput.intentHash,
      outputNo: fundingInput.outputNo,
      amount: '12',
    });
  const providers = await wallet.createProviders(funding);
  const transactions = [];
  let fundingDepositPending = false;
  const proof = providers.proofProvider.proveTx.bind(providers.proofProvider);
  providers.proofProvider.proveTx = async (...args) => {
    stage = 'prove';
    const result = await proof(...args);
    proofs++;
    stage = 'balance';
    return result;
  };
  const submit = providers.midnightProvider.submitTx.bind(providers.midnightProvider);
  providers.midnightProvider.submitTx = async (tagged) => {
    assert.equal(tagged.version, 'v9');
    if (tagged.version !== 'v9') throw Error('Only ledger-v9 is qualified');
    const tx = tagged.tx,
      data = tx.serialize(),
      hash = tx.transactionHash();
    const ordinal = ++retainedTransactions;
    writeFileSync(join(output, `submitted-${ordinal}.private.bin`), data, {
      flag: 'wx',
      mode: 0o600,
    });
    event('submission-retained-before-send', { ordinal, hash, bytesSha256: sha(data) });
    if (fundingDepositPending) {
      stage = 'funding-input-guard';
      assertOriginalFundingSpend(tx, fundingInput, nativeLedger.addressFromKey);
      event('original-funding-spend-bound', {
        hash,
        intentHash: fundingInput.intentHash,
        outputNo: fundingInput.outputNo,
      });
    }
    stage = 'node-submit';
    submissions++;
    const id = await submit(tagged);
    transactions.push({ hash, id });
    event('node-submit-returned', { ordinal, hash, id });
    stage = 'confirmation';
    return id;
  };
  const accountCompiled = CompiledContract.make('account', acc.Contract).pipe(
    CompiledContract.withWitnesses({
      held_coin: () => {
        throw Error('No shielded spending');
      },
    }),
    CompiledContract.withCompiledFileAssets(join(root, 'managed/account')),
  );
  const bootSalt = bytes(material.bootSalt);
  stage = 'account-deploy';
  const accountAddress =
    continuation?.account ??
    (await wave.deployAccountInWaves(providers, accountCompiled, {
      firstArm: 'jubjub',
      privateStateId: 'merchant-account',
      initialPrivateState: {},
      retireAuthority: true,
      args: [
        pure.derive_boot_commitment_with_jubjub(bootSalt, ownerKey),
        bytes(material.encryptionKey),
        pure.compute_public_point_with_jubjub(13n),
        new Uint8Array(64),
        60n,
      ],
    }));
  const accountInitial = await providers.publicDataProvider.queryContractState(accountAddress);
  assert.ok(accountInitial);
  const installedState = nativeLedger.ContractState.deserialize(accountInitial.serialize());
  assert.equal(installedState.operations().length, 52);
  for (const [id, expected] of Object.entries(acc.expectedVk))
    assert.equal(sha(installedState.operation(id).verifierKey), expected);
  assert.deepEqual(installedState.maintenanceAuthority.committee, []);
  assert.equal(installedState.maintenanceAuthority.threshold, 1);
  event(continuation ? 'account-reused' : 'account-deployed', {
    accountAddress,
    verifiedOperations: 52,
    maintenanceRetired: true,
  });
  const accountState = async () => {
    const state = await providers.publicDataProvider.queryContractState(accountAddress);
    assert.ok(state);
    return acc.ledger(state.data);
  };
  // Dynamic circuit dispatch is limited to this pinned generated binding.
  const callAccount = (circuitId, ...args) =>
    /** @type {(...params:any[])=>Promise<any>} */ (submitCallTx)(providers, {
      compiledContract: accountCompiled,
      contractAddress: accountAddress,
      circuitId,
      privateStateId: 'merchant-account',
      args,
    });
  if (!continuation) await callAccount('activate_initial_device_with_jubjub', ownerKey, bootSalt);
  let ownerCounter = continuation?.ownerCounter ?? 0n;
  if (continuation) {
    await providers.privateStateProvider.setContractAddress(accountAddress);
    await providers.privateStateProvider.set('merchant-account', {});
    const current = await accountState();
    assert.equal(current.unshielded_balances.lookup(color), continuation.expectedBalance);
    assert.equal(
      current.devices.member(
        pure.derive_device_entry_with_jubjub(
          { bytes: bytes(accountAddress) },
          ownerKey,
          current.device_epoch,
          ownerCounter,
        ),
      ),
      true,
      'Retained owner counter is not live',
    );
    for (const address of [continuation.originalMerchant, continuation.originalWrongMerchant]) {
      const previous = await providers.publicDataProvider.queryContractState(address);
      assert.ok(previous);
      assert.equal(
        app.ledger(previous.data).payments,
        address === continuation.originalMerchant ? 1n : 0n,
      );
    }
    event('continuation-state-verified', {
      account: accountAddress,
      balance: '8',
      originalPayments: '1',
      freshPaymentIntent: true,
    });
  }
  const ownerCall = async (operation, args, challengeArgs = args) => {
    const authNonce = (await accountState()).auth_nonce;
    const signature = await owner.authorise({
      account: accountAddress,
      circuit: `${operation}_with_jubjub`,
      args,
      witnessValues: [],
      authNonce,
      useCounter: ownerCounter,
      challenge: (r, grind) =>
        pure[`challenge_${operation}_with_jubjub`](
          { bytes: bytes(accountAddress) },
          r,
          ownerKey,
          ...challengeArgs,
          authNonce,
          grind,
        ),
    });
    if (signature.scheme !== 'jubjub-schnorr') throw Error('Wrong authorisation arm');
    const result = await callAccount(
      `${operation}_with_jubjub`,
      ...args,
      signature.pk,
      ownerCounter,
      signature.sigR,
      signature.sigS,
      signature.grindNonce,
    );
    ownerCounter++;
    return result;
  };
  const startingBalance = continuation?.expectedBalance ?? 12n;
  if (!continuation) {
    // Recheck the exact retained output after deployment, never an equal replacement.
    await waitForOriginalFunding();
    fundingDepositPending = true;
    try {
      await callAccount('deposit_unshielded', color, 12n);
    } finally {
      fundingDepositPending = false;
    }
    assert.equal((await accountState()).unshielded_balances.lookup(color), 12n);
  }
  const modules = new Map([[accountAddress, acc]]);
  const moduleProvider = {
    resolve: (address) => (modules.has(address) ? async () => modules.get(address) : undefined),
  };
  const appProviders = {
    ...providers,
    zkConfigProvider: (await wallet.createProviders(funding, join(root, 'managed/merchant')))
      .zkConfigProvider,
    contractModuleProvider: moduleProvider,
  };
  const appCompiled = CompiledContract.make('merchant', app.Contract).pipe(
    CompiledContract.withVacantWitnesses,
    CompiledContract.withCompiledFileAssets(join(root, 'managed/merchant')),
  );
  const deployMerchant = async (id) => {
    const deployed = await deployContract(appProviders, {
      compiledContract: appCompiled,
      privateStateId: id,
      initialPrivateState: {},
      args: [{ bytes: bytes(accountAddress) }, color, { bytes: recipient }, 4n, 1n],
    });
    const address = deployed.deployTxData.public.contractAddress;
    modules.set(address, app);
    return { deployed, address };
  };
  const merchant = await deployMerchant('merchant-main');
  const wrongMerchant = await deployMerchant('merchant-wrong-caller');
  event('merchants-deployed', {
    accountAddress,
    merchant: merchant.address,
    wrongMerchant: wrongMerchant.address,
    recipient: hex(recipient),
  });
  let grant = await prepareJubjubGrant(
    {
      account: accountAddress,
      origin: 'localhost',
      nowSeconds: Math.floor(Date.now() / 1000),
      activeGrantIds: Array.from((await accountState()).grants)
        .filter(([, row]) => row.active)
        .map(([id]) => hex(id)),
      scope: {
        grantee: { scheme: 'jubjub-schnorr', publicKey: await grantee.devicePublicKeyHex() },
        operations: ['withdraw-unshielded'],
        color: hex(color),
        recipient: { kind: 'user-address', value: hex(recipient) },
        maxCoinValue: '12',
        perCallCap: '4',
        cap: '12',
        expiresAt: null,
        caller: merchant.address,
      },
    },
    pure,
  );
  writeFileSync(join(output, 'grant-opening.private.json'), stringify(grant) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  await ownerCall(
    'issue_grant',
    [bytes(grant.grantId), ...grant.scopeArgs, grant.scopeSalt],
    [bytes(grant.grantId), grant.scopeDigest],
  );
  const read = async () => {
    const state = await providers.publicDataProvider.queryContractState(merchant.address);
    assert.ok(state);
    const m = app.ledger(state.data),
      g = (await accountState()).grants.lookup(bytes(grant.grantId));
    return {
      merchant: {
        address: merchant.address,
        account: hex(m.payer.bytes),
        color: hex(m.asset),
        recipient: hex(m.merchant.bytes),
        price: String(m.price),
      },
      grant: {
        active: g.active,
        issuedAt: g.issued_at,
        nonce: g.nonce,
        spentCommit: g.spent_commit,
        objectCommit: g.scope.object_commit,
        withdrawUnshielded: g.scope.op_withdraw_unshielded,
        perCallCap: g.scope.per_call_cap,
        cap: g.scope.cap,
        expiresAt: g.scope.expires_at,
        callerCommit: g.scope.caller_commit,
      },
    };
  };
  // The selected grantee must match the explicit public intent.
  const granteePublicKey = await grantee.devicePublicKeyHex();
  const prepareWithKey = async (spentPrev) => {
    return prepareMerchantPayment(
      {
        account: accountAddress,
        grantId: grant.grantId,
        granteePublicKey,
        origin: 'localhost',
        slot: grant.slot,
        scopeSalt: hex(grant.scopeSalt),
        color: hex(color),
        amount: '4',
        recipient: hex(recipient),
        maxCoinValue: '12',
        spentPrev,
      },
      {
        pure,
        grantee,
        read,
        review: async () => true,
        nowSeconds: () => Math.floor(Date.now() / 1000),
      },
    );
  };
  const snapshot = async () => {
    const g = await read(),
      a = await accountState();
    const [state, wrongState, custodyState] = await Promise.all(
      [merchant.address, wrongMerchant.address, accountAddress].map((address) =>
        providers.publicDataProvider.queryContractState(address),
      ),
    );
    assert.ok(state && wrongState && custodyState);
    return {
      accountStateSha256: sha(custodyState.serialize()),
      applicationStateSha256: sha(state.serialize()),
      wrongApplicationStateSha256: sha(wrongState.serialize()),
      balance: String(a.unshielded_balances.lookup(color)),
      nonce: String(g.grant.nonce),
      spentCommit: hex(g.grant.spentCommit),
      payments: String(app.ledger(state.data).payments),
    };
  };
  const refused = async (label, run, reason) => {
    const before = await snapshot(),
      submitted = submissions,
      proved = proofs;
    stage = 'build';
    await assert.rejects(run, (error) => {
      assert.match(String(error), reason);
      cases.push({
        label,
        outcome: 'refused',
        stage,
        proofs: proofs - proved,
        submissions: submissions - submitted,
        errorSha256: sha(String(error)),
      });
      return true;
    });
    assert.deepEqual(await snapshot(), before);
    event('negative-case', cases.at(-1));
  };
  const first = await prepareWithKey('0');
  writeFileSync(join(output, 'first-approval.private.bin'), serialize(first), {
    flag: 'wx',
    mode: 0o600,
  });
  await refused(
    'wrong immediate caller',
    () => wrongMerchant.deployed.callTx.pay(first.approval),
    /caller mismatch/,
  );
  await refused(
    'invalid grant signature',
    () => merchant.deployed.callTx.pay({ ...first.approval, sig_s: first.approval.sig_s + 1n }),
    /invalid grant signature|range error/,
  );
  modules.set(accountAddress, { ...acc, expectedVk: {} });
  try {
    await refused(
      'module verifier fingerprint substitution',
      () => merchant.deployed.callTx.pay(first.approval),
      /resolved module carries no verifier key fingerprint/,
    );
  } finally {
    modules.set(accountAddress, acc);
  }
  await merchant.deployed.callTx.pay(first.approval);
  assert.equal((await accountState()).unshielded_balances.lookup(color), startingBalance - 4n);
  assert.equal((await snapshot()).payments, '1');
  stage = 'merchant-credit';
  const waitForCredit = () =>
    Rx.firstValueFrom(
      recipientWallet.wallet.state().pipe(
        Rx.filter(
          (state) => state.isSynced && BigInt(state.unshielded.balances[hex(color)] ?? 0n) === 4n,
        ),
        Rx.timeout(120_000),
      ),
    );
  const credit = await confirmedCredit({
    wait: waitForCredit,
    confirm: async () => {
      const original = transactions.at(-1);
      assert.ok(original);
      return confirmOriginalFunding(original.hash, {
        post: async (url, body) => {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15000),
          });
          assert.equal(response.ok, true);
          return response.json();
        },
      });
    },
    event: () => event('confirmed-payment-observer-reconnect'),
    reconnect: async () => {
      await recipientWallet.wallet.stop();
      recipientWallet = undefined;
      recipientWallet = await wallet.createWallet(material.merchantSeed);
    },
  });
  assert.equal(BigInt(credit.state.unshielded.balances[hex(color)]), 4n);
  cases.push({
    label: 'payment and distinct merchant wallet credit',
    outcome: 'confirmed',
    amount: '4',
  });
  event('merchant-credit-confirmed', await snapshot());
  await refused(
    'replayed authorization',
    () => merchant.deployed.callTx.pay(first.approval),
    /spent|signature|commitment/,
  );
  const second = await prepareWithKey('4');
  await refused(
    'business guard after ACC subcall',
    () => merchant.deployed.callTx.pay(second.approval),
    /merchant payment limit reached/,
  );
  await ownerCall('revoke_grant', [bytes(grant.grantId)]);
  await refused(
    'revoked grant',
    () => merchant.deployed.callTx.pay(second.approval),
    /not active|inactive|revoked/,
  );
  const expiresAt = Math.floor(Date.now() / 1000) + 90;
  grant = prepareJubjubGrant(
    {
      account: accountAddress,
      origin: 'localhost',
      nowSeconds: Math.floor(Date.now() / 1000),
      activeGrantIds: Array.from((await accountState()).grants)
        .filter(([, row]) => row.active)
        .map(([id]) => hex(id)),
      scope: {
        grantee: { scheme: 'jubjub-schnorr', publicKey: granteePublicKey },
        operations: ['withdraw-unshielded'],
        color: hex(color),
        recipient: { kind: 'user-address', value: hex(recipient) },
        maxCoinValue: '12',
        perCallCap: '4',
        cap: '12',
        expiresAt,
        caller: merchant.address,
      },
    },
    pure,
  );
  writeFileSync(join(output, 'expiry-grant-opening.private.json'), stringify(grant) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  await ownerCall(
    'issue_grant',
    [bytes(grant.grantId), ...grant.scopeArgs, grant.scopeSalt],
    [bytes(grant.grantId), grant.scopeDigest],
  );
  const expiryApproval = await prepareWithKey('0');
  const deadline = Date.now() + 180_000;
  for (;;) {
    const response = await fetch(process.env.MN_INDEXER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{block{hash height timestamp}}' }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.ok, true);
    const body = await response.json();
    assert.equal(body.errors, undefined);
    const timestamp = body.data?.block?.timestamp;
    assert.equal(typeof timestamp, 'number');
    if (timestamp >= expiresAt * 1000) break;
    assert.ok(Date.now() < deadline, 'Indexed chain time did not reach the grant expiry');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await refused(
    'expired grant on indexed chain time',
    () => merchant.deployed.callTx.pay(expiryApproval.approval),
    /grant expired/,
  );
  for (const [file, pin] of Object.entries(config.files))
    assert.equal(sha(readFileSync(join(root, file))), pin);
  writeFileSync(
    join(output, 'result.json'),
    stringify({
      outcome: 'passed',
      cases,
      proofs,
      submissions,
      retainedTransactions,
      startingBalance: String(startingBalance),
      observerReconnected: credit.reconnected,
      continuation: continuation
        ? {
            source: config.resumeSourceCommit,
            originalTransactions: continuation.transactions,
            originalFinality: priorFinality,
            originalMerchant: continuation.originalMerchant,
            originalPaymentRetried: false,
          }
        : null,
      account: accountAddress,
      application: merchant.address,
      recipient: hex(recipient),
      transactions,
      funding: {
        ...fundingFinality,
        intentHash: fundingInput.intentHash,
        outputNo: fundingInput.outputNo,
        amount: '12',
      },
      final: await snapshot(),
      realProvider: false,
      fullCompatibility: false,
      limitations: [
        'Build refusals are not node rejections',
        'No malicious bypass of the post-call guard was submitted',
      ],
    }) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
} catch (error) {
  event('failed', { phase: stage, errorSha256: sha(String(error)) });
  writeFileSync(join(output, 'failure.private.txt'), String(error.stack ?? error), {
    flag: 'wx',
    mode: 0o600,
  });
  throw error;
} finally {
  const cleanup = await Promise.allSettled(
    [recipientWallet, funding].filter(Boolean).map((context) => context.wallet.stop()),
  );
  writeFileSync(
    join(output, 'wallet-cleanup.private.json'),
    stringify(
      cleanup.map((entry) => ({
        stopped: entry.status === 'fulfilled',
      })),
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  assert.ok(
    cleanup.every((entry) => entry.status === 'fulfilled'),
    'A qualification wallet did not stop',
  );
}
