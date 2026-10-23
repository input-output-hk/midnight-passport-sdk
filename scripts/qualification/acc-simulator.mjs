// Offline execution of the shipped generated ACC. No proofs, node, funds or real credentials.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import {
  createConstructorContext,
  createCircuitContext,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import * as pinned from '../../packages/contract/generated/acc-s3r1.1/index.js';
import {
  JUBJUB_ORDER,
  littleEndianScalar,
  signJubjubChallenge,
} from '../../packages/keys/dist/jubjub-signing.js';
import {
  clientDataJSON,
  parseES256Signature,
  webauthnPolicy,
} from '../../packages/adapter-browser/dist/prototype.js';

/** @typedef {import('../../packages/account/dist/ports/index.js').CurvePoint} Point */
/** @typedef {{arm: 'jubjub', pk: Point, scalar: bigint} | {arm: 'p256', pk: Point,
 * policy: import('../../packages/contract/generated/acc-s3r1.1/index.js').WebAuthnPolicy,
 * privateKey: import('node:crypto').KeyObject}} SimDevice */
/** @param {Uint8Array} bytes */
const hex = (bytes) => Buffer.from(bytes).toString('hex');
/** @param {'jubjub' | 'p256'} arm @param {typeof pinned} module */
export function simulationDevice(arm = 'jubjub', module = pinned) {
  if (arm === 'jubjub') {
    const scalar = (littleEndianScalar(randomBytes(32)) % (JUBJUB_ORDER - 1n)) + 1n;
    return /** @type {SimDevice} */ ({
      arm,
      scalar,
      pk: module.pureCircuits.compute_public_point_with_jubjub(scalar),
    });
  }
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  if (!jwk.x || !jwk.y) throw new Error('simulation P-256 key has no coordinates');
  return /** @type {SimDevice} */ ({
    arm,
    privateKey,
    pk: {
      x: BigInt(`0x${Buffer.from(jwk.x, 'base64url').toString('hex')}`),
      y: BigInt(`0x${Buffer.from(jwk.y, 'base64url').toString('hex')}`),
    },
    policy: webauthnPolicy('localhost', 'http://localhost:5173'),
  });
}

export class AccSimulator {
  /** @param {typeof pinned} module */
  constructor(module = pinned) {
    this.module = module;
    this.owner = simulationDevice('jubjub', module);
    this.recovery = simulationDevice('jubjub', module);
    this.address = sampleContractAddress();
    this.self = { bytes: new Uint8Array(Buffer.from(this.address, 'hex')) };
    this.coin = { bytes: new Uint8Array(randomBytes(32)) };
    this.now = 1_800_000_000;
    this.contract = new module.Contract({
      held_coin() {
        throw new Error('no coins in this simulation');
      },
    });
    /** @type {any} */
    this.state = undefined;
  }

  /** @param {{owner?: SimDevice, recovery?: SimDevice, module?: typeof pinned, window?: bigint}} options */
  static async create({
    module = pinned,
    owner = simulationDevice('jubjub', module),
    recovery = simulationDevice('jubjub', module),
    window = 60n,
  } = {}) {
    const sim = new AccSimulator(module);
    sim.owner = owner;
    sim.recovery = recovery;
    const salt = new Uint8Array(randomBytes(32));
    const p = module.pureCircuits;
    const boot =
      owner.arm === 'jubjub'
        ? p.derive_boot_commitment_with_jubjub(salt, owner.pk)
        : p.derive_boot_commitment_with_p256(salt, { ...owner.pk, identity: false }, owner.policy);
    const init = await sim.contract.initialState(
      createConstructorContext({}, sim.coin),
      boot,
      new Uint8Array(randomBytes(32)),
      recovery.pk,
      new Uint8Array(64),
      window,
    );
    sim.state = init.currentContractState;
    await sim.call(
      `activate_initial_device_with_${owner.arm}`,
      owner.arm === 'p256' ? { ...owner.pk, identity: false } : owner.pk,
      salt,
      ...(owner.arm === 'p256' ? [owner.policy] : []),
    );
    return sim;
  }

  ledger() {
    return this.module.ledger(this.state);
  }

  /** @param {string} name @param {any[]} args */
  async call(name, ...args) {
    const context = createCircuitContext({
      circuitId: name,
      contractAddress: this.address,
      coinPublicKeyOrZswapState: this.coin,
      contractState: this.state,
      privateState: {},
      time: this.now,
    });
    const fn = /** @type {Record<string, (...args: any[]) => Promise<any>>} */ (
      this.contract.impureCircuits
    )[name];
    if (!fn) throw new Error(`circuit unavailable: ${name}`);
    const result = await fn(context, ...args);
    this.state = result.context.callContext.currentQueryContext.state;
    return result.result;
  }

  /** @param {SimDevice} device @param {bigint} counter @param {bigint} epoch */
  entry(device, counter = 0n, epoch = this.ledger().device_epoch) {
    const p = this.module.pureCircuits;
    return device.arm === 'jubjub'
      ? p.derive_device_entry_with_jubjub(this.self, device.pk, epoch, counter)
      : p.derive_device_entry_with_p256(
          this.self,
          { ...device.pk, identity: false },
          device.policy,
          epoch,
          counter,
        );
  }

  /** Real signatures over the binding's actual challenges, not fake chain-port behavior.
   * @param {string} operation @param {any[]} args @param {SimDevice} device @param {bigint} counter
   */
  async authorised(operation, args, device = this.owner, counter = 0n) {
    const nonce = this.ledger().auth_nonce;
    const p = this.module.pureCircuits;
    const challenge = /** @type {Record<string, (...args: any[]) => Uint8Array>} */ (
      /** @type {unknown} */ (p)
    )[`challenge_${operation}_with_${device.arm}`];
    if (!challenge) throw new Error('challenge unavailable');
    if (device.arm === 'jubjub') {
      const auth = signJubjubChallenge(
        p,
        device.scalar,
        (r, grind) => challenge(this.self, r, device.pk, ...args, nonce, grind),
        counter,
      );
      return this.call(
        `${operation}_with_jubjub`,
        ...args,
        auth.pk,
        counter,
        auth.sigR,
        auth.sigS,
        auth.grindNonce,
      );
    }
    const bytes = challenge(this.self, { ...device.pk, identity: false }, ...args, nonce);
    const data = new Uint8Array(37);
    data.set(device.policy.rp_id_hash);
    data[32] = 5; // UP + UV in this software authenticator only.
    const message = Buffer.concat([
      data,
      createHash('sha256').update(clientDataJSON(bytes, device.policy.origin)).digest(),
    ]);
    const signature = parseES256Signature(sign('sha256', message, device.privateKey));
    return this.call(`${operation}_with_p256`, ...args, {
      pk: { ...device.pk, identity: false },
      policy: device.policy,
      use_counter: counter,
      authenticator_data: data,
      sig: signature,
    });
  }

  /** The recovery gate always uses JubJub, independently of the owner arm.
   * Synthetic scalar holders model gate reachability; no user recovery feature is exposed.
   * @param {SimDevice} successor @param {SimDevice} successorRecovery @param {SimDevice} recovery
   */
  async submitRecovery(
    successor,
    successorRecovery = simulationDevice('jubjub', this.module),
    recovery = this.recovery,
  ) {
    if (
      successor.arm !== 'jubjub' ||
      recovery.arm !== 'jubjub' ||
      successorRecovery.arm !== 'jubjub'
    )
      throw new Error('recovery gate needs JubJub');
    const l = this.ledger();
    const p = this.module.pureCircuits;
    const a = 13n,
      b = 17n; // Public test-only signing nonces; never production keys.
    const ra = p.compute_public_point_with_jubjub(a),
      rb = p.compute_public_point_with_jubjub(b);
    let grind = 0n,
      c;
    do {
      c = littleEndianScalar(
        p.challenge_recover_submit(
          this.self,
          l.recovery_pk,
          ra,
          successor.pk,
          rb,
          successorRecovery.pk,
          l.device_epoch + 1n,
          l.auth_nonce,
          BigInt(this.now),
          grind,
        ),
      );
      if (c < JUBJUB_ORDER) break;
      grind++;
    } while (grind < 10000n);
    if (c >= JUBJUB_ORDER) throw new Error('simulation challenge grinding exhausted');
    return this.call(
      'recover_submit',
      successor.pk,
      successorRecovery.pk,
      l.device_epoch,
      l.auth_nonce,
      BigInt(this.now),
      ra,
      (a + c * recovery.scalar) % JUBJUB_ORDER,
      rb,
      (b + c * successor.scalar) % JUBJUB_ORDER,
      grind,
    );
  }

  snapshot() {
    const l = this.ledger();
    return {
      deviceEpoch: String(l.device_epoch),
      authNonce: String(l.auth_nonce),
      deviceCount: String(l.device_count),
      entries: [...l.devices].map(hex).sort(),
      recoveryPending: l.pending_recovery,
      recoveryPhiLength: String(l.recovery_phi_len),
    };
  }
}
