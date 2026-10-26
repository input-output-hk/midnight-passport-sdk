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
    command: [node, '--test', '--test-reporter=tap', 'tests/contract-entry-semantics.test.mjs'],
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
      '--test-reporter=tap',
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
  'consumer-source-types': {
    tier: 'packed-consumer',
    command: [node, 'scripts/smoke-lace-source-consumer.mjs'],
    requires: ['LACE_CHECKOUT', 'LACE_SOURCE_REVISION', 'RELEASE_VERSION', 'RELEASE_TARBALL_DIR'],
    timeoutMs: 5 * 60000,
    establishes:
      'Explicit clean authorised source, generated ACC hashes and packed SDK types/runtime identity; no hosted flow claim.',
  },
  'consumer-published-host': {
    tier: 'published-consumer',
    command: [node, 'scripts/smoke-lace-published-consumer.mjs'],
    requires: ['CONSUMER_ROOT', 'LACE_PACKAGE_VERSION', 'RELEASE_VERSION'],
    timeoutMs: 3 * 60000,
    establishes:
      'Installed host entrypoints, SDK versions, declarations, physical runtime identity and WASM browser build; registry provenance is checked separately.',
  },
  'outage-reconciliation': {
    tier: 'proof-localnet',
    command: [node, 'scripts/qualification/live-outages.mjs'],
    requires: [
      'PASSPORT_RC_LOCALNET',
      'MN_NETWORK_ID',
      'PASSPORT_CONTRACT_DIR',
      'PASSPORT_LIVE_ROOT',
    ],
    timeoutMs: 90 * 60000,
    establishes:
      'Dedicated-stack source deployment/create/rotation with software identities, actual proofs, host process death and indexer outages; not the full release or real-provider suite.',
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
  outages: ['outage-reconciliation'],
  consumer: ['packed-consumer'],
  'consumer-source': ['consumer-source-types'],
  'consumer-published': ['consumer-published-host'],
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
