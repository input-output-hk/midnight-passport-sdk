// The ACC's minimal JubJub owner, grant, inbox, and deposit proving set.
// Lace PR #2845 currently consumes this set; the package owns the profile,
// while the compatibility test pins the external consumer's artifact hashes.
export const JUBJUB_OWNER_CIRCUITS = Object.freeze([
  'activate_initial_device_with_jubjub',
  'add_device_with_jubjub',
  'append_inbox_with_jubjub',
  'deposit_shielded',
  'deposit_unshielded',
  'issue_grant_with_jubjub',
  'remove_device_with_jubjub',
  'revoke_all_grants_with_jubjub',
  'revoke_grant_with_jubjub',
  'rotate_enc_key_with_jubjub',
]);

export function selectKeyProfile(name, provers) {
  if (name === 'all')
    return { name, circuits: [...provers.keys()].map((key) => key.slice(0, -7)).sort() };
  if (name !== 'jubjub-owner-v1') throw new Error(`unsupported key profile: ${name}`);
  for (const circuit of JUBJUB_OWNER_CIRCUITS)
    if (!provers.has(`${circuit}.prover`)) throw new Error(`profile circuit is absent: ${circuit}`);
  return { name, circuits: [...JUBJUB_OWNER_CIRCUITS] };
}
