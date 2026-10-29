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
  'installed-consumer-interruptions': {
    tier: 'packed-consumer',
    command: [node, 'scripts/qualify-installed-consumer.mjs', 'run'],
    requires: ['CONSUMER_ROOT'],
    timeoutMs: 3 * 60000,
    establishes:
      'Prepared nine-tarball consumer: exact installed files, frozen offline lock/runtime identity, both-arm real HTTP and killed-process original-ID recovery with synthetic drivers. Not registry, native proof, real-provider or full Lace acceptance.',
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
  'combined-grants-holdings-prover': {
    tier: 'proof-localnet',
    command: [node, 'scripts/qualification/live-combined.mjs'],
    requires: [
      'PASSPORT_RC_LOCALNET',
      'MN_NETWORK_ID',
      'PASSPORT_CONTRACT_DIR',
      'PASSPORT_LIVE_ROOT',
    ],
    timeoutMs: 90 * 60000,
    establishes:
      'Both software authoriser arms: populated chain-verified shielded holding and active read grant, restart continuation, committed-deploy prover recovery and safe refusal after owner pre-registration proving failure. Not real-provider or full release acceptance.',
  },
  'survivor-outages-native': {
    tier: 'proof-localnet',
    command: [node, 'scripts/qualification/live-survivor-outages.mjs'],
    requires: [
      'PASSPORT_RC_LOCALNET',
      'MN_NETWORK_ID',
      'PASSPORT_CONTRACT_DIR',
      'PASSPORT_LIVE_ROOT',
    ],
    timeoutMs: 180 * 60000,
    establishes:
      'Both software authoriser scope: populated survivor lifecycle with original deployment prover recovery, post-submit process/indexer interruption and exact error/refusal after owner pre-registration proving outage. No wallet/provider/full release acceptance.',
  },
  'survivor-outages-jubjub-native': {
    tier: 'proof-localnet',
    command: [node, 'scripts/qualification/live-survivor-outages-jubjub.mjs'],
    requires: [
      'PASSPORT_RC_LOCALNET',
      'MN_NETWORK_ID',
      'PASSPORT_CONTRACT_DIR',
      'PASSPORT_LIVE_ROOT',
    ],
    timeoutMs: 100 * 60000,
    establishes:
      'JubJub-only software authoriser scope: populated survivor lifecycle with original deployment prover recovery, post-submit process/indexer interruption and exact error/refusal after owner pre-registration proving outage. No wallet/provider/full release acceptance.',
  },
  'survivor-outages-p256-native': {
    tier: 'proof-localnet',
    command: [node, 'scripts/qualification/live-survivor-outages-p256.mjs'],
    requires: [
      'PASSPORT_RC_LOCALNET',
      'MN_NETWORK_ID',
      'PASSPORT_CONTRACT_DIR',
      'PASSPORT_LIVE_ROOT',
    ],
    timeoutMs: 100 * 60000,
    establishes:
      'P-256-only software authoriser scope: populated survivor lifecycle with original deployment prover recovery, post-submit process/indexer interruption and exact error/refusal after owner pre-registration proving outage. No wallet/provider/full release acceptance.',
  },
  'survivor-enrollment-removal-wallet': {
    tier: 'proof-localnet',
    command: [node, 'scripts/qualification/live-lifecycle.mjs'],
    requires: [
      'PASSPORT_RC_LOCALNET',
      'MN_NETWORK_ID',
      'PASSPORT_CONTRACT_DIR',
      'PASSPORT_LIVE_ROOT',
    ],
    timeoutMs: 120 * 60000,
    establishes:
      'Both software crypto arms: independent enrolled survivor and target with active grant/holding, original-ID enrollment/removal continuations after host/indexer faults, survivor authorization, removed-reader refusal, then real built-in wallet socket reconnect and fresh NIGHT credit. No real-provider or full release acceptance.',
  },
  'removed-access-recheck': {
    tier: 'proof-localnet',
    command: [node, 'scripts/qualification/live-removed-recheck.mjs'],
    requires: [
      'PASSPORT_RC_LOCALNET',
      'MN_NETWORK_ID',
      'PASSPORT_CONTRACT_DIR',
      'PASSPORT_LIVE_ROOT',
      'PASSPORT_SURVIVOR_FIXTURE_ROOT',
    ],
    timeoutMs: 15 * 60000,
    establishes:
      'Current-source read-only removed-access recheck on private copies of accepted software lifecycle fixtures, with a reachable host, effect-attempt guards and exact no-current-key refusal. No historical mutations replayed and no new proof-generation claim.',
  },
  'grant-recovery-generated': {
    tier: 'contract-simulator',
    command: [
      node,
      '--test',
      '--test-reporter=tap',
      'tests/qualification-grant-recovery.test.mjs',
      'tests/grant-bookkeeping-recovery.test.mjs',
      'tests/keys-grant-record.test.mjs',
    ],
    requires: [],
    timeoutMs: 30000,
    establishes:
      'Both generated-contract software signature arms: separate empty profiles, authenticated original-reader reconstruction, independent-reader/missing/wrong-opening refusals, selective/all read revocation. Port fault and legacy record tests; no proofs or holdings qualification.',
  },
  'grant-recovery-native': {
    tier: 'proof-localnet',
    command: [node, 'scripts/qualification/live-grants.mjs'],
    requires: [
      'PASSPORT_RC_LOCALNET',
      'MN_NETWORK_ID',
      'PASSPORT_CONTRACT_DIR',
      'PASSPORT_LIVE_ROOT',
    ],
    timeoutMs: 120 * 60000,
    establishes:
      'Both software authoriser arms on the owned localnet: two independently readable grants, one qualified shielded holding, original-reader reconstruction in separate empty profiles, independent-reader refusal, rotation and selective/all native revocation. No private grantee key recovery, durable grant continuation, unaided grantee discovery or real-provider/full release acceptance.',
  },
  'grant-recovery-native-jubjub': {
    tier: 'proof-localnet',
    command: [node, 'scripts/qualification/live-grants-jubjub.mjs'],
    requires: [
      'PASSPORT_RC_LOCALNET',
      'MN_NETWORK_ID',
      'PASSPORT_CONTRACT_DIR',
      'PASSPORT_LIVE_ROOT',
    ],
    timeoutMs: 90 * 60000,
    establishes:
      'JubJub-only native grant profile-loss/rotation/revocation case with two read grants, an enrolled survivor and a qualified holding. Explicit single-arm scope; no P-256, provider, durable grant continuation or full release acceptance.',
  },
  'grant-recovery-native-p256': {
    tier: 'proof-localnet',
    command: [node, 'scripts/qualification/live-grants-p256.mjs'],
    requires: [
      'PASSPORT_RC_LOCALNET',
      'MN_NETWORK_ID',
      'PASSPORT_CONTRACT_DIR',
      'PASSPORT_LIVE_ROOT',
    ],
    timeoutMs: 90 * 60000,
    establishes:
      'P-256-only native grant profile-loss/rotation/revocation case with two read grants, an enrolled survivor and a qualified holding. Explicit single-arm scope; no JubJub, provider, durable grant continuation or full release acceptance.',
  },
  'wallet-indexer-reconnect': {
    tier: 'proof-localnet',
    command: [node, 'scripts/qualification/live-wallet.mjs'],
    requires: [
      'PASSPORT_RC_LOCALNET',
      'MN_NETWORK_ID',
      'PASSPORT_CONTRACT_DIR',
      'PASSPORT_LIVE_ROOT',
    ],
    timeoutMs: 20 * 60000,
    establishes:
      'Actual built-in read-only wallet in Node: socket close/reopen, fresh standalone NIGHT credit finalized while indexer is down, unchanged addresses/seed across stop/recreation. No browser or passkey-provider acceptance.',
  },
  'host-job-lifecycle-native': {
    tier: 'proof-localnet',
    command: [node, 'scripts/qualification/live-job-lifecycle.mjs'],
    requires: [
      'PASSPORT_RC_LOCALNET',
      'MN_NETWORK_ID',
      'PASSPORT_CONTRACT_DIR',
      'PASSPORT_LIVE_ROOT',
    ],
    timeoutMs: 180 * 60000,
    establishes:
      'Both software arms: job-backed enrollment/removal/survivor rotation with active caller-pinned read grant and qualified holding, original-ID native submit-loss recovery, removed-reader refusal and owner-key-source-pinned built-in wallet indexer reconnect. Standalone grant/value setup is separate; no provider/full-Lace/release acceptance.',
  },
  'host-job-lifecycle-image-native': {
    tier: 'proof-localnet',
    command: [node, 'scripts/qualification/live-job-lifecycle-image.mjs'],
    requires: [
      'PASSPORT_RC_LOCALNET',
      'MN_NETWORK_ID',
      'PASSPORT_CONTRACT_DIR',
      'PASSPORT_LIVE_ROOT',
      'PASSPORT_NATIVE_JOB_IMAGE',
      'PASSPORT_NATIVE_JOB_DEPS_VOLUME',
    ],
    timeoutMs: 180 * 60000,
    establishes:
      'Both software arms: actual Linux/arm64 production entrypoint and retained Linux journals, owner observation loss at confirmed original lifecycle results followed by container KILL/restart, grant/holding preservation and owner-pinned wallet reconnect. No image pre-submit kill, provider, full Lace or release acceptance.',
  },
  'host-jobs-native': {
    tier: 'proof-localnet',
    command: [node, 'scripts/qualification/live-host-jobs.mjs'],
    requires: [
      'PASSPORT_RC_LOCALNET',
      'MN_NETWORK_ID',
      'PASSPORT_CONTRACT_DIR',
      'PASSPORT_LIVE_ROOT',
    ],
    timeoutMs: 100 * 60000,
    establishes:
      'Fresh P-256/Jubjub software owner fixtures through actual host-job HTTP/native proofs; original deployment/call submit crashes, committed-plan prover outage, indexer unknown probes and pre-registration safe unknown. No provider/image/release qualification.',
  },
  'host-jobs-image-native': {
    tier: 'proof-localnet',
    command: [node, 'scripts/qualification/live-host-jobs-image.mjs'],
    requires: [
      'PASSPORT_RC_LOCALNET',
      'MN_NETWORK_ID',
      'PASSPORT_CONTRACT_DIR',
      'PASSPORT_LIVE_ROOT',
      'PASSPORT_NATIVE_JOB_IMAGE',
      'PASSPORT_NATIVE_JOB_DEPS_VOLUME',
    ],
    timeoutMs: 100 * 60000,
    establishes:
      'Local exact-source Linux/amd64 production service image, separate Linux reference dependencies and retained private state; both software owner arms through deployment/call container kill/restart. Durable dispatch claims and ledger inclusion, not instrumented send-attempt counts or released-image/provider qualification.',
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
  'host-job-lifecycle-native': ['host-job-lifecycle-native'],
  'host-job-lifecycle-image-native': ['host-job-lifecycle-image-native'],
  'host-jobs-native': ['host-jobs-native'],
  'host-jobs-image-native': ['host-jobs-image-native'],
  foundation: ['binding-source', 'contract-entries', 'reader-guards'],
  browser: ['virtual-authenticator'],
  localnet: ['localnet-night'],
  outages: ['outage-reconciliation'],
  'combined-outages': ['combined-grants-holdings-prover'],
  'survivor-reconnect': ['survivor-enrollment-removal-wallet'],
  'survivor-outages': ['survivor-outages-native'],
  'survivor-outages-jubjub': ['survivor-outages-jubjub-native'],
  'survivor-outages-p256': ['survivor-outages-p256-native'],
  'wallet-reconnect': ['wallet-indexer-reconnect'],
  'removed-recheck': ['removed-access-recheck'],
  'grant-recovery': ['grant-recovery-generated'],
  'grant-recovery-live': ['grant-recovery-native'],
  'grant-recovery-jubjub': ['grant-recovery-native-jubjub'],
  'grant-recovery-p256': ['grant-recovery-native-p256'],
  consumer: ['packed-consumer'],
  'consumer-installed': ['installed-consumer-interruptions'],
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
