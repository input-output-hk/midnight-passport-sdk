// Scope is explicit: a passing simulator test does not qualify recovery or a release.
const node = process.execPath;
export const SCENARIOS = Object.freeze({
  'binding-source': {
    tier: 'source-comparison',
    command: [node, 'scripts/qualification/run-binding-audit.mjs'],
    requires: ['PASSPORT_REPO'],
    timeoutMs: 15000,
    establishes: 'Exact production-source comparison; declaration surface only.',
  },
  'contract-entries': {
    tier: 'contract-simulator',
    command: [node, '--test', 'tests/contract-entry-semantics.test.mjs'],
    requires: [],
    timeoutMs: 20000,
    establishes:
      'Known pinned entry/removal/recovery behavior with software signatures; no proofs or node.',
  },
  'reader-guards': {
    tier: 'unit-port',
    command: [
      node,
      '--test',
      'tests/account-jubjub-readers.test.mjs',
      'tests/account-jubjub.test.mjs',
      'tests/account-p256-sealed.test.mjs',
      'tests/qualification-roster-boundary.test.mjs',
    ],
    requires: [],
    timeoutMs: 20000,
    establishes:
      'SDK roster/delivery refusals and sealed P-256 port composition; fake chain ports.',
  },
  'virtual-authenticator': {
    tier: 'virtual-browser',
    command: ['pnpm', '--filter', 'passport-dapp', 'virtual-authenticator'],
    requires: ['PASSPORT_SERVICE_URL'],
    timeoutMs: 60000,
    establishes: 'Synthetic browser authenticator preflight; no Google/iCloud qualification.',
  },
  'localnet-night': {
    tier: 'proof-localnet',
    command: [node, 'scripts/qualify-rc-localnet.mjs'],
    requires: [
      'PASSPORT_RC_LOCALNET',
      'MN_NETWORK_ID',
      'PASSPORT_SERVICE_URL',
      'PASSPORT_FUNDING_URL',
      'PASSPORT_FUNDING_TOKEN_FILE',
    ],
    timeoutMs: 15 * 60000,
    establishes:
      'Synthetic ACC deployment, confirmed NIGHT funding and same-ID replay; existing localnet only.',
  },
  'packed-consumer': {
    tier: 'packed-consumer',
    command: [node, 'scripts/smoke-release-tarballs.mjs'],
    requires: ['RELEASE_VERSION'],
    timeoutMs: 5 * 60000,
    establishes:
      'Existing packed tarball installation/types/runtime identity; not a registry install.',
  },
  'outage-reconciliation': {
    tier: 'proof-localnet',
    command: [],
    requires: [],
    timeoutMs: 0,
    establishes: 'Not implemented in the foundation; #231 owns interruption/outage scenarios.',
  },
  'published-registry': {
    tier: 'published-consumer',
    command: [],
    requires: [],
    timeoutMs: 0,
    establishes:
      'Not automated in this foundation; #236 owns authenticated actual-registry acceptance.',
  },
  'provider-qualification': {
    tier: 'manual-provider',
    command: [],
    requires: [],
    timeoutMs: 0,
    establishes: 'Requires separately recorded real-provider/two-browser evidence under #232.',
  },
});
export const SUITES = Object.freeze({
  foundation: ['binding-source', 'contract-entries', 'reader-guards'],
  browser: ['virtual-authenticator'],
  localnet: ['localnet-night'],
  consumer: ['packed-consumer'],
  release: [
    'binding-source',
    'contract-entries',
    'reader-guards',
    'virtual-authenticator',
    'localnet-night',
    'packed-consumer',
    'outage-reconciliation',
    'published-registry',
    'provider-qualification',
  ],
});
