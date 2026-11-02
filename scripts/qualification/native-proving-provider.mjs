// Native qualification wiring only. No imports, network, wallet or transaction side effects.
/** @typedef {{ proverKey: Uint8Array, verifierKey: Uint8Array, ir: Uint8Array }} KeyMaterial */
/** @typedef {{prove(preimage:Uint8Array,location:string,binding?:bigint):Promise<Uint8Array>,check(preimage:Uint8Array,location:string):Promise<Uint8Array>}} CircuitProver */
/**
 * Convert the public host's opaque circuit-check bytes to the ledger proving port.
 * Construction checks run before any transaction, wallet or proof is started.
 * @param {{prover:CircuitProver,lookupKey:(location:string)=>Promise<KeyMaterial|undefined>,parseCheckResult:(bytes:Uint8Array)=>(bigint|undefined)[]}} options
 */
export function createNativeProvingProvider({ prover, lookupKey, parseCheckResult }) {
  if (
    !prover ||
    typeof prover.prove !== 'function' ||
    typeof prover.check !== 'function' ||
    typeof lookupKey !== 'function' ||
    typeof parseCheckResult !== 'function'
  )
    throw new TypeError(
      'Native transaction proving requires prove, check, lookupKey and a check decoder.',
    );
  return {
    /** @param {Uint8Array} preimage @param {string} location @param {bigint} [binding] */
    async prove(preimage, location, binding) {
      const result = await prover.prove(preimage, location, binding);
      if (!(result instanceof Uint8Array)) throw new TypeError('Circuit prove must return bytes.');
      return result;
    },
    /** @param {Uint8Array} preimage @param {string} location */
    async check(preimage, location) {
      const bytes = await prover.check(preimage, location);
      if (!(bytes instanceof Uint8Array))
        throw new TypeError('Circuit check must return opaque bytes.');
      const result = parseCheckResult(bytes);
      if (!Array.isArray(result) || result.some((v) => v !== undefined && typeof v !== 'bigint'))
        throw new TypeError('Circuit check decoder must return ledger check results.');
      return result;
    },
    lookupKey,
  };
}
