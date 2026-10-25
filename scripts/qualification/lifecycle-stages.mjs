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
