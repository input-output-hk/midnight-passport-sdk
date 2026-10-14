// lace-platform's seam shapes, copied as fixtures, and objects of those shapes: the ports must
// take them by assignment (account-ports.test.mjs), and they run the port contract suites
// (account-testing.test.mjs), as lace-platform's own adapters would.

/**
 * lace-platform PR #2845 at 05e1e3d641a329d20c8272f6405e54ea499d86a1
 * (`@lace-contract/passport` types.ts), copied as fixtures:
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
 * @typedef {{ kind: 'add-device' | 'create-account' | 'issue-grant' | 'read-holdings' |
 *   'remove-device' | 'revoke-all-grants' | 'revoke-grant' | 'sign-in';
 *   commitmentHex?: string; account?: AccAddress; read?: boolean; devices?: string[];
 *   lockAccount?: boolean }} LaceKeySessionFlow
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
 * @typedef {{ account: AccAddress; encKey: Uint8Array; envelopes: readonly Uint8Array[] }} LaceAccountKeyring
 * @typedef {{ readerPublicKey: string; devicePublicKey: string }} LaceDeviceReader
 * @typedef {LaceDeviceReader & { epoch: bigint; counter: bigint }} LaceLiveDeviceReader
 * @typedef {{ devicePublicKey: string; keyring?: LaceAccountKeyring;
 *   registrations?: readonly Uint8Array[]; readers?: readonly LaceLiveDeviceReader[];
 *   rotateRoster?: boolean; removed?: { devicePublicKey: string; epoch: bigint; counter: bigint } }} LaceCreateKeys
 * @typedef {{ grantId: string; slot: number; scopeSalt: string; granteePublicKey: string;
 *   readPublicKey?: string; object: { color: string; recipient: {kind: 'any'} |
 *     {kind: 'coin-public-key' | 'contract-address' | 'user-address'; value: string};
 *     maxCoinValue: string } }} LaceGrantBookkeeping
 * @typedef {{ kind: 'coin'; coin: { nonce: Uint8Array; color: Uint8Array; value: bigint } } |
 *   { kind: 'device'; device: LaceDeviceReader } |
 *   { kind: 'grant'; record: { part: 'object'; grantId: string; object: LaceGrantBookkeeping['object'] } |
 *     { part: 'view'; grantId: string; encKeyPrefix: string; seal: string } |
 *     (Omit<LaceGrantBookkeeping, 'object'> & { part: 'grant' }) }} LaceOpenedInboxEntry
 * @typedef {{
 *   readerPublicKey: (networkId: string) => Promise<Uint8Array>;
 *   createKeys: (networkId: string, request: LaceCreateKeys) => Promise<{
 *     encKey: Uint8Array; envelopes: Uint8Array[]; registrations: Uint8Array[] }>;
 *   sealToDevice: (networkId: string, keyring: LaceAccountKeyring,
 *     reader: LaceLiveDeviceReader) => Promise<{ envelope: Uint8Array; registration: Uint8Array }>;
 *   openInbox: (networkId: string, keyring: LaceAccountKeyring,
 *     entries: readonly Uint8Array[]) => Promise<(LaceOpenedInboxEntry | null)[]>;
 *   sealGrant: (networkId: string, account: AccAddress,
 *     grant: LaceGrantBookkeeping) => Promise<Uint8Array[]>;
 *   reencryptInbox?: (networkId: string, rotation: { keyring: LaceAccountKeyring; to: Uint8Array },
 *     entries: readonly Uint8Array[]) => Promise<(Uint8Array | null)[]>;
 *   sealView?: (networkId: string, keyring: LaceAccountKeyring,
 *     request: { grantId: string; account: AccAddress; readPublicKey: string }) =>
 *       Promise<{ seal: Uint8Array; entry: Uint8Array }>;
 * }} LacePassportEncryptionKey
 * @typedef {{ prove: (preimage: Uint8Array, keyLocation: string,
 *   overwriteBindingInput?: bigint) => Promise<Uint8Array>;
 *   check: (preimage: Uint8Array, keyLocation: string) => Promise<Uint8Array> }} LacePassportProver
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

/** @returns {LacePassportEncryptionKey} A Lace-shaped random viewing-secret source. */
export const laceViewingKey = () => ({
  readerPublicKey: async () => new Uint8Array(32),
  createKeys: async () => ({ encKey: new Uint8Array(32), envelopes: [], registrations: [] }),
  sealToDevice: async () => ({ envelope: new Uint8Array(192), registration: new Uint8Array(192) }),
  openInbox: async (_network, _keyring, entries) => entries.map(() => null),
  sealGrant: async () => [],
  reencryptInbox: async (_network, _rotation, entries) => entries.map(() => null),
  sealView: async () => ({ seal: new Uint8Array(94), entry: new Uint8Array(192) }),
});
