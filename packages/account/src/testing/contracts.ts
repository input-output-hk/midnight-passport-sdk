// The port contract suites (design §7): what each port promises, run against any adapter. A host
// passes a factory for the adapter under test and its runner; a suite reads only the port's public
// surface, and each test makes a fresh adapter. No test framework: `node:test`, vitest and jest fit.
import type { PassportEvent } from '@midnight-ntwrk/mn-passport-protocol';
import type * as P from '../ports/index.js';
import { fakeAuthoriser, fakeCredentials } from './fakes.js';
import { verifyP256 } from './p256.js';
import { fakeDigest, hex, sameBytes } from './support.js';

/** The host's runner and assertions: Node's test runner with its strict assert, say. */
export interface ContractHost {
  test(name: string, body: () => Promise<void>): unknown;
  readonly assert: {
    ok(value: unknown, message?: string): void;
    /** Strict equality. */
    equal(actual: unknown, expected: unknown, message?: string): void;
  };
}
type Factory<T> = () => T | Promise<T>;

const samePoint = (a: P.CurvePoint, b: P.CurvePoint) => a.x === b.x && a.y === b.y;
const aborted = { aborted: true, addEventListener() {}, removeEventListener() {} };
/** The error `run` threw, or undefined when it answered. */
async function caught(run: () => Promise<unknown>): Promise<{ code?: unknown } | undefined> {
  try {
    await run();
    return undefined;
  } catch (e) {
    return Object(e) as { code?: unknown };
  }
}
/** Every step a port reports opens once and closes once, with `end` or `error`. */
function paired({ assert }: ContractHost, events: PassportEvent[], who: string) {
  for (const id of new Set(events.map((e) => e.id))) {
    const phases = events
      .filter((e) => e.id === id)
      .map((e) => e.phase)
      .join();
    assert.ok(['start,end', 'start,error'].includes(phases), `${who} pairs ${id}: ${phases}`);
  }
}

export interface AuthoriserContractOptions {
  /** Verifies an arm the suite cannot check itself (JubJub, say); P-256 is checked built in. */
  verify?(authorisation: P.Authorisation, request: P.AuthorisationRequest): Promise<boolean>;
}
export function authoriserContract(
  factory: Factory<P.Authoriser>,
  host: ContractHost,
  options: AuthoriserContractOptions = {},
): void {
  const { test, assert } = host;
  const request = async (authoriser: P.Authoriser, seed = 1): Promise<P.AuthorisationRequest> => {
    const binding = await authoriser.deviceBinding?.();
    const challenge = fakeDigest(`challenge|${seed}`);
    return {
      ...{ account: 'cd'.repeat(32), circuit: 'rotate_enc_key_with_p256', args: [challenge] },
      ...{ witnessValues: [], authNonce: 2n, useCounter: 3n + BigInt(seed) },
      challenge: authoriser.scheme === 'p256-webauthn' ? challenge : () => challenge,
      ...(binding && { credentialId: binding.credentialId }),
    };
  };
  const verify = async (a: P.Authoriser, signed: P.Authorisation, req: P.AuthorisationRequest) => {
    if (signed.scheme !== 'p256-webauthn') return options.verify?.(signed, req);
    const { policy } = (await a.deviceBinding?.()) ?? {};
    const { challenge } = req;
    return !!policy && challenge instanceof Uint8Array && verifyP256(signed, challenge, policy);
  };

  test('Authoriser: authorises in its own arm, with its one device key, for the counter', async () => {
    const authoriser = await factory();
    assert.ok(['p256-webauthn', 'jubjub-schnorr', 'k256-ecdsa'].includes(authoriser.scheme));
    const key = await authoriser.devicePublicKey();
    assert.ok(samePoint(key, await authoriser.devicePublicKey()), 'the same key each time');
    const req = await request(authoriser);
    const signed = await authoriser.authorise(req);
    assert.equal(signed.scheme, authoriser.scheme);
    assert.ok(samePoint(signed.pk, key), 'its device key');
    assert.equal(signed.useCounter, req.useCounter);
    if (authoriser.scheme !== 'p256-webauthn') return;
    const binding = await authoriser.deviceBinding?.();
    assert.equal(binding?.policy.rp_id_hash.length, 32, 'the P-256 arm binds an RP id hash');
    assert.equal(binding?.policy.origin.length, 21, 'and a 21-byte origin (wa-json134)');
  });

  test('Authoriser: its signature verifies against devicePublicKey, for its challenge only', async () => {
    const authoriser = await factory();
    const req = await request(authoriser);
    const signed = await authoriser.authorise(req);
    const valid = await verify(authoriser, signed, req);
    if (valid === undefined) return; // an arm the host gave no verifier for
    assert.ok(valid, 'the signature verifies');
    assert.equal(await verify(authoriser, signed, await request(authoriser, 2)), false);
  });

  test('Authoriser: a ceremony pinned to another credential is refused', async () => {
    const authoriser = await factory();
    const req = await request(authoriser);
    if (!req.credentialId) return; // an arm without a credential
    const credentialId = Uint8Array.from(req.credentialId, (b) => b ^ 0xff);
    assert.ok(await caught(() => authoriser.authorise({ ...req, credentialId })), 'refused');
  });

  test('Authoriser: a key session runs and joins a nested one; one commitment per counter', async () => {
    const { withKeySession: session, deviceCommitments } = await factory();
    if (session) {
      let runs = 0;
      const inner = () => session(async () => ++runs, { kind: 'sign-in' });
      assert.equal(await session(async () => (await inner()) + ++runs), 3);
    }
    const entries = await deviceCommitments?.('cd'.repeat(32), 0n, [0n, 1n, 2n]);
    assert.ok(!entries || (entries.length === 3 && entries.every((e) => /^[0-9a-f]+$/i.test(e))));
  });
}

/** A device's passkey, and its authoriser: the key `owns` must accept. */
export interface CredentialFixture {
  readonly credentials: P.CredentialPort;
  readonly authoriser: P.Authoriser;
}
export function credentialContract(factory: Factory<CredentialFixture>, host: ContractHost) {
  const { test, assert } = host;
  test('CredentialPort: create answers a credential id, and identify finds that passkey', async () => {
    const { credentials, authoriser } = await factory();
    const { credentialId } = await credentials.create({ name: 'contract' });
    assert.ok(credentialId.length > 0);
    assert.ok(sameBytes((await credentials.identify()).credentialId, credentialId), 'the same id');
    const binding = await authoriser.deviceBinding?.();
    assert.ok(!binding || sameBytes(binding.credentialId, credentialId), "the authoriser's id");
  });

  test('CredentialPort: owns the device key under its policy, and no other key or origin', async () => {
    const { credentials, authoriser } = await factory();
    await credentials.create({ name: 'contract' });
    const identity = await credentials.identify();
    const key = await authoriser.devicePublicKey();
    const policy = (await authoriser.deviceBinding?.())?.policy;
    assert.ok(identity.owns(key, policy), 'its own key');
    const other = await fakeAuthoriser({ device: 1 }).devicePublicKey();
    const another = samePoint(other, key) ? await fakeAuthoriser().devicePublicKey() : other;
    assert.equal(identity.owns(another, policy), false, "another device's key");
    if (!policy) return;
    const elsewhere = { ...policy, origin: Uint8Array.from(policy.origin, (c) => c ^ 1) };
    assert.equal(identity.owns(key, elsewhere), false, 'another origin');
  });
}

export interface ProverFixture {
  readonly prover: P.Prover;
  readonly unproven: Uint8Array;
  readonly context: P.ProveContext;
  /** The era the binding's transactions are tagged with, and how to read a transaction's tag. */
  readonly era: string;
  eraOf(tx: Uint8Array): string | undefined;
  /** Bytes no prover accepts; one zero byte by default. */
  readonly malformed?: Uint8Array;
}
export function proverContract(factory: Factory<ProverFixture>, { test, assert }: ContractHost) {
  test("Prover: proves for the binding's era, says where it ran, and refuses junk", async () => {
    const { prover, unproven, context, era, eraOf, malformed = Uint8Array.of(0) } = await factory();
    const before = hex(unproven);
    const { tx, provenance } = await prover.proveTx(unproven, context);
    assert.equal(eraOf(tx), era);
    assert.ok(provenance === 'remote' || provenance === 'local', 'remote or local');
    assert.ok(!sameBytes(tx, unproven), 'a proven transaction, not the unproven bytes');
    assert.equal(hex(unproven), before, 'the input is left as it was');
    assert.ok(await caught(() => prover.proveTx(malformed, context)), 'junk is refused');
  });
}

export interface FeeSponsorFixture {
  readonly sponsor: P.FeeSponsor;
  /** A proven transaction whose only imbalance is its fee. */
  readonly unbalanced: Uint8Array;
  /** Under a fees-only policy: a transaction that moves value besides the fee. */
  readonly nonFee?: Uint8Array;
}
export function feeSponsorContract(factory: Factory<FeeSponsorFixture>, host: ContractHost) {
  host.test('FeeSponsor: balances and signs; a fees-only policy refuses other value', async () => {
    const { sponsor, unbalanced, nonFee } = await factory();
    const before = hex(unbalanced);
    const balanced = await sponsor.balanceAndSign(unbalanced);
    host.assert.ok(balanced instanceof Uint8Array && !sameBytes(balanced, unbalanced), 'new bytes');
    host.assert.equal(hex(unbalanced), before, 'the input is left as it was');
    if (!nonFee) return; // no policy configured
    const refused = await caught(() => sponsor.balanceAndSign(nonFee));
    host.assert.equal(refused?.code, 'SponsorRejected');
  });
}

export interface SubmitterFixture {
  readonly submitter: P.Submitter;
  /** A new finalised transaction per call. */
  finalised(): Promise<Uint8Array>;
  /** A transaction the submitter must refuse: one not balanced, say. */
  readonly unfinalised?: Uint8Array;
}
export function submitterContract(factory: Factory<SubmitterFixture>, host: ContractHost) {
  host.test(
    'Submitter: answers one submission id per transaction, and refuses a raw one',
    async () => {
      const { submitter, finalised, unfinalised } = await factory();
      const [a, b] = [
        await submitter.submit(await finalised()),
        await submitter.submit(await finalised()),
      ];
      host.assert.ok(typeof a === 'string' && a.length > 0 && a !== b, 'one id each');
      if (unfinalised) host.assert.ok(await caught(() => submitter.submit(unfinalised)), 'refused');
    },
  );
}

export interface ChainFixture {
  readonly chain: P.Chain;
  /** A booted account the chain holds. */
  readonly address: string;
  /** A gated call on `address` (a rotation, say), authorised against the ledger as it reads now. */
  gatedCall(): Promise<P.CallRequest>;
}
export function chainContract(factory: Factory<ChainFixture>, host: ContractHost) {
  const { test, assert } = host;
  test("Chain: reads an account's ledger view, and nothing where there is no contract", async () => {
    const { chain, address } = await factory();
    assert.equal(await chain.readAccount(hex(fakeDigest('no contract'))), undefined);
    const view = await chain.readAccount(address);
    assert.equal(view?.booted, true);
    assert.ok(typeof view?.authNonce === 'bigint' && typeof view.deviceEpoch === 'bigint');
    assert.ok(typeof view?.entryCount === 'number' && typeof view.specVersion === 'number');
    assert.equal(view?.hasEntry(fakeDigest('no entry')), false);
  });

  test('Chain: each gated call advances auth_nonce by one, and reports paired steps', async () => {
    const { chain, address, gatedCall } = await factory();
    const nonce = async () => (await chain.readAccount(address))?.authNonce ?? -1n;
    const start = await nonce();
    const events: PassportEvent[] = [];
    for (const n of [1n, 2n]) {
      const { txHash } = await chain.call({
        ...(await gatedCall()),
        onEvent: (e) => events.push(e),
      });
      assert.ok(typeof txHash === 'string' && txHash.length > 0, 'a transaction hash');
      assert.equal(await nonce(), start + n);
    }
    paired(host, events, 'Chain');
  });

  test('Chain: a replayed gated call is refused, and auth_nonce stays', async () => {
    const { chain, address, gatedCall } = await factory();
    const call = await gatedCall();
    await chain.call(call);
    const nonce = (await chain.readAccount(address))?.authNonce;
    assert.ok(await caught(() => chain.call(call)), 'refused');
    assert.equal((await chain.readAccount(address))?.authNonce, nonce);
  });
}

export interface DeployerFixture {
  readonly deployer: P.Deployer;
  /** The chain it deploys to, to read the account back. */
  readonly chain?: P.Chain;
  /** Whether an account's maintenance authority is retired, which the ledger view does not say. */
  authorityRetired?(address: string): Promise<boolean>;
}
export function deployerContract(factory: Factory<DeployerFixture>, host: ContractHost) {
  const { test, assert } = host;
  const request = (n: number, retireAuthority = true) => ({
    ...{ boot: fakeDigest(`boot|${n}`), encKey: fakeDigest(`enc|${n}`), retireAuthority },
  });

  test('Deployer: deploys a new account per call, unbooted with its enc_key, and its waves', async () => {
    const { deployer, chain } = await factory();
    const events: PassportEvent[] = [];
    const first = await deployer.deploy({ ...request(1), onEvent: (e) => events.push(e) });
    const second = await deployer.deploy(request(2));
    assert.ok(first.address.length > 0 && first.address !== second.address, 'two accounts');
    assert.ok(first.txIds.length > 0 && first.txIds.every((id) => typeof id === 'string'));
    paired(host, events, 'Deployer');
    if (!chain) return;
    const view = await chain.readAccount(first.address);
    assert.ok(view?.booted === false && view.authNonce === 0n, 'unbooted, at auth_nonce 0');
    assert.ok(!view?.encKey || sameBytes(view.encKey, request(1).encKey), 'its enc_key');
  });

  test('Deployer: retires the maintenance authority exactly when asked', async () => {
    const { deployer, authorityRetired } = await factory();
    for (const retire of authorityRetired ? [true, false] : []) {
      const { address } = await deployer.deploy(request(retire ? 3 : 4, retire));
      assert.equal(await authorityRetired?.(address), retire);
    }
  });

  test('Deployer: refuses a deploy whose signal has already aborted', async () => {
    const { deployer } = await factory();
    assert.ok(await caught(() => deployer.deploy({ ...request(5), signal: aborted })));
  });
}

/** `networkId` and `otherNetworkId` default to `undeployed` and `preview`. */
export interface DirectoryContractOptions {
  readonly networkId?: string;
  readonly otherNetworkId?: string;
}
export function directoryContract(
  factory: Factory<P.AccountDirectory>,
  { test, assert }: ContractHost,
  { networkId = 'undeployed', otherNetworkId = 'preview' }: DirectoryContractOptions = {},
) {
  // Fresh credential ids per run, so a directory that persists across runs is not written twice.
  const run = hex(fakeDigest(`${Date.now()}|${Math.random()}`)).slice(0, 16);
  const hint = async (seed: string, device: 0 | 1 = 0): Promise<P.AccountHint> => {
    const authoriser = fakeAuthoriser({ device, credentialId: fakeDigest(`${run}|${seed}`) });
    const { policy, credentialId } = await authoriser.deviceBinding();
    const publicKey = await authoriser.devicePublicKey();
    const fields = { address: hex(fakeDigest(`address|${seed}`)), salt: fakeDigest(seed) };
    return {
      ...fields,
      scheme: 'p256-webauthn',
      credentialId,
      publicKey,
      policy,
      status: 'deployed',
    };
  };
  const get = (directory: P.AccountDirectory, h: P.AccountHint, network = networkId) =>
    directory.get(network, {
      kind: 'credential-id',
      credentialId: h.credentialId ?? new Uint8Array(),
    });
  const same = (a: P.AccountHint | undefined, b: P.AccountHint) =>
    a?.address === b.address &&
    a.scheme === b.scheme &&
    a.status === b.status &&
    samePoint(a.publicKey, b.publicKey) &&
    [a.credentialId, a.salt, a.policy?.origin, a.policy?.rp_id_hash].every((bytes, i) =>
      sameBytes(bytes, [b.credentialId, b.salt, b.policy?.origin, b.policy?.rp_id_hash][i]),
    );

  test('AccountDirectory: answers a hint as written, on its network only, and nothing else', async () => {
    const directory = await factory();
    const h = await hint('written');
    assert.equal(await get(directory, h), undefined, 'nothing before the write');
    await directory.put(networkId, h);
    assert.ok(same(await get(directory, h), h), 'as written');
    assert.equal(await get(directory, h, otherNetworkId), undefined, 'not on another network');
  });

  test('AccountDirectory: is write-once: the same hint again passes, a changed one is refused', async () => {
    const directory = await factory();
    const h = await hint('once');
    await directory.put(networkId, h);
    await directory.put(networkId, h);
    const other = await hint('other', 1);
    const changed: Partial<P.AccountHint>[] = [
      { address: other.address },
      { publicKey: other.publicKey },
      { salt: fakeDigest('another salt') },
    ];
    for (const change of changed) {
      assert.ok(await caught(() => directory.put(networkId, { ...h, ...change })), 'refused');
    }
    assert.ok(same(await get(directory, h), h), 'the first hint stands');
  });

  test('AccountDirectory: a hint moves from deployed to active, and never back', async () => {
    const directory = await factory();
    const h = await hint('status');
    await directory.put(networkId, h);
    await directory.put(networkId, { ...h, status: 'active' });
    assert.ok(await caught(() => directory.put(networkId, h)), 'not back to deployed');
    assert.equal((await get(directory, h))?.status, 'active');
  });

  test("AccountDirectory: a forged hint comes back as written, and fails the core's check", async () => {
    const directory = await factory();
    const genuine = await hint('forged');
    // Another device's key, filed first under this passkey's credential id.
    const forged = { ...genuine, publicKey: (await hint('forged', 1)).publicKey };
    await directory.put(networkId, forged);
    const answered = await get(directory, genuine);
    assert.ok(same(answered, forged), 'the directory vouches for nothing');
    const authoriser = fakeAuthoriser({ credentialId: genuine.credentialId ?? new Uint8Array() });
    const identity = await fakeCredentials({ authoriser }).identify();
    assert.equal(identity.owns(answered?.publicKey ?? forged.publicKey, answered?.policy), false);
    assert.ok(identity.owns(genuine.publicKey, genuine.policy), 'the genuine key would pass');
  });
}
