import { randomUUID, createHash } from 'node:crypto';
import { resolveBinding } from '@input-output-hk/mn-passport-contract';
import {
  hostFailure,
  type HostJson,
  type HostMutationDriver,
  type HostMutationRecord,
  type HostPreparedTransaction,
  type HostMutationStep,
  type HostConfirmation,
} from '@input-output-hk/mn-passport-service';

/** Dynamic modules all come from the same pinned reference tree. This isolated adapter is the
 * only place that speaks its runtime-specific ledger/compiled-contract classes. No source edits
 * to Passport or Lace; private authority material is returned only to the encrypted host store.
 */
export interface ReferenceHostRuntime {
  readonly ledger: any;
  readonly versionOfRecord: (record: unknown) => string;
  readonly contracts: any;
  readonly waves: any;
  readonly signer: any;
  readonly setup: any;
  readonly witnesses: any;
  readonly providers: any;
  readonly proving: any;
  readonly networkId: string;
  readonly indexerUrl: string;
  readonly allowedAccount: (address: string) => boolean;
  readonly deploymentCompleted: (address: string) => void;
  readonly fetch?: typeof fetch;
}
const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'hex'));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
const object = (v: HostJson): Record<string, any> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return hostFailure();
  return v;
};
const OWNER =
  /^(activate_initial_device|append_inbox|rotate_enc_key|add_device|remove_device)_with_(p256|jubjub)$/;
const HEX = /^[0-9a-f]{64}$/;
const QUERY =
  'query HostMutationReceipt($offset: TransactionOffset!) { transactions(offset:$offset) { __typename protocolVersion raw hash block { height } ... on RegularTransaction { identifiers transactionResult { status } } } }';

/** Bounded single-read confirmation. Missing, failed, partial, malformed and era-mismatched
 * results stay unknown. Decode raw included bytes, validate hash AND the stored watch id.
 */
export async function readHostConfirmation(
  step: HostMutationStep,
  runtime: Pick<ReferenceHostRuntime, 'ledger' | 'indexerUrl' | 'fetch' | 'versionOfRecord'>,
): Promise<HostConfirmation | undefined> {
  const identifier = step.submissionId ?? step.identifiers[0]!;
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await (runtime.fetch ?? fetch)(runtime.indexerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { offset: { identifier } } }),
      signal: controller.signal,
    });
    if (!res.ok) return undefined;
    const value: any = await res.json();
    if (
      value.errors ||
      !Array.isArray(value.data?.transactions) ||
      value.data.transactions.length !== 1
    )
      return undefined;
    const r = value.data.transactions[0];
    if (
      r.__typename !== 'RegularTransaction' ||
      runtime.versionOfRecord(r) !== 'v9' ||
      r.transactionResult?.status !== 'SUCCESS' ||
      !Array.isArray(r.identifiers) ||
      !r.identifiers.includes(identifier) ||
      typeof r.hash !== 'string' ||
      !HEX.test(r.hash) ||
      typeof r.raw !== 'string' ||
      !/^(?:[0-9a-f]{2})+$/.test(r.raw) ||
      r.raw.length > 16 * 1024 * 1024 ||
      !Number.isSafeInteger(r.block?.height) ||
      r.block.height < 0
    )
      return undefined;
    const tx = runtime.ledger.Transaction.deserialize(
      'signature',
      'proof',
      'binding',
      bytes(r.raw),
    );
    if (!tx.identifiers().includes(identifier) || tx.transactionHash() !== r.hash) return undefined;
    return { identifier, txHash: r.hash, blockHeight: r.block.height, succeeded: true };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export function createReferenceHostDriver(r: ReferenceHostRuntime): HostMutationDriver {
  const L = r.ledger;
  const decode = (tx: string) =>
    L.Transaction.deserialize('signature', 'proof', 'binding', bytes(tx));
  const prepared = (tx: any): HostPreparedTransaction => ({
    tx: hex(tx.serialize()),
    identifiers: tx.identifiers().map(String),
  });
  const snapshot = async (address: string) => {
    const v = await r.providers.publicDataProvider.queryContractState(address);
    return v ? L.ContractState.deserialize(v.serialize()) : undefined;
  };
  const pins = resolveBinding('acc-s3r1.1');
  const names = Object.entries(pins.circuits)
    .filter(([, v]) => v.proof)
    .map(([k]) => k)
    .sort();
  const pinned = (state: any) => {
    const actual = state
      .operations()
      .map((name: any) => (typeof name === 'string' ? name : Buffer.from(name).toString('utf8')))
      .sort();
    return (
      actual.join(',') === names.join(',') &&
      names.every(
        (name) =>
          createHash('sha256').update(state.operation(name).verifierKey).digest('hex') ===
          pins.circuits[name]!.hashes!.verifierKey,
      )
    );
  };
  const contextOf = (record: HostMutationRecord) => {
    const c = object(record.plan!.context);
    if (
      c.driver !==
      (record.identity.kind === 'deploy' ? 'reference-v9-waves:1' : 'reference-v9-owner-call:1')
    )
      return hostFailure();
    return c;
  };
  const full = (record: HostMutationRecord) =>
    L.ContractState.deserialize(bytes(contextOf(record).state));
  const expectedState = (record: HostMutationRecord, count: number) => {
    const context = contextOf(record),
      original = full(record),
      expected = new L.ContractState();
    expected.data = original.data;
    expected.balance = original.balance;
    const retired = count === record.plan!.steps && context.retireAuthority === true;
    expected.maintenanceAuthority = new L.ContractMaintenanceAuthority(
      retired ? [] : original.maintenanceAuthority.committee,
      retired ? 1 : original.maintenanceAuthority.threshold,
      BigInt(count - 1),
    );
    for (const wave of context.waves.slice(0, count))
      for (const name of wave.circuits) expected.setOperation(name, original.operation(name));
    return expected;
  };
  return {
    async prepare(identity, input) {
      const request = object(input);
      if (identity.kind === 'call') {
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
        if (!r.allowedAccount(request.address) || !account || !pinned(account))
          return hostFailure();
        const tx = decode(request.tx),
          actions = [...tx.intents.values()].flatMap((i: any) => i.actions);
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
        if (
          [...tx.intents.values()].some(
            (i: any) => i.guaranteedUnshieldedOffer || i.fallibleUnshieldedOffer,
          )
        )
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
      if (
        typeof request.boot !== 'string' ||
        !HEX.test(request.boot) ||
        typeof request.encKey !== 'string' ||
        !HEX.test(request.encKey) ||
        typeof request.retireAuthority !== 'boolean' ||
        !['p256', 'jubjub'].includes(request.firstArm) ||
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
      const sizes = new Map<string, number>();
      for (const name of r.waves.allCircuits()) {
        const key = await r.providers.zkConfigProvider.getVerifierKey(name);
        if (!key || !state.operation(name) || !same(state.operation(name).verifierKey, key))
          return hostFailure();
        sizes.set(name, key.length);
      }
      if (
        state.maintenanceAuthority.counter !== 0n ||
        state.maintenanceAuthority.threshold !== 1 ||
        state.maintenanceAuthority.committee.length !== 1 ||
        JSON.stringify(L.signatureVerifyingKey(created.private.signingKey)) !==
          JSON.stringify(state.maintenanceAuthority.committee[0])
      )
        return hostFailure();
      const waves = r.waves.planWaves(sizes, request.firstArm, request.retireAuthority);
      const roster = waves.flatMap((w: any) => w.circuits),
        fullRoster = state
          .operations()
          .map((name: any) =>
            typeof name === 'string' ? name : Buffer.from(name).toString('utf8'),
          );
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
            wave.circuits.reduce((sum: number, name: string) => sum + sizes.get(name)!, 0) ||
          wave.verifierBytes > 15000 ||
          wave.retiresAuthority !== (request.retireAuthority && index === waves.length - 1)
        )
          return hostFailure();
      const initial = new L.ContractState();
      initial.data = state.data;
      initial.balance = state.balance;
      initial.maintenanceAuthority = state.maintenanceAuthority;
      for (const name of waves[0].circuits) initial.setOperation(name, state.operation(name));
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
          waves,
          retireAuthority: request.retireAuthority,
        } as HostJson,
      };
    },
    async prepareStep(record, index) {
      const context = contextOf(record);
      if (record.identity.kind === 'call') return context.transaction;
      const state = full(record),
        wave = context.waves[index];
      let action;
      if (index === 0) {
        const tx = L.Transaction.deserialize(
          'signature',
          'pre-proof',
          'pre-binding',
          bytes(context.deployTx),
        );
        const deploy = [...tx.intents.values()][0].actions[0];
        if (
          !(deploy instanceof L.ContractDeploy) ||
          String(deploy.address) !== record.plan!.address
        )
          return hostFailure();
        const proven = await tx.prove(r.proving, L.CostModel.initialCostModel());
        return prepared(
          (await r.providers.walletProvider.balanceTx({ version: 'v9', tx: proven })).tx,
        );
      } else {
        const counter = BigInt(index - 1),
          updates = [];
        for (const name of wave.circuits)
          updates.push(
            new L.VerifierKeyInsert(
              name,
              new L.ContractOperationVersionedVerifierKey('v4', state.operation(name).verifierKey),
            ),
          );
        if (wave.retiresAuthority)
          updates.push(
            new L.ReplaceAuthority(new L.ContractMaintenanceAuthority([], 1, counter + 1n)),
          );
        const bare = new L.MaintenanceUpdate(record.plan!.address, updates, counter);
        action = bare.addSignature(0n, L.signData(context.signingKey, bare.dataToSign));
      }
      const ttl = new Date(Date.now() + 60000),
        intent =
          index === 0
            ? L.Intent.new(ttl).addDeploy(action)
            : L.Intent.new(ttl).addMaintenanceUpdate(action);
      const unproven = L.Transaction.fromParts(r.networkId, undefined, undefined, intent);
      const proven = await unproven.prove(r.proving, L.CostModel.initialCostModel());
      const balanced = await r.providers.walletProvider.balanceTx({ version: 'v9', tx: proven });
      return prepared(balanced.tx);
    },
    async submit(transaction) {
      return String(
        await r.providers.midnightProvider.submitTx({ version: 'v9', tx: decode(transaction.tx) }),
      );
    },
    lookup: (step) => readHostConfirmation(step, r),
    async check(record, count) {
      if (record.identity.kind === 'call') {
        contextOf(record);
        const state = await snapshot(record.plan!.address);
        return r.allowedAccount(record.plan!.address) && !!state && pinned(state);
      }
      const observed = await snapshot(record.plan!.address);
      if (count === 0) return observed === undefined;
      if (!observed || !same(observed.serialize(), expectedState(record, count).serialize()))
        return false;
      if (count === record.plan!.steps) r.deploymentCompleted(record.plan!.address);
      return true;
    },
  };
}
