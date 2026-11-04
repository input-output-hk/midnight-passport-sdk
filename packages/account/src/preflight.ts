/**
 * Advisory configuration inspection for an existing sealed owner account. No port, loader,
 * getter or key ceremony is invoked. This does not replace any flow's runtime guards.
 * Supply trusted port objects, not proxies with executable reflection traps.
 */
export type AccountPreflightOperation =
  'withdraw-unshielded' | 'withdraw-shielded' | 'issue-grant' | 'recover-pending-grants';

export interface AccountPreflightRequest {
  readonly operation: AccountPreflightOperation;
  /** Required for issue-grant; both branches exist, so omission must not assume non-read. */
  readonly grantRead?: boolean;
}
export interface AccountConfigurationIssue {
  readonly code: 'MissingMethod' | 'MissingValue' | 'UnsupportedConfiguration';
  /** Public member path only. Never includes a supplied value or exception text. */
  readonly path: string;
  readonly message: string;
}
export interface AccountConfigurationReport {
  readonly profile: 'sealed-owner-v1';
  readonly operation: AccountPreflightOperation;
  readonly status: 'configuration-incomplete' | 'runtime-validation-required';
  readonly issues: readonly AccountConfigurationIssue[];
  /** Always nonempty, even when every inspected member is configured. */
  readonly runtimeChecks: readonly string[];
}

const MANIFEST = '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f';
const OPERATIONS: readonly string[] = [
  'withdraw-unshielded',
  'withdraw-shielded',
  'issue-grant',
  'recover-pending-grants',
];

/** Data descriptors only: accessor-based adapters must expose explicit data/method members. */
function member(value: unknown, name: string): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function'))
    return undefined;
  try {
    let cursor: object | null = value;
    const seen = new Set<object>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const descriptor = Object.getOwnPropertyDescriptor(cursor, name);
      if (descriptor) return 'value' in descriptor ? descriptor.value : undefined;
      cursor = Object.getPrototypeOf(cursor) as object | null;
    }
  } catch {
    // Reflected objects must never expose their exception diagnostics in a report.
  }
  return undefined;
}
function at(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, name) => member(current, name), value);
}

/**
 * Inspects configured method presence and immutable network pins before opening a key session.
 * It does not authenticate adapters, load/verify binding bytes, read account/holdings/grants,
 * evaluate balances, test providers, prove, sponsor, submit or guarantee runtime success.
 * Fee sponsorship alone never establishes a value-bearing wallet route.
 */
export function inspectAccountConfiguration(
  ports: unknown,
  request: AccountPreflightRequest,
): AccountConfigurationReport {
  const issues: AccountConfigurationIssue[] = [];
  const add = (code: AccountConfigurationIssue['code'], path: string, message: string) =>
    issues.push(Object.freeze({ code, path, message }));
  const method = (path: string) => {
    if (typeof at(ports, path) !== 'function')
      add('MissingMethod', path, `Configure ${path} as a method for this sealed owner flow.`);
  };
  const text = (path: string) => {
    const value = at(ports, path);
    if (typeof value !== 'string' || value.trim().length === 0)
      add('MissingValue', path, `Configure a nonempty trusted ${path}.`);
  };
  if (!OPERATIONS.includes(request.operation))
    add(
      'UnsupportedConfiguration',
      'operation',
      'This preflight profile does not cover that operation.',
    );
  const scheme = at(ports, 'authoriser.scheme');
  if (scheme !== 'p256-webauthn' && scheme !== 'jubjub-schnorr')
    add(
      'UnsupportedConfiguration',
      'authoriser.scheme',
      'Use the P-256 or JubJub owner arm; k256 is experimental binding/artifacts only.',
    );
  if (at(ports, 'network.bindingId') !== 'acc-s3r1.1')
    add('UnsupportedConfiguration', 'network.bindingId', 'This profile covers only acc-s3r1.1.');
  if (at(ports, 'network.manifestSha256') !== MANIFEST)
    add(
      'UnsupportedConfiguration',
      'network.manifestSha256',
      'Configure the immutable acc-s3r1.1 compiler manifest pin.',
    );
  text('network.networkId');
  for (const path of [
    'credentials.identify',
    'authoriser.devicePublicKey',
    'authoriser.devicePublicKeyHex',
    'authoriser.authorise',
    'authoriser.withKeySession',
    'viewingKey.openInbox',
  ])
    method(path);
  if (scheme === 'p256-webauthn') method('authoriser.deviceBinding');
  if (
    scheme === 'jubjub-schnorr' ||
    (request.operation === 'issue-grant' && request.grantRead === true)
  )
    method('viewingKey.readerPublicKey');
  if (scheme === 'jubjub-schnorr') {
    method('directory.get');
    method('directory.put');
  }
  const binding = at(ports, 'binding');
  if (typeof binding !== 'function' && (binding === null || typeof binding !== 'object'))
    add(
      'MissingValue',
      'binding',
      'Configure a binding object or lazy loader; bytes and pure helpers remain runtime checks.',
    );
  if (typeof at(ports, 'chain') !== 'function') {
    method('chain.readAccount');
    method('chain.call');
  }
  if (request.operation === 'withdraw-shielded') {
    method('holdings.selectQualifiedHeldCoins');
  }
  if (request.operation === 'issue-grant' || request.operation === 'recover-pending-grants') {
    for (const path of [
      'records.read',
      'records.write',
      'grants.readActiveGrantIds',
      'grantCommitments.readGrantCommitment',
      'grantJournal.load',
      'grantJournal.markPublished',
      'viewingKey.sealGrant',
    ])
      method(path);
    if (scheme === 'jubjub-schnorr' || request.operation === 'issue-grant')
      method('records.exists');
    if (request.operation === 'recover-pending-grants') {
      method('grantJournal.pending');
      // Pending enumeration can return read grants; do not inspect private staged records here.
      method('viewingKey.sealView');
    } else {
      method('grantJournal.stage');
      method('grants.readActiveGrantSnapshot');
      text('grantOrigin');
      if (typeof request.grantRead !== 'boolean')
        add('MissingValue', 'grantRead', 'Choose read or non-read grant issue explicitly.');
      if (request.grantRead === true) {
        for (const path of [
          'holdings.selectHeldEntries',
          'readGrants.readActiveReadGrantTargets',
          'viewingKey.reencryptInbox',
          'viewingKey.sealView',
          'viewingKey.createKeys',
          'viewingKey.sealToDevice',
          'viewingKey.decodeDevicePublicKey',
          'viewingKey.decodeP256DevicePublicKey',
        ])
          method(path);
      }
    }
  }
  return Object.freeze({
    profile: 'sealed-owner-v1',
    operation: request.operation,
    status: issues.length ? 'configuration-incomplete' : 'runtime-validation-required',
    issues: Object.freeze(issues),
    runtimeChecks: Object.freeze([
      'Verify installed binding bytes, pure helpers, key-service profile and service/network pins.',
      'Open the existing active sealed account; authenticate its live device and key envelopes with the intended key origin and consent.',
      'Check live nonce, balances, grant openings/rosters, holdings and any required reader deliveries.',
      'Verify proving, fee sponsorship, submission, finality and recipient observation in the target environment.',
      'Fee sponsorship does not supply sender assets. Deposits require a separately qualified value-bearing wallet route.',
      ...(request.operation === 'withdraw-shielded'
        ? ['Require an exact-value qualified coin; partial spends and change are unsupported.']
        : []),
    ]),
  });
}
