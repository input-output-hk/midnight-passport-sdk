import type {
  PassportNameProvider,
  PassportNameQuery,
  PassportNameRecord,
  PassportNameService,
} from './ports/names.js';

export type {
  PassportNameProvider,
  PassportNameQuery,
  PassportNameRecord,
  PassportNameService,
} from './ports/names.js';

export type PassportNameErrorCode = 'InvalidQuery' | 'InvalidRecord' | 'Expired' | 'Unavailable';

/** Fixed public diagnostics; provider exception text and private responses never escape. */
export class PassportNameError extends Error {
  constructor(readonly code: PassportNameErrorCode) {
    const messages = {
      InvalidQuery: 'Configure a naming provider and supply an exact name and network.',
      InvalidRecord: 'The naming provider returned an invalid or differently scoped record.',
      Expired: 'The naming record has expired. Resolve it again before use.',
      Unavailable: 'The naming provider is unavailable; this does not mean the name is absent.',
    };
    super(messages[code]);
    this.name = 'PassportNameError';
  }
}

export interface ResolvedPassportName extends PassportNameRecord {
  readonly providerId: string;
  readonly mode: PassportNameProvider['mode'];
}

const token = (value: unknown, max = 128): value is string =>
  typeof value === 'string' && value.length <= max && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value);

/**
 * Checks a provider's resolution hint, not ownership, finality or permission to spend.
 * Does not normalise names, cache records, open an account or set a transfer recipient.
 */
export async function resolvePassportName(
  service: PassportNameService,
  query: PassportNameQuery,
  options: { readonly now?: () => number } = {},
): Promise<Readonly<ResolvedPassportName> | undefined> {
  const provider = service?.provider;
  const name = query?.name;
  const networkId = query?.networkId;
  if (
    !token(provider?.id) ||
    !token(provider?.namespace) ||
    !['mock', 'external'].includes(provider?.mode) ||
    typeof service.resolve !== 'function' ||
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > 256 ||
    /[\s\p{C}]/u.test(name) ||
    !token(networkId, 64)
  )
    throw new PassportNameError('InvalidQuery');
  // Capture caller/provider scope before awaiting an adapter that may mutate its own objects.
  const pins = Object.freeze({
    id: provider.id,
    namespace: provider.namespace,
    mode: provider.mode,
  });
  const request = Object.freeze({ name, networkId });
  let record: PassportNameRecord | undefined;
  try {
    record = await service.resolve(request);
  } catch {
    throw new PassportNameError('Unavailable');
  }
  if (record === undefined) return undefined;
  if (
    record === null ||
    typeof record !== 'object' ||
    record.name !== name ||
    record.networkId !== networkId ||
    record.namespace !== pins.namespace ||
    typeof record.accountAddress !== 'string' ||
    !/^[0-9a-f]{64}$/.test(record.accountAddress) ||
    (record.expiresAt !== undefined &&
      (!Number.isSafeInteger(record.expiresAt) || record.expiresAt < 0))
  )
    throw new PassportNameError('InvalidRecord');
  const now = (options.now ?? Date.now)();
  if (!Number.isSafeInteger(now) || now < 0) throw new PassportNameError('InvalidQuery');
  if (record.expiresAt !== undefined && record.expiresAt <= now)
    throw new PassportNameError('Expired');
  // Copy only public fields; provider extensions must not leak into UI state or audit output.
  return Object.freeze({
    name,
    networkId,
    namespace: pins.namespace,
    accountAddress: record.accountAddress,
    ...(record.expiresAt !== undefined && { expiresAt: record.expiresAt }),
    providerId: pins.id,
    mode: pins.mode,
  });
}
