// Deterministic in-memory ports (design §7): one fake per port, an ACC ledger the chain and the
// deployer share, and faults a test queues per call. `createFakePorts` wires one world.
import {
  asPassportErrorCode,
  type FlowOptions,
  type PassportEvent,
} from '@midnight-ntwrk/mn-passport-protocol';
import type * as P from '../ports/index.js';
import { FAKE_P256_KEYS, signP256, verifyP256 } from './p256.js';
import { ascii, fakeDigest, hex, passportError, sameBytes, unhex } from './support.js';

/** What one world's fakes share: the calls they saw, and the faults queued for them. */
export interface FakeContext {
  /** `[point, ...detail]` per call, in order; a point is `port.method`, `'chain.call'` say. */
  readonly log: unknown[][];
  /** Makes the next `times` calls at `point` throw `error` (an `InternalError` by default). */
  inject(point: string, error?: unknown, times?: number): void;
  /** Logs a call at `point`, then throws the fault queued for it, if any. */
  hit(point: string, ...detail: unknown[]): void;
}
export function fakeContext(): FakeContext {
  const log: unknown[][] = [];
  const faults = new Map<string, unknown[]>();
  return {
    log,
    inject(point, error = passportError('InternalError', `fake ${point} failure`), times = 1) {
      faults.set(point, [...(faults.get(point) ?? []), ...Array<unknown>(times).fill(error)]);
    },
    hit(point, ...detail) {
      log.push([point, ...detail]);
      if (faults.get(point)?.length) throw faults.get(point)?.shift();
    },
  };
}
type With<K extends keyof FakePorts> = Partial<Pick<FakePorts, K>>;

let eventIds = 0;
/** Runs `work` as one step it reports, as a chain-facing adapter reports its share (#17). */
async function reported<T>(
  { onEvent }: FlowOptions,
  step: PassportEvent['step'],
  work: () => Promise<T>,
  detail?: PassportEvent['detail'],
): Promise<T> {
  const id = `fake-${++eventIds}`;
  const event = { id, flowId: '', step, at: Date.now(), clock: 'client' as const };
  if (detail) Object.assign(event, { detail });
  onEvent?.({ ...event, phase: 'start' });
  try {
    const value = await work();
    onEvent?.({ ...event, phase: 'end', durationMs: 0 });
    return value;
  } catch (e) {
    const { code, message } = Object(e) as { code?: unknown; message?: unknown };
    const error = { code: asPassportErrorCode(code), message: String(message ?? e) };
    onEvent?.({ ...event, phase: 'error', durationMs: 0, error });
    throw e;
  }
}

export const fakeNetwork = (overrides: Partial<P.NetworkConfig> = {}): P.NetworkConfig => ({
  networkId: 'undeployed',
  indexerUrl: 'http://indexer.invalid/api/v3/graphql',
  indexerWsUrl: 'ws://indexer.invalid/api/v3/graphql/ws',
  nodeUrl: 'http://node.invalid',
  artefactUrl: 'http://artefacts.invalid',
  bindingId: 'acc-fake',
  manifestSha256: '0'.repeat(64),
  ...overrides,
});

const point = (pk: P.CurvePoint) => `${pk.x.toString(16)},${pk.y.toString(16)}`;
const policyText = (p: P.WebAuthnPolicy) => hex(p.rp_id_hash) + hex(p.origin);
const p256 = (pk: P.CurvePoint) => ({ x: pk.x, y: pk.y, identity: false as const });
/** Pure circuits over `fakeDigest`: deterministic, and distinct wherever the real ones are. */
export const fakeBinding = (): P.AccBinding => ({
  pureCircuits: {
    derive_boot_commitment_with_p256: (salt, pk, policy) =>
      fakeDigest(`boot|${hex(salt)}|${point(pk)}|${policyText(policy)}`),
    derive_device_entry_with_p256: (self, pk, policy, epoch, k) =>
      fakeDigest(`entry|${hex(self.bytes)}|${point(pk)}|${policyText(policy)}|${epoch}|${k}`),
    challenge_rotate_enc_key_with_p256: (self, pk, key, nonce) =>
      fakeDigest(`rotate|${hex(self.bytes)}|${point(pk)}|${hex(key)}|${nonce}`),
  },
});

/** wa-json134 binds a 21-byte origin. */
export const FAKE_POLICY: P.WebAuthnPolicy = {
  rp_id_hash: fakeDigest('rp|localhost'),
  origin: ascii('http://localhost:5173'),
};
export interface FakeAuthoriserOptions extends With<'context'> {
  /** The fixed test key: 0, or 1 for a second device. */
  readonly device?: 0 | 1;
  readonly credentialId?: Uint8Array;
  readonly policy?: P.WebAuthnPolicy;
}
/** The P-256 arm over a software key: real ES256 over wa-json134's bytes. JubJub joins with #24. */
export function fakeAuthoriser(options: FakeAuthoriserOptions = {}) {
  const { context = fakeContext(), device = 0, policy = FAKE_POLICY } = options;
  const { credentialId = Uint8Array.of(0xc0, device) } = options;
  const key = FAKE_P256_KEYS[device];
  return {
    scheme: 'p256-webauthn',
    devicePublicKey: async () => ({ x: key.x, y: key.y }),
    deviceBinding: async () => ({ policy, credentialId }),
    async authorise({ circuit, credentialId: pinned, useCounter, challenge }) {
      context.hit('authoriser.authorise', circuit, pinned, useCounter);
      if (pinned && !sameBytes(pinned, credentialId)) {
        throw passportError('WrongPasskey', 'The ceremony was pinned to another passkey.');
      }
      if (!(challenge instanceof Uint8Array) || challenge.length !== 32) {
        throw passportError('InternalError', 'The P-256 arm signs a 32-byte challenge.');
      }
      const pk = { x: key.x, y: key.y };
      return {
        scheme: 'p256-webauthn',
        pk,
        useCounter,
        ...(await signP256(key, challenge, policy)),
      };
    },
  } satisfies P.Authoriser;
}

/** The device's passkey: `identify` finds it, and `owns` takes its own key and policy only. */
export function fakeCredentials(options: With<'context' | 'authoriser'> = {}): P.CredentialPort {
  const { context = fakeContext(), authoriser = fakeAuthoriser({ context }) } = options;
  const device = async () => ({
    key: await authoriser.devicePublicKey(),
    ...((await authoriser.deviceBinding?.()) ?? { credentialId: Uint8Array.of(0xc0) }),
  });
  return {
    async create({ name }) {
      context.hit('credentials.create', name);
      return { credentialId: (await device()).credentialId };
    },
    async identify() {
      context.hit('credentials.identify');
      const { key, credentialId, ...bound } = await device();
      const policy = 'policy' in bound ? policyText(bound.policy) : undefined;
      return {
        credentialId,
        owns: (pk, p) => point(pk) === point(key) && policy === (p && policyText(p)),
      };
    },
  };
}

export function fakeEncryptionKey({ context = fakeContext() }: With<'context'> = {}) {
  return {
    async publicKey(networkId) {
      context.hit('encryptionKey.publicKey', networkId);
      return fakeDigest(`enc|${networkId}`);
    },
  } satisfies P.EncryptionKeySource;
}

const newAccount = (boot: Uint8Array, encKey: Uint8Array, authorityRetired: boolean) => ({
  ...{ boot, encKey, authorityRetired, booted: false, authNonce: 0n, deviceEpoch: 0n },
  specVersion: 2,
  /** Device entries, in hex. */
  entries: new Set<string>(),
});
/** One ACC as the fakes hold it; a test may edit it, as a stale or rotated ledger reads. */
export type FakeAccount = ReturnType<typeof newAccount>;
export type FakeLedger = Map<string, FakeAccount>;

/** Two waves, then the authority's retirement when asked; honours `signal` before it submits. */
export function fakeDeployer(options: With<'context' | 'ledger'> = {}): P.Deployer {
  const { context = fakeContext(), ledger = new Map() } = options;
  return {
    async deploy({ boot, encKey, retireAuthority, ...flow }) {
      context.hit('deployer.deploy', retireAuthority, encKey);
      if (flow.signal?.aborted) throw passportError('Aborted', 'Aborted before any submission.');
      if (boot.length !== 32 || encKey.length !== 32) {
        throw passportError('InternalError', 'The boot commitment and enc_key are 32 bytes.');
      }
      const address = hex(fakeDigest(`address|${ledger.size}`));
      const txIds = [];
      for (const wave of [1, 2]) {
        const id = async () => `${address.slice(0, 8)}-wave-${wave}`;
        txIds.push(await reported(flow, 'deploy.wave', id, { wave, of: 2 }));
      }
      if (retireAuthority) await reported(flow, 'deploy.retire', async () => undefined);
      ledger.set(address, newAccount(boot, encKey, retireAuthority));
      return { address, txIds };
    },
  };
}

export const FAKE_ERA = 'fake-v1';
/** A fake transaction is its JSON, so each stage of the pipeline reads the last one's. */
export interface FakeTx {
  readonly era: string;
  readonly stage: 'unproven' | 'proven' | 'balanced';
  /** What it leaves unbalanced besides its fee: nothing (`fee`) by default. */
  readonly imbalance?: 'fee' | 'transfer';
}
export const fakeTx = (tx: FakeTx): Uint8Array => ascii(JSON.stringify(tx));
export function readFakeTx(bytes: Uint8Array): FakeTx | undefined {
  try {
    const tx = JSON.parse(String.fromCharCode(...bytes)) as Partial<FakeTx> | null;
    return typeof tx?.era === 'string' ? (tx as FakeTx) : undefined;
  } catch {
    return undefined;
  }
}
const expect = (tx: Uint8Array, stage: FakeTx['stage'], era = FAKE_ERA): FakeTx => {
  const read = readFakeTx(tx);
  if (read?.stage === stage && read.era === era) return read;
  throw passportError('InternalError', `Not a ${stage} ${era} transaction.`);
};

export function fakeProver(
  options: With<'context'> & { readonly era?: string; readonly provenance?: 'remote' } = {},
): P.Prover {
  const { context = fakeContext(), era = FAKE_ERA, provenance = 'local' } = options;
  return {
    async proveTx(unproven, { circuits }) {
      context.hit('prover.proveTx', circuits);
      return { tx: fakeTx({ ...expect(unproven, 'unproven', era), stage: 'proven' }), provenance };
    },
  };
}

/** With `feesOnly`, the sponsor's policy pays fees and refuses any other imbalance. */
export function fakeSponsor(options: With<'context'> & { feesOnly?: boolean } = {}): P.FeeSponsor {
  const { context = fakeContext(), feesOnly = false } = options;
  return {
    async balanceAndSign(unbalanced) {
      context.hit('sponsor.balanceAndSign');
      const tx = expect(unbalanced, 'proven');
      if (feesOnly && (tx.imbalance ?? 'fee') !== 'fee') {
        throw passportError('SponsorRejected', 'The sponsor policy pays fees only.');
      }
      return fakeTx({ ...tx, stage: 'balanced' });
    },
  };
}

export function fakeSubmitter({ context = fakeContext() }: With<'context'> = {}): P.Submitter {
  return {
    async submit(finalised) {
      context.hit('submitter.submit');
      expect(finalised, 'balanced');
      return `fake-submission-${context.log.length}`;
    },
  };
}

type Auth = Pick<P.P256Authorisation, 'pk' | 'sig'> & { policy: P.WebAuthnPolicy } & {
  use_counter: bigint;
  authenticator_data: Uint8Array;
};
/**
 * The ACC's MVP circuits over a `FakeLedger`. A call runs the circuit's checks, proves, balances
 * and submits through the chain-facing ports, reporting each step, and checks again at finality.
 * Rotation is gated: a live entry must sign the challenge at the current `auth_nonce`; then the
 * entry rolls to the next use counter and `auth_nonce` moves.
 */
export function fakeChain(
  options: With<
    'context' | 'ledger' | 'binding' | 'network' | 'prover' | 'sponsor' | 'submitter'
  > = {},
): P.Chain {
  const { context = fakeContext(), ledger = new Map(), binding = fakeBinding() } = options;
  const { prover = fakeProver({ context }), sponsor = fakeSponsor({ context }) } = options;
  const { submitter = fakeSubmitter({ context }), network = fakeNetwork() } = options;
  const { pureCircuits: circuits } = binding;
  const refused = (why: string) => passportError('InternalError', `The fake ACC refused: ${why}.`);
  const entry = (self: string, pk: P.CurvePoint, policy: P.WebAuthnPolicy, e: bigint, k: bigint) =>
    hex(circuits.derive_device_entry_with_p256({ bytes: unhex(self) }, p256(pk), policy, e, k));

  /** The circuit's checks against the ledger as it is; answers the circuit's writes. */
  async function execute(self: string, account: FakeAccount, circuit: string, args: unknown[]) {
    const epoch = account.deviceEpoch;
    if (circuit === 'activate_initial_device_with_p256') {
      const [pk, salt, policy] = args as [P.CurvePoint, Uint8Array, P.WebAuthnPolicy];
      const boot = circuits.derive_boot_commitment_with_p256(salt, p256(pk), policy);
      if (account.booted || !sameBytes(boot, account.boot)) throw refused('not this boot');
      return () => {
        account.booted = true;
        account.entries.add(entry(self, pk, policy, epoch, 0n));
      };
    }
    if (circuit !== 'rotate_enc_key_with_p256') throw refused(`no circuit ${circuit}`);
    const [newKey, auth] = args as [Uint8Array, Auth];
    const live = entry(self, auth.pk, auth.policy, epoch, auth.use_counter);
    const pk = p256(auth.pk);
    const challenge = circuits.challenge_rotate_enc_key_with_p256(
      { bytes: unhex(self) },
      pk,
      newKey,
      account.authNonce,
    );
    const signed = { pk, authenticatorData: auth.authenticator_data, sig: auth.sig };
    if (!account.entries.has(live) || !(await verifyP256(signed, challenge, auth.policy))) {
      throw refused('no live entry signed this challenge');
    }
    return () => {
      account.entries.delete(live);
      account.entries.add(entry(self, pk, auth.policy, epoch, auth.use_counter + 1n));
      account.authNonce += 1n;
      account.encKey = newKey;
    };
  }

  return {
    async call({ address, circuit, args, ...flow }) {
      context.hit('chain.call', circuit, args);
      const account = ledger.get(address);
      if (!account) throw passportError('AccountNotFound', `No contract at ${address}.`);
      await execute(address, account, circuit, [...args]);
      const { networkId, bindingId } = network;
      const unproven = fakeTx({ era: FAKE_ERA, stage: 'unproven' });
      const prove = () => prover.proveTx(unproven, { networkId, bindingId, circuits: [circuit] });
      const proven = await reported(flow, 'prove', async () => (await prove()).tx);
      const balanced = await reported(flow, 'sponsor.balance', () =>
        sponsor.balanceAndSign(proven),
      );
      const txHash = await reported(flow, 'sponsor.submit', () => submitter.submit(balanced));
      await reported(flow, 'chain.finality', async () =>
        (await execute(address, account, circuit, [...args]))(),
      );
      return { txHash };
    },
    async readAccount(address) {
      context.hit('chain.readAccount', address);
      const account = ledger.get(address);
      if (!account) return undefined;
      const { entries, boot: _boot, authorityRetired: _retired, ...view } = account;
      const held = new Set(entries);
      return { ...view, entryCount: held.size, hasEntry: (e) => held.has(hex(e)) };
    },
  };
}

const fixedPart = (h: P.AccountHint) =>
  [h.address, h.scheme, hex(h.credentialId ?? new Uint8Array()), point(h.publicKey)]
    .concat(h.policy ? policyText(h.policy) : '', hex(h.salt ?? new Uint8Array()))
    .join('|');
/** Write-once: a hint never changes but in status, from `deployed` to `active`. */
export function fakeDirectory({ context = fakeContext() }: With<'context'> = {}) {
  /** By `networkId/credentialId`; a test may plant a stale or forged hint here. */
  const hints = new Map<string, P.AccountHint>();
  const at = (networkId: string, id: Uint8Array = new Uint8Array()) => `${networkId}/${hex(id)}`;
  const directory: P.AccountDirectory = {
    async get(networkId, key) {
      context.hit('directory.get', networkId, key.kind);
      const hint = hints.get(at(networkId, key.credentialId));
      return hint && { ...hint };
    },
    async put(networkId, hint) {
      context.hit('directory.put', hint.status, hint.scheme);
      const held = hints.get(at(networkId, hint.credentialId));
      const back = held?.status === 'active' && hint.status !== 'active';
      if (held && (back || fixedPart(held) !== fixedPart(hint))) {
        throw passportError('InternalError', 'account already registered');
      }
      hints.set(at(networkId, hint.credentialId), { ...hint });
    },
  };
  return Object.assign(directory, { hints });
}

export function fakeRecords(options: With<'context'> & { record?: P.AccountRecord } = {}) {
  const { context = fakeContext() } = options;
  let held = options.record;
  return {
    read: async () => (context.hit('records.read'), held && { ...held }),
    exists: async () => (context.hit('records.exists'), held !== undefined),
    async write(record) {
      context.hit('records.write', record.address);
      held = { ...record };
    },
  } satisfies P.AccountRecordStore;
}

/** Deterministic bytes, distinct per call. */
export function fakeRandom(seed = 'random'): (length: number) => Uint8Array {
  let n = 0;
  return (length) => {
    const digest = fakeDigest(`${seed}|${n++}`);
    return Uint8Array.from({ length }, (_, i) => digest[i % 32] ?? 0);
  };
}

/** One world: every port, the chain-facing ports behind the chain, and the shared state. */
export interface FakePorts extends P.PassportPorts {
  readonly binding: P.AccBinding;
  readonly chain: P.Chain;
  readonly directory: ReturnType<typeof fakeDirectory>;
  readonly records: P.AccountRecordStore;
  readonly random: (length: number) => Uint8Array;
  readonly prover: P.Prover;
  readonly sponsor: P.FeeSponsor;
  readonly submitter: P.Submitter;
  readonly ledger: FakeLedger;
  readonly context: FakeContext;
}
/** An override replaces one fake, and the fakes built on it use it. */
export function createFakePorts(overrides: Partial<FakePorts> = {}): FakePorts {
  const { context = fakeContext(), ledger = new Map(), binding = fakeBinding() } = overrides;
  const { network = fakeNetwork(), authoriser = fakeAuthoriser({ context }) } = overrides;
  const { prover = fakeProver({ context }), sponsor = fakeSponsor({ context }) } = overrides;
  const { submitter = fakeSubmitter({ context }) } = overrides;
  const chainFacing = { context, ledger, binding, network, prover, sponsor, submitter };
  return {
    ...{ ...chainFacing, authoriser },
    credentials: fakeCredentials({ context, authoriser }),
    encryptionKey: fakeEncryptionKey({ context }),
    chain: fakeChain(chainFacing),
    deployer: fakeDeployer({ context, ledger }),
    directory: fakeDirectory({ context }),
    records: fakeRecords({ context }),
    random: fakeRandom(),
    ...overrides,
  };
}
