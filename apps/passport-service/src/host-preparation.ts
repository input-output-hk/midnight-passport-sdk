import type * as Ledger from '@midnightntwrk/ledger-v9';
import { randomUUID } from 'node:crypto';
import {
  hostFailure,
  type HostJson,
  type HostMutationIdentity,
  type HostMutationPlan,
  type HostPreparedTransaction,
} from '@input-output-hk/mn-passport-service';
import type { ReferenceHostRuntime, Wave } from './reference-runtime.ts';
import { bytes, hex, same, operation, intents, verifierSize } from './host-ledger.ts';
export interface HostPreparationContext {
  readonly r: ReferenceHostRuntime;
  readonly L: ReferenceHostRuntime['ledger'];
  decode(tx: string): Ledger.FinalizedTransaction;
  prepared(
    tx: Pick<Ledger.FinalizedTransaction, 'serialize' | 'identifiers'>,
  ): HostPreparedTransaction;
  snapshot(address: string): Promise<Ledger.ContractState | undefined>;
  pinned(state: Ledger.ContractState): boolean;
}
const object = (v: HostJson): Record<string, HostJson> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return hostFailure();
  return v as Record<string, HostJson>;
};
const OWNER =
  /^(activate_initial_device|append_inbox|rotate_enc_key|add_device|remove_device)_with_(p256|jubjub)$/;
const HEX = /^[0-9a-f]{64}$/;
export async function prepareHostMutation(
  env: HostPreparationContext,
  identity: HostMutationIdentity,
  input: HostJson,
): Promise<HostMutationPlan> {
  const request = object(input);
  return identity.kind === 'call'
    ? prepareOwnerCall(env, identity, request)
    : prepareDeployment(env, identity, request);
}
async function prepareOwnerCall(
  env: HostPreparationContext,
  identity: HostMutationIdentity,
  request: Record<string, HostJson>,
): Promise<HostMutationPlan> {
  const { r, L, decode, prepared, snapshot, pinned } = env;
  if (
    typeof request.tx !== 'string' ||
    typeof request.address !== 'string' ||
    !HEX.test(request.address) ||
    typeof request.circuit !== 'string' ||
    !OWNER.test(request.circuit) ||
    !request.circuit.endsWith(identity.pins.scheme === 'p256-webauthn' ? '_p256' : '_jubjub')
  )
    return hostFailure();
  const account = await snapshot(request.address);
  if (!r.allowedAccount(request.address) || !account || !pinned(account)) return hostFailure();
  const tx = decode(request.tx),
    actions = intents(tx).flatMap((i) => i.actions);
  if (
    actions.length !== 1 ||
    !(actions[0] instanceof L.ContractCall) ||
    String(actions[0].address) !== request.address
  )
    return hostFailure();
  const name =
    typeof actions[0].entryPoint === 'string'
      ? actions[0].entryPoint
      : Buffer.from(actions[0].entryPoint).toString('utf8');
  if (intents(tx).some((i) => i.guaranteedUnshieldedOffer || i.fallibleUnshieldedOffer))
    return hostFailure();
  if (name !== request.circuit || tx.rewards || tx.guaranteedOffer || tx.fallibleOffer?.size)
    return hostFailure();
  // This is owner-mutation-only. No arbitrary value call, deploy or maintenance transaction.
  return {
    address: request.address,
    steps: 1,
    context: {
      kind: 'call',
      driver: 'reference-v9-owner-call:1',
      transaction: { ...prepared(tx) },
    },
  };
}
async function prepareDeployment(
  env: HostPreparationContext,
  identity: HostMutationIdentity,
  request: Record<string, HostJson>,
): Promise<HostMutationPlan> {
  const { r, L, pinned } = env;
  if (
    typeof request.boot !== 'string' ||
    !HEX.test(request.boot) ||
    typeof request.encKey !== 'string' ||
    !HEX.test(request.encKey) ||
    typeof request.retireAuthority !== 'boolean' ||
    (request.firstArm !== 'p256' && request.firstArm !== 'jubjub') ||
    request.firstArm !== (identity.pins.scheme === 'p256-webauthn' ? 'p256' : 'jubjub')
  )
    return hostFailure();
  const birth = r.signer.JubjubDevice.generate();
  const created = await r.contracts.createUnprovenDeployTx(r.providers, {
    compiledContract: r.setup.compiledAccountContract(),
    privateStateId: `host-${randomUUID()}`,
    initialPrivateState: r.witnesses.emptyCoinStore(),
    args: [bytes(request.boot), bytes(request.encKey), birth.pk, new Uint8Array(64), 259200n],
  });
  const state = L.ContractState.deserialize(created.public.initialContractState.serialize());
  if (!pinned(state)) return hostFailure();
  const sizes = await verifierSizes(env, state, created.private.signingKey);
  const waves = r.waves.planWaves(sizes, request.firstArm, request.retireAuthority);
  checkWaves(waves, state, sizes, request.retireAuthority);
  const initial = new L.ContractState();
  initial.data = state.data;
  initial.balance = state.balance;
  initial.maintenanceAuthority = state.maintenanceAuthority;
  const firstWave = waves[0];
  if (!firstWave) return hostFailure();
  for (const name of firstWave.circuits) initial.setOperation(name, operation(state, name));
  const deploy = new L.ContractDeploy(initial);
  const deployTx = L.Transaction.fromParts(
    r.networkId,
    undefined,
    undefined,
    L.Intent.new(new Date(Date.now() + 60000)).addDeploy(deploy),
  );
  return {
    address: String(deploy.address),
    steps: waves.length,
    context: {
      kind: 'deploy',
      driver: 'reference-v9-waves:1',
      deployTx: hex(deployTx.serialize()),
      state: hex(state.serialize()),
      signingKey: created.private.signingKey,
      waves: waves.map((wave) => ({
        index: wave.index,
        kind: wave.kind,
        circuits: [...wave.circuits],
        verifierBytes: wave.verifierBytes,
        retiresAuthority: wave.retiresAuthority,
      })),
      retireAuthority: request.retireAuthority,
    },
  };
}
async function verifierSizes(
  env: HostPreparationContext,
  state: Ledger.ContractState,
  signingKey: Ledger.SigningKey,
) {
  const { r, L } = env;
  const sizes = new Map<string, number>();
  for (const name of r.waves.allCircuits()) {
    const key = await r.providers.zkConfigProvider.getVerifierKey(name);
    if (!key || !state.operation(name) || !same(operation(state, name).verifierKey, key))
      return hostFailure();
    sizes.set(name, key.length);
  }
  if (
    state.maintenanceAuthority.counter !== 0n ||
    state.maintenanceAuthority.threshold !== 1 ||
    state.maintenanceAuthority.committee.length !== 1 ||
    JSON.stringify(L.signatureVerifyingKey(signingKey)) !==
      JSON.stringify(state.maintenanceAuthority.committee[0])
  )
    return hostFailure();

  return sizes;
}
function checkWaves(
  waves: readonly Wave[],
  state: Ledger.ContractState,
  sizes: ReadonlyMap<string, number>,
  retireAuthority: boolean,
) {
  const roster = waves.flatMap((w) => w.circuits),
    fullRoster = state
      .operations()
      .map((name) => (typeof name === 'string' ? name : Buffer.from(name).toString('utf8')));
  if (
    waves.length < 2 ||
    waves.length > 64 ||
    roster.length !== 52 ||
    new Set(roster).size !== 52 ||
    [...roster].sort().join(',') !== fullRoster.sort().join(',')
  )
    return hostFailure();
  for (const [index, wave] of waves.entries())
    if (
      wave.index !== index + 1 ||
      wave.kind !== (index === 0 ? 'deploy' : 'maintenance') ||
      !Array.isArray(wave.circuits) ||
      wave.circuits.length === 0 ||
      wave.verifierBytes !==
        wave.circuits.reduce((sum: number, name: string) => sum + verifierSize(sizes, name), 0) ||
      wave.verifierBytes > 15000 ||
      wave.retiresAuthority !== (retireAuthority && index === waves.length - 1)
    )
      return hostFailure();
}
