/** Resolve the launcher default without overwriting an explicit web signing configuration.
 * @param {{arm:'p256'|'jubjub', armExplicit?:true}} options
 * @param {NodeJS.ProcessEnv} env
 */
export function demoSigningEnvironment(options, env) {
  const mode = env.VITE_PASSPORT_SIGNING_MODE;
  if (mode !== undefined && mode !== 'passkey' && mode !== 'jubjub')
    throw Error('VITE_PASSPORT_SIGNING_MODE must be passkey or jubjub');
  const legacy = env.VITE_PASSPORT_ARM;
  if (legacy !== undefined && legacy !== 'p256' && legacy !== 'jubjub')
    throw Error('VITE_PASSPORT_ARM must be p256 or jubjub');
  const arm = mode === undefined ? (legacy ?? options.arm) : mode === 'passkey' ? 'p256' : 'jubjub';
  if ((options.armExplicit && options.arm !== arm) || (legacy !== undefined && legacy !== arm))
    throw Error('Conflicting Passport signing mode and arm configuration');
  return {
    VITE_PASSPORT_ARM: arm,
    ...(mode !== undefined && { VITE_PASSPORT_SIGNING_MODE: mode }),
  };
}
