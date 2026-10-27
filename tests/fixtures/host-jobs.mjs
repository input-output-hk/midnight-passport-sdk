import {
  createHostMutationExecutor,
  createHostMutationJobs,
  createMemoryHostJobStore,
} from '../../packages/service/dist/index.js';
export const servicePins = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
};
/** @param {number} [n] @returns {import('../../packages/service/dist/index.js').HostJobDescriptor} */
export const descriptor = (n = 1) => ({
  version: 1,
  identity: {
    pins: { ...servicePins, scheme: 'jubjub-schnorr' },
    kind: 'call',
    requestId: n.toString(16).padStart(32, '0') + ':0',
    intentSha256: '12'.repeat(32),
  },
  input: {
    address: 'ab'.repeat(32),
    circuit: 'append_inbox_with_jubjub',
    tx: n.toString(16).padStart(2, '0'),
  },
});
export function barrier() {
  let release = () => {};
  const promise = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  return { promise, release };
}
/** @param {import('../../packages/service/dist/index.js').HostJobStore} [jobStore] @param {Partial<import('../../packages/service/dist/index.js').HostJobOptions>} [options] */
export function fixture(jobStore = createMemoryHostJobStore(), options = {}) {
  /** @type {Map<string,import('../../packages/service/dist/index.js').HostMutationRecord>} */ const hostRecords =
    new Map();
  let sends = 0,
    executions = 0,
    resumes = 0,
    prepared = 0,
    visible = true,
    lose = false;
  const receipts = new Set();
  /** @type {import('../../packages/service/dist/index.js').HostMutationStore} */ const hostStore =
    {
      read: async (i) => structuredClone(hostRecords.get(i.requestId)),
      compareAndSwap: async (old, next) => {
        if (hostRecords.get(next.identity.requestId)?.revision !== old) return false;
        hostRecords.set(next.identity.requestId, structuredClone(next));
        return true;
      },
    };
  /** @type {import('../../packages/service/dist/index.js').HostMutationDriver} */ const driver = {
    prepare: async () => ({ address: 'ab'.repeat(32), steps: 1, context: {} }),
    prepareStep: async (r) => {
      prepared++;
      return {
        tx: 'ab' + r.identity.requestId.slice(30, 32),
        identifiers: [r.identity.requestId.slice(30, 32).padStart(64, '0')],
      };
    },
    submit: async (tx) => {
      sends++;
      receipts.add(tx.identifiers[0]);
      if (lose) {
        lose = false;
        throw new Error('protected broadcast reply lost');
      }
      return /** @type {string} */ (tx.identifiers[0]);
    },
    lookup: async (tx) =>
      visible && receipts.has(tx.identifiers[0])
        ? {
            identifier: /** @type {string} */ (tx.identifiers[0]),
            txHash: 'ef'.repeat(32),
            succeeded: true,
          }
        : undefined,
    check: async () => true,
  };
  const host = createHostMutationExecutor(hostStore, driver);
  /** @type {import('../../packages/service/dist/index.js').HostJobExecutor} */ const executor = {
    execute: async (...args) => {
      executions++;
      return host.execute(...args);
    },
    resume: async (...args) => {
      resumes++;
      return host.resume(...args);
    },
    inspect: host.inspect,
  };
  const jobs = createHostMutationJobs(jobStore, executor, { ...options, pins: servicePins });
  return {
    jobs,
    executor,
    driver,
    hostStore,
    jobStore,
    hostRecords,
    counts: () => ({ sends, executions, resumes, prepared }),
    visible: (v = true) => {
      visible = v;
    },
    lose: () => {
      lose = true;
    },
  };
}
