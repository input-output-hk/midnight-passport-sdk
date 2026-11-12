import {
  balanceHostGrantIssue,
  grantIssueWithinDeadline,
  readHostGrantIssueRequest,
} from './host-grant-issue.ts';
import { prepareHostMutation } from './host-preparation.ts';
import { readHostConfirmation } from '@input-output-hk/mn-passport-service/finality';
export { readHostConfirmation } from '@input-output-hk/mn-passport-service/finality';
import { createHash } from 'node:crypto';
import { resolveBinding } from '@input-output-hk/mn-passport-contract';
import {
  hostFailure,
  type HostMutationDriver,
  type HostMutationRecord,
  type HostPreparedTransaction,
} from '@input-output-hk/mn-passport-service';

/** Dynamic modules all come from the same pinned reference tree. This isolated adapter is the
 * only place that speaks its runtime-specific ledger/compiled-contract classes. No source edits
 * to Passport or Lace; private authority material is returned only to the encrypted host store.
 */
import type * as Ledger from '@midnightntwrk/ledger-v9';
import type { ReferenceHostRuntime } from './reference-runtime.ts';
export type { ReferenceHostRuntime } from './reference-runtime.ts';
import { callContext, deploymentContext, requireHostPlan } from './host-context.ts';
import { bytes, hex, same, operation, intents } from './host-ledger.ts';
function prepareCallStep(r: ReferenceHostRuntime, record: HostMutationRecord) {
  const context = callContext(record);
  return context.driver === 'reference-v9-grant-issue:1'
    ? balanceHostGrantIssue(r, readHostGrantIssueRequest(record.input))
    : context.transaction;
}

function allowRetainedCall(r: ReferenceHostRuntime, record: HostMutationRecord, count: number) {
  return (
    callContext(record).driver !== 'reference-v9-grant-issue:1' ||
    (r.allowGrantIssue === true &&
      (count !== 0 || grantIssueWithinDeadline(readHostGrantIssueRequest(record.input))))
  );
}

export function createReferenceHostDriver(r: ReferenceHostRuntime): HostMutationDriver {
  const L = r.ledger;
  const decode = (tx: string) =>
    L.Transaction.deserialize<Ledger.SignatureEnabled, Ledger.Proof, Ledger.Binding>(
      'signature',
      'proof',
      'binding',
      bytes(tx),
    );
  const prepared = (
    tx: Pick<Ledger.FinalizedTransaction, 'serialize' | 'identifiers'>,
  ): HostPreparedTransaction => ({
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
  const pinned = (state: Ledger.ContractState) => {
    const actual = state
      .operations()
      .map((name) => (typeof name === 'string' ? name : Buffer.from(name).toString('utf8')))
      .sort();
    return (
      actual.join(',') === names.join(',') &&
      names.every(
        (name) =>
          createHash('sha256').update(operation(state, name).verifierKey).digest('hex') ===
          (pins.circuits[name]?.hashes?.verifierKey ?? hostFailure()),
      )
    );
  };
  const full = (record: HostMutationRecord) =>
    L.ContractState.deserialize(bytes(deploymentContext(record).state));
  const expectedState = (record: HostMutationRecord, count: number) => {
    const context = deploymentContext(record),
      original = full(record),
      expected = new L.ContractState();
    expected.data = original.data;
    expected.balance = original.balance;
    const retired = count === requireHostPlan(record).steps && context.retireAuthority === true;
    expected.maintenanceAuthority = new L.ContractMaintenanceAuthority(
      retired ? [] : original.maintenanceAuthority.committee,
      retired ? 1 : original.maintenanceAuthority.threshold,
      BigInt(count - 1),
    );
    for (const wave of context.waves.slice(0, count))
      for (const name of wave.circuits) expected.setOperation(name, operation(original, name));
    return expected;
  };
  return {
    prepare: (identity, input) =>
      prepareHostMutation({ r, L, decode, prepared, snapshot, pinned }, identity, input),
    async prepareStep(record, index) {
      if (record.identity.kind === 'call') return prepareCallStep(r, record);
      const context = deploymentContext(record);
      const state = full(record),
        wave = context.waves[index];
      if (!wave) return hostFailure();
      let action;
      if (index === 0) {
        const tx = L.Transaction.deserialize(
          'signature',
          'pre-proof',
          'pre-binding',
          bytes(context.deployTx),
        );
        const deploy = intents(tx)[0]?.actions[0];
        if (
          !(deploy instanceof L.ContractDeploy) ||
          String(deploy.address) !== requireHostPlan(record).address
        )
          return hostFailure();
        if (
          !intents(tx).every(
            (intent: { readonly ttl: Date }) => intent.ttl.getTime() > Date.now() + 10000,
          )
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
              new L.ContractOperationVersionedVerifierKey('v4', operation(state, name).verifierKey),
            ),
          );
        if (wave.retiresAuthority)
          updates.push(
            new L.ReplaceAuthority(new L.ContractMaintenanceAuthority([], 1, counter + 1n)),
          );
        const bare = new L.MaintenanceUpdate(requireHostPlan(record).address, updates, counter);
        action = bare.addSignature(0n, L.signData(context.signingKey, bare.dataToSign));
      }
      const ttl = new Date(Date.now() + 60000),
        intent = L.Intent.new(ttl).addMaintenanceUpdate(action);
      const unproven = L.Transaction.fromParts(r.networkId, undefined, undefined, intent);
      const proven = await unproven.prove(r.proving, L.CostModel.initialCostModel());
      const balanced = await r.providers.walletProvider.balanceTx({ version: 'v9', tx: proven });
      return prepared(balanced.tx);
    },
    async submit(transaction, record) {
      if (!record) return hostFailure();
      const tx = decode(transaction.tx);
      const provider = r.providers.midnightProvider ?? hostFailure();
      if (record.identity.kind === 'call' && !allowRetainedCall(r, record, 0)) return hostFailure();
      return String(await provider.submitTx({ version: 'v9', tx }));
    },
    lookup: (step) => readHostConfirmation(step, r),
    async check(record, count) {
      const pending = record.steps[count];
      if (
        pending?.phase === 'ready' &&
        !intents(decode(pending.tx)).every(
          (intent: { readonly ttl: Date }) => intent.ttl.getTime() > Date.now() + 10000,
        )
      )
        return false;
      if (record.identity.kind === 'call') {
        if (!allowRetainedCall(r, record, count)) return false;
        const state = await snapshot(requireHostPlan(record).address);
        return (
          r.allowedAccount(requireHostPlan(record).address) &&
          !!state &&
          pinned(state) &&
          allowRetainedCall(r, record, count)
        );
      }
      const observed = await snapshot(requireHostPlan(record).address);
      if (count === 0) return observed === undefined;
      if (!observed || !same(observed.serialize(), expectedState(record, count).serialize()))
        return false;
      if (count === requireHostPlan(record).steps)
        r.deploymentCompleted(requireHostPlan(record).address);
      return true;
    },
  };
}
