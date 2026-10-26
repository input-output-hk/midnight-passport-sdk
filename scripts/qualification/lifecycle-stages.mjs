/** Explicit test boundaries; not a runtime retry policy.
 * @param {'p256'|'jubjub'} arm
 * @returns {Array<[string,string,string]>}
 */
export const lifecycleStages = (arm) => [
  ['create', 'none', 'owner'],
  ['populate', 'none', 'populate'],
  ['add-survivor', 'none', 'owner'],
  ['add-target', `circuit:add_device_with_${arm}:after-submit`, 'owner'],
  ['add-target', 'none', 'resume'],
  ['remove-target', `circuit:rotate_enc_key_with_${arm}:after-submit`, 'owner'],
  ['remove-target', 'none', 'resume'],
  ['survivor-rotate', 'none', 'owner'],
  ['verify-removed', 'none', 'verify'],
];
/** @param {string} fault @param {import('../../packages/service/dist/index.js').HostMutationRecord} record */
export function crashesAfterSubmit(fault, record) {
  const ordinal = `${record.identity.kind}:${record.steps.length - 1}:after-submit`;
  const input = record.input;
  const circuit =
    input && typeof input === 'object' && !Array.isArray(input) && 'circuit' in input
      ? input.circuit
      : undefined;
  return (
    fault === ordinal ||
    (record.identity.kind === 'call' &&
      typeof circuit === 'string' &&
      fault === `circuit:${circuit}:after-submit`)
  );
}

/** Integrated current-harness outages; the final pre-registration intent stays unresolved.
 * @param {'p256'|'jubjub'} arm @returns {Array<[string,string,string]>} */
export const survivorOutageStages = (arm) => [
  ['create', 'deploy:0:after-submit', 'owner'],
  ['create', 'before-deploy-proof', 'resume'],
  ['create', 'call:0:after-submit', 'resume'],
  ['create', 'none', 'resume'],
  ...lifecycleStages(arm).slice(1, 7),
  ['survivor-rotate', 'call:0:after-submit', 'owner'],
  ['survivor-rotate', 'none', 'resume'],
  ['verify-removed', 'none', 'verify'],
  ['rotate-prover', 'before-owner-proof', 'owner'],
  ['rotate-prover', 'assert-unknown', 'resume'],
];

/** Flush the identifying marker before intentional process death, including piped stdout.
 * @param {string} fault @returns {Promise<never>} */
export async function emitCrashAndExit(fault) {
  if (typeof fault !== 'string' || !fault.length || fault.length > 128)
    throw new Error('Invalid crash boundary.');
  await new Promise((resolve, reject) => {
    process.stdout.write(`PASSPORT_LIVE ${JSON.stringify({ crash: fault })}\n`, (error) =>
      error ? reject(error) : resolve(undefined),
    );
  });
  process.exit(86);
}
