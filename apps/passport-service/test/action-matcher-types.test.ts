import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  viewOfLedgerTx,
  type ActionClasses,
  type LedgerTxLike,
} from '@input-output-hk/mn-passport-service';

test('action inspection accepts private native-style constructors and retains legacy class inputs', () => {
  class Call {
    private constructor() {}
    readonly address = 'ab'.repeat(32);
    static make() {
      return new Call();
    }
  }
  class Deploy {
    private constructor() {}
  }
  class Maintenance {
    private constructor() {}
  }
  const tx: LedgerTxLike = {
    rewards: undefined,
    guaranteedOffer: undefined,
    fallibleOffer: undefined,
    intents: new Map([
      [
        0,
        {
          actions: [Call.make()],
          guaranteedUnshieldedOffer: undefined,
          fallibleUnshieldedOffer: undefined,
          dustActions: undefined,
        },
      ],
    ]),
    imbalances: () => new Map(),
  };
  const view = viewOfLedgerTx(tx, {
    ContractCall: Call,
    ContractDeploy: Deploy,
    MaintenanceUpdate: Maintenance,
  });
  assert.deepEqual(view.intents?.get(0)?.actions, [{ kind: 'call', address: 'ab'.repeat(32) }]);
  const legacy: ActionClasses = {
    ContractCall: class {},
    ContractDeploy: class {},
    MaintenanceUpdate: class {},
  };
  assert.equal(viewOfLedgerTx({ ...tx, intents: new Map() }, legacy).intents?.size, 0);
});
