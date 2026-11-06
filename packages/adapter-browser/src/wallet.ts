/** Optional public DApp Connector reader. No globals, ACC authority or value methods. */
export interface WalletProvider {
  readonly id: string;
  readonly name: string;
  /** Self-reported advertisement, not proof of wallet identity. */
  readonly rdns: string;
  readonly apiVersion: string;
}
export interface WalletSnapshot {
  readonly networkId: string;
  readonly unshieldedAddress: string;
  readonly unshieldedBalances: Readonly<Record<string, bigint>>;
}
export type WalletReaderErrorCode =
  | 'ProviderUnavailable'
  | 'UnsupportedAPI'
  | 'PermissionRejected'
  | 'Disconnected'
  | 'NetworkMismatch'
  | 'InvalidWalletResponse'
  | 'WalletRequestFailed';
export class WalletReaderError extends Error {
  constructor(readonly code: WalletReaderErrorCode) {
    super(code);
    this.name = 'WalletReaderError';
  }
}
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const pins = new WeakMap<
  WalletProvider,
  { initial: ObjectValue; connect: (networkId: string) => Promise<unknown> }
>();
const version = /^(4\.(?:0|1)\.\d+)$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  !/[\x00-\x1f\x7f]/.test(value);

/** Enumeration never calls connect, reads an icon URL, or chooses a provider for the host. */
export function discoverWalletProviders(registry: unknown): readonly WalletProvider[] {
  if (!object(registry)) return Object.freeze([]);
  const providers: WalletProvider[] = [];
  let ids: string[];
  try {
    ids = Object.keys(registry).slice(0, 100);
  } catch {
    return Object.freeze([]);
  }
  for (const id of ids) {
    try {
      const initial = registry[id];
      if (!uuid.test(id) || !object(initial)) continue;
      const { name, rdns, apiVersion, connect } = initial;
      if (
        !text(name, 128) ||
        !text(rdns, 255) ||
        typeof apiVersion !== 'string' ||
        !version.test(apiVersion) ||
        typeof connect !== 'function'
      )
        continue;
      const provider = Object.freeze({ id, name, rdns, apiVersion });
      pins.set(provider, { initial, connect: connect as (networkId: string) => Promise<unknown> });
      providers.push(provider);
    } catch {
      /* A malformed advertisement must not hide other providers. */
    }
  }
  return Object.freeze(providers);
}

/** Read facade only. Forget invalidates it locally; wallet permissions are managed in the wallet. */
export interface WalletReader {
  read(): Promise<WalletSnapshot>;
  forget(): void;
}
export async function connectWalletReader(
  provider: WalletProvider,
  options: {
    readonly networkId: string;
    readonly registry: () => unknown;
    /** Host must decode address kind and network using its pinned address implementation. */
    readonly validateAddress: (address: string, networkId: string) => boolean;
  },
): Promise<WalletReader> {
  const { networkId, registry: currentRegistry, validateAddress } = options;
  if (!text(networkId, 128)) throw new WalletReaderError('NetworkMismatch');
  const pin = pins.get(provider);
  let forgotten = false;
  const assertCurrent = () => {
    if (forgotten) throw new WalletReaderError('Disconnected');
    try {
      const registry = currentRegistry();
      if (
        !pin ||
        !object(registry) ||
        registry[provider.id] !== pin.initial ||
        pin.initial.connect !== pin.connect ||
        pin.initial.name !== provider.name ||
        pin.initial.rdns !== provider.rdns ||
        pin.initial.apiVersion !== provider.apiVersion
      )
        throw new Error('Advertisement changed');
    } catch {
      throw new WalletReaderError('ProviderUnavailable');
    }
  };
  const request = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      let code: WalletReaderErrorCode = 'WalletRequestFailed';
      try {
        if (
          error instanceof WalletReaderError &&
          [
            'ProviderUnavailable',
            'UnsupportedAPI',
            'PermissionRejected',
            'Disconnected',
            'NetworkMismatch',
            'InvalidWalletResponse',
            'WalletRequestFailed',
          ].includes(error.code)
        )
          code = error.code;
        else if (object(error) && error.type === 'DAppConnectorAPIError') {
          if (error.code === 'Rejected' || error.code === 'PermissionRejected')
            code = 'PermissionRejected';
          else if (error.code === 'Disconnected') code = 'Disconnected';
        }
      } catch {
        /* Includes hostile error getters and prototype traps. */
      }
      // Construct our own public error; never preserve provider messages, causes or properties.
      throw new WalletReaderError(code);
    }
  };
  assertCurrent();
  const api = await request(() => pin!.connect.call(pin!.initial, networkId));
  assertCurrent();
  // Inspect each untrusted property exactly once inside the same coarse-error boundary.
  const { status, address, balances } = await request(async () => {
    if (!object(api)) throw new WalletReaderError('UnsupportedAPI');
    const { getConnectionStatus, getUnshieldedAddress, getUnshieldedBalances } = api;
    if (
      typeof getConnectionStatus !== 'function' ||
      typeof getUnshieldedAddress !== 'function' ||
      typeof getUnshieldedBalances !== 'function'
    )
      throw new WalletReaderError('UnsupportedAPI');
    return {
      status: getConnectionStatus as () => Promise<unknown>,
      address: getUnshieldedAddress as () => Promise<unknown>,
      balances: getUnshieldedBalances as () => Promise<unknown>,
    };
  });
  const checkStatus = () =>
    request(async () => {
      assertCurrent();
      const result = await request(() => status.call(api));
      assertCurrent();
      if (!object(result) || result.status !== 'connected')
        throw new WalletReaderError('Disconnected');
      if (result.networkId !== networkId) throw new WalletReaderError('NetworkMismatch');
    });
  await checkStatus();
  return Object.freeze({
    async read(): Promise<WalletSnapshot> {
      return request(async () => {
        await checkStatus();
        const [a, b] = await request(() => Promise.all([address.call(api), balances.call(api)]));
        await checkStatus();
        if (
          !object(a) ||
          !text(a.unshieldedAddress, 512) ||
          !object(b) ||
          ![null, Object.prototype].includes(Object.getPrototypeOf(b))
        )
          throw new WalletReaderError('InvalidWalletResponse');
        let valid = false;
        try {
          valid = validateAddress(a.unshieldedAddress, networkId);
        } catch {
          /* refused */
        }
        if (!valid) throw new WalletReaderError('InvalidWalletResponse');
        const entries = Object.entries(b);
        if (
          entries.length > 1024 ||
          entries.some(
            ([color, amount]) =>
              !/^[0-9a-f]{64}$/.test(color) ||
              typeof amount !== 'bigint' ||
              amount < 0n ||
              amount >= 1n << 128n,
          )
        )
          throw new WalletReaderError('InvalidWalletResponse');
        return Object.freeze({
          networkId: networkId,
          unshieldedAddress: a.unshieldedAddress,
          unshieldedBalances: Object.freeze(Object.fromEntries(entries) as Record<string, bigint>),
        });
      });
    },
    forget() {
      forgotten = true;
    },
  });
}
