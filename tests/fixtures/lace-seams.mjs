// lace-platform's seam shapes, copied as fixtures, and objects of those shapes: the ports must
// take them by assignment (account-ports.test.mjs), and they run the port contract suites
// (account-testing.test.mjs), as lace-platform's own adapters would.

/**
 * lace-platform's seam shapes (`@lace-contract/passport` types.ts, origin/main), copied as fixtures:
 * property syntax and tagged parameter types, as Lace declares them. `storageKey` resolves a
 * `CryptoKey`, which these types do not declare; `unknown` stands in.
 * @typedef {string & { readonly __tag: 'AccAddress' }} AccAddress
 * @typedef {bigint & { readonly __tag: 'UseCounter' }} UseCounter
 * @typedef {bigint & { readonly __tag: 'DeviceEpoch' }} DeviceEpoch
 * @typedef {string & { readonly __tag: 'DeviceCommitmentHex' }} DeviceCommitmentHex
 * @typedef {{ account: AccAddress; circuit: string; args: readonly unknown[];
 *   witnessValues: readonly unknown[]; authNonce: bigint; useCounter: UseCounter }} LaceAuthorisationRequest
 * @typedef {{ scheme: 'jubjub-schnorr'; pk: { x: bigint; y: bigint }; useCounter: bigint;
 *   sigR: { x: bigint; y: bigint }; sigS: bigint; grindNonce: bigint }} LaceAuthorisation
 * @typedef {{ kind: 'add-device' | 'create-account' | 'remove-device' | 'sign-in';
 *   commitmentHex?: string }} LaceKeySessionFlow
 * @typedef {{
 *   readonly scheme: 'jubjub-schnorr';
 *   deviceCommitment: (account: AccAddress, epoch: DeviceEpoch, counter: UseCounter) => Promise<DeviceCommitmentHex>;
 *   deviceCommitments?: (account: AccAddress, epoch: DeviceEpoch, counters: readonly UseCounter[]) => Promise<DeviceCommitmentHex[]>;
 *   devicePublicKey: () => Promise<{ x: bigint; y: bigint }>;
 *   authorise: (request: LaceAuthorisationRequest) => Promise<LaceAuthorisation>;
 *   storageKey?: () => Promise<unknown>;
 *   withKeySession?: <T>(operation: () => Promise<T>, flow?: LaceKeySessionFlow) => Promise<T>;
 * }} LacePassportAuthoriser
 * @typedef {{ balanceAndSign: (unbalancedTx: Uint8Array) => Promise<Uint8Array> }} LaceFeeSponsor
 * @typedef {{ publicKey: (networkId: string) => Promise<Uint8Array> }} LacePassportEncryptionKey
 * @typedef {{ networkId: string; indexerUrl: string; indexerWsUrl: string; nodeUrl: string;
 *   artefactUrl: string }} LacePassportNetworkConfig
 * @typedef {{ withSession: <T>(operation: () => Promise<T>) => Promise<T>;
 *   deviceSecret: () => Promise<Uint8Array>;
 *   deriveSecret: (params: { domain: string; context: string }) => Promise<Uint8Array> }} LacePasskeyKeySource
 */

/** A Lace-shaped JubJub `PassportAuthoriser`, with a stand-in signature. */
export function laceAuthoriser() {
  const pk = { x: 1n, y: 2n };
  /** @type {LacePassportAuthoriser} */
  const lace = {
    scheme: 'jubjub-schnorr',
    deviceCommitment: async () => /** @type {DeviceCommitmentHex} */ ('ab'),
    deviceCommitments: async (_account, _epoch, counters) =>
      counters.map(() => /** @type {DeviceCommitmentHex} */ ('ab')),
    devicePublicKey: async () => pk,
    authorise: async (request) => ({
      scheme: 'jubjub-schnorr',
      pk,
      useCounter: request.useCounter,
      sigR: pk,
      sigS: 3n,
      grindNonce: 4n,
    }),
    storageKey: async () => undefined,
    withKeySession: (operation) => operation(),
  };
  return lace;
}

/** @returns {LaceFeeSponsor} A Lace-shaped `FeeSponsor`. */
export const laceFeeSponsor = () => ({ balanceAndSign: async (tx) => Uint8Array.of(...tx, 9) });
