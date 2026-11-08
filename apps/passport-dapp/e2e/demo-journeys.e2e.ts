// Real Chromium UI and synthetic credentials; connector, wallet and chain deliberately mocked.
// Own ephemeral Vite server; localhost:5173 requests are intercepted, never sent to a user's demo.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { globSync, readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium, type BrowserContext } from 'playwright-core';
import { journeyArms } from './journey-arms.js';
import { journeyTiming } from './journey-timing.js';
import { journeySelection, journeyGroups, journeyCatalog } from './journeys/catalog.mjs';
import { createJourneyHarness } from './journeys/harness.js';
import { caseRecorder, type CaseAttestation } from './journeys/recording.js';
import { executeGroups, type GroupTiming } from './journeys/execution.js';
import { collectPurposes } from './journeys/observations.js';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const selectedArms = journeyArms(process.env.PASSPORT_DEMO_JOURNEY_ARM);
const selectedGroup = journeySelection(
  process.env.PASSPORT_DEMO_JOURNEY_ARM,
  process.env.PASSPORT_DEMO_JOURNEY_GROUP,
);
const selectedGroups = selectedGroup ? [selectedGroup] : journeyGroups;
const caseInventorySha256 = createHash('sha256')
  .update(JSON.stringify(journeyCatalog))
  .digest('hex');
const caseAttestations: CaseAttestation[] = [];
const groupTimings: Record<string, GroupTiming[]> = {};
const manifest = '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f';
const output =
  process.env.PASSPORT_DEMO_JOURNEY_OUTPUT ??
  resolve(appRoot, '../../review', `demo-journeys-${Date.now()}.json`);
const cases: { arm: string; name: string }[] = [];
const failures: string[] = [];
const pageErrors: string[] = [];
const credentialFailureCodes: string[] = [];
const ceremonyPurposesByArm: Record<string, string[]> = {};
const archivedPurposes: Record<string, string[]> = {};
const closingContexts = new WeakSet<BrowserContext>();
const repoRoot = resolve(appRoot, '../..');
const started = Date.now();
const timing = journeyTiming();
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim();
const dirty =
  execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).length > 0;
const runtimeIdentity = () => {
  const files = [
    ...globSync(
      [
        'apps/passport-dapp/src/**/*.{ts,css}',
        'apps/passport-dapp/e2e/**/*.{ts,mjs,json,mts}',
        'apps/passport-dapp/index.html',
        'apps/passport-dapp/examples/**/*.html',
        'apps/passport-dapp/vite.config.ts',
        'packages/*/dist/**/*.js',
        'packages/*/package.json',
        'packages/contract/generated/acc-s3r1.1/*.js',
        'packages/contract/resources/acc-s3r1.1.capabilities.json',
        'pnpm-lock.yaml',
        'node_modules/.pnpm/react@*/node_modules/react/**/*.js',
        'node_modules/.pnpm/react-dom@*/node_modules/react-dom/**/*.js',
        'node_modules/.pnpm/scheduler@*/node_modules/scheduler/**/*.js',
      ],
      { cwd: repoRoot },
    ),
  ].sort();
  return createHash('sha256')
    .update(
      JSON.stringify(
        files.map((file) => [
          file,
          createHash('sha256')
            .update(readFileSync(resolve(repoRoot, file)))
            .digest('hex'),
        ]),
      ),
    )
    .digest('hex');
};
const initialRuntimeIdentity = runtimeIdentity();
const replacements: Record<string, string> = {
  '/src/connector.ts': 'demo-connector.ts',
  '/src/wallet/dev-wallet.ts': 'demo-wallet.ts',
  '/src/grant-holder-demo.ts': 'demo-holder.ts',
};
const savedPin = process.env.PASSPORT_MANIFEST_SHA256;
process.env.PASSPORT_MANIFEST_SHA256 = manifest;
let ownedCache: string | undefined;
let server: Awaited<ReturnType<typeof createServer>> | undefined;
const serverOptions: Parameters<typeof createServer>[0] = {
  root: appRoot,
  configFile: resolve(appRoot, 'vite.config.ts'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
  plugins: [
    {
      name: 'isolated-demo-journey-fixtures',
      enforce: 'pre',
      async load(id) {
        for (const [suffix, fixture] of Object.entries(replacements)) {
          if (id.split('?')[0] === resolve(appRoot, `.${suffix}`))
            return (await readFile(resolve(appRoot, 'e2e/fixtures', fixture), 'utf8')).replaceAll(
              "'../../src/",
              "'/src/",
            );
        }
        return null;
      },
    },
  ],
};
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let browserVersion: string | undefined;
let outcome = 'failed';
try {
  ownedCache = await mkdtemp(resolve(tmpdir(), 'passport-demo-vite-'));
  server = await createServer({ ...serverOptions, cacheDir: ownedCache });
  await server.listen();
  const listener = server.httpServer?.address();
  assert.ok(listener && typeof listener !== 'string');
  const base = `http://127.0.0.1:${listener.port}`;
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    ...(process.env.CHROME_BIN && { executablePath: process.env.CHROME_BIN }),
  });
  browserVersion = browser.version();
  timing.finishSetup();
  for (const arm of selectedArms) {
    timing.beginArm(arm);
    let complete = false;
    const recorder = caseRecorder(arm, selectedGroup, timing, cases, caseAttestations);
    const h = createJourneyHarness(
      browser,
      base,
      arm,
      { failures, pageErrors, credentialFailureCodes, archivedPurposes, closingContexts },
      timing,
      recorder.done,
    );
    try {
      const observedGroups: GroupTiming[] = [];
      groupTimings[arm] = observedGroups;
      await executeGroups(h, selectedGroup, recorder.begin, timing.boundary, observedGroups);
      recorder.complete();
      ceremonyPurposesByArm[arm] = await collectPurposes(h, selectedGroup);
      complete = true;
    } finally {
      timing.beginArmCleanup();
      try {
        for (const context of h.contexts) {
          closingContexts.add(context);
          await context.close();
        }
      } finally {
        timing.endArm(complete);
      }
    }
  }
  assert.equal(
    runtimeIdentity(),
    initialRuntimeIdentity,
    'runtime inputs changed during qualification',
  );
  outcome = 'passed';
} finally {
  timing.beginCleanup();
  const cleanup: Record<string, string> = {};
  const close = async (name: string, present: boolean, operation: () => Promise<unknown>) => {
    if (!present) {
      cleanup[name] = 'not-created';
      return;
    }
    try {
      await operation();
      cleanup[name] = 'closed';
    } catch {
      cleanup[name] = 'failed';
      outcome = 'failed';
    }
  };
  await close('browser', !!browser, async () => browser?.close());
  await close('server', !!server, async () => server?.close());
  await close(
    'ownedCache',
    !!ownedCache,
    async () => ownedCache && rm(ownedCache, { recursive: true, force: true }),
  );
  const resourcesClosed = Object.values(cleanup).every((status) => status !== 'failed');
  if (savedPin === undefined) delete process.env.PASSPORT_MANIFEST_SHA256;
  else process.env.PASSPORT_MANIFEST_SHA256 = savedPin;
  timing.finishCleanup();
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        schemaVersion: 1,
        outcome,
        tier: 'browser-ui-synthetic-connector',
        binding: 'acc-s3r1.1',
        manifestSha256: manifest,
        sourceCommit,
        dirty,
        nodeVersion: process.version,
        browserVersion,
        runtimeSha256: initialRuntimeIdentity,
        elapsedMs: Date.now() - started,
        timings: timing.snapshot(),
        cases,
        selectedArms,
        selectedGroups,
        caseInventorySha256,
        caseAttestations,
        groupTimings,
        credentialFailureCodes,
        failures,
        pageErrors,
        ceremonyPurposesByArm,
        actual: [
          'Chromium DOM/actions',
          'mock WebAuthn credential API',
          'ceremony hooks',
          'handoff parsing',
          'capability/proof planner',
          'PRF-derived bounded session controller and generated JubJub signature/holder guards',
          'shared-origin Web Locks and independent public intent records across real tabs',
        ],
        simulated: ['account API', 'chain', 'funding', 'grant settlement', 'wallet balances'],
        nativeProofs: false,
        realProvider: false,
        resourcesClosed,
        cleanup,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(`Demo journey receipt: ${output}`);
  if (!resourcesClosed)
    throw new Error('Demo journey resource cleanup failed; inspect its receipt.');
}
