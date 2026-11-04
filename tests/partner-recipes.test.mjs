import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ts from 'typescript';
import { ACC_CAPABILITIES } from '../packages/contract/dist/capabilities.js';
const exec = promisify(execFile);
const repository = resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(join(tmpdir(), 'passport-public-recipes-'));
/** @type {Record<string,string[]>} */ const paths = {};
/** @type {Record<string,string>} */ const runtime = {};
for (const directory of [
  'account',
  'protocol',
  'keys',
  'contract',
  'service',
  'adapter-webauthn',
  'adapter-service',
  'adapter-midnight-js',
  'adapter-browser',
]) {
  const folder = join(repository, 'packages', directory),
    pkg = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
  for (const [subpath, entry] of Object.entries(pkg.exports)) {
    const name = pkg.name + (subpath === '.' ? '' : subpath.slice(1));
    if (typeof entry === 'object' && entry && 'types' in entry && 'default' in entry) {
      paths[name] = [resolve(folder, String(entry.types))];
      runtime[name] = pathToFileURL(resolve(folder, String(entry.default))).href;
    }
  }
}
const resolver = join(scratch, 'resolve-public.mjs');
writeFileSync(
  resolver,
  `import {registerHooks} from 'node:module';const paths=${JSON.stringify(runtime)};registerHooks({resolve(name,context,next){if(process.env.PASSPORT_RECIPE_LIGHTWEIGHT==='1' && name.includes('compact-runtime'))throw Error('heavy runtime forbidden');if(Object.hasOwn(paths,name))return{url:paths[name],shortCircuit:true};return next(name,context);}});`,
);
const cleanEnv = { ...process.env };
delete cleanEnv.NODE_OPTIONS;
delete cleanEnv.NODE_PATH;
delete cleanEnv.NODE_TEST_CONTEXT;
const cli = join(repository, 'examples/host-preflight/check-key-endpoint.mjs');

/** @param {string[]} args */
async function runCli(args) {
  try {
    const result = await exec(process.execPath, ['--import', resolver, cli, ...args], {
      timeout: 10000,
      maxBuffer: 131072,
      env: { ...cleanEnv, PASSPORT_RECIPE_LIGHTWEIGHT: '1' },
    });
    return { code: 0, result: JSON.parse(result.stdout) };
  } catch (error) {
    const failure = /** @type {Error & {code:number,stdout:string}} */ (error);
    return { code: failure.code, result: JSON.parse(failure.stdout) };
  }
}

test('public-import host and journal examples compile strictly and emitted recipe executes', async () => {
  const program = ts.createProgram(
    [
      join(repository, 'examples/host-preflight/inspect.ts'),
      join(repository, 'examples/shielded-deposit-session/approved-deposit.ts'),
      join(repository, 'examples/shielded-deposit-review/reviewed-deposit.ts'),
    ],
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      skipLibCheck: true,
      paths,
      rootDir: join(repository, 'examples'),
      outDir: join(scratch, 'compiled'),
      types: ['node'],
      typeRoots: [join(repository, 'node_modules/@types')],
    },
  );
  const errors = ts.getPreEmitDiagnostics(program);
  assert.equal(
    errors.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: (p) => p,
      getCurrentDirectory: () => repository,
      getNewLine: () => '\n',
    }),
  );
  assert.equal(program.emit().emitSkipped, false);
  writeFileSync(join(scratch, 'compiled/package.json'), '{"type":"module"}');
  const reviewed = await exec(
    process.execPath,
    ['--import', resolver, '--test', join(repository, 'tests/fixtures/reviewed-deposit-cases.mjs')],
    {
      timeout: 30000,
      maxBuffer: 131072,
      env: {
        ...cleanEnv,
        PASSPORT_REVIEWED_RECIPE: join(
          scratch,
          'compiled/shielded-deposit-review/reviewed-deposit.js',
        ),
      },
    },
  );
  assert.match(reviewed.stdout, /# tests 22/);
  assert.match(reviewed.stdout, /# fail 0/);

  const result = await exec(
    process.execPath,
    [
      '--import',
      resolver,
      join(repository, 'tests/fixtures/partner-recipe-runner.mjs'),
      join(scratch, 'compiled/shielded-deposit-session/approved-deposit.js'),
      join(scratch, 'compiled/host-preflight/inspect.js'),
    ],
    { timeout: 10000, env: cleanEnv },
  );
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.senderEffects, 1);
  assert.deepEqual(receipt.prfAssertionsPerOperation, [1, 1]);
  assert.equal(receipt.native, false);
});

test('metadata CLI checks coverage, bounds malformed responses and never loads Compact or asks for credentials', async () => {
  const proofs = ACC_CAPABILITIES.circuits.filter((c) => c.kind === 'proof').map((c) => c.name);
  /** @type {string[]} */ const requests = [];
  let mode = 'complete';
  const server = createServer((req, res) => {
    requests.push(req.url ?? '');
    res.setHeader('content-type', 'application/json');
    if (mode === 'large') {
      res.end('x'.repeat(262145));
      return;
    }
    if (mode === 'invalid') {
      res.end('{private diagnostic');
      return;
    }
    if (mode === 'redirect') {
      res.writeHead(302, { location: '/elsewhere' }).end();
      return;
    }
    res.end(
      JSON.stringify(
        req.url === '/v1/profile'
          ? { name: 'all', circuits: mode === 'missing' ? [] : proofs, verifierCircuits: proofs }
          : {
              bindingId: ACC_CAPABILITIES.binding.id,
              compilerManifestSha256: ACC_CAPABILITIES.binding.compilerManifestSha256,
            },
      ),
    );
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const good = await runCli([base, 'jubjub-schnorr', 'withdraw-unshielded']);
    assert.equal(good.code, 0);
    assert.equal(good.result.coverage.evidence, 'advertised-metadata-only');
    mode = 'missing';
    const missing = await runCli([base, 'p256-webauthn', 'withdraw-shielded']);
    assert.equal(missing.code, 2);
    assert.equal(missing.result.coverage.issues[0].code, 'MissingProver');
    for (mode of ['invalid', 'large', 'redirect']) {
      const result = await runCli([base, 'jubjub-schnorr', 'issue-grant', 'read']);
      assert.equal(result.code, 1);
      assert.equal(result.result.code, 'KeyMetadataUnavailable');
      assert.equal(JSON.stringify(result.result).includes('private diagnostic'), false);
    }
    assert.ok(requests.every((p) => p === '/v1/profile' || p === '/v1/manifest'));
    const before = requests.length;
    for (const args of [
      [base, 'k256-ecdsa', 'withdraw-unshielded'],
      [base, 'jubjub-schnorr', 'issue-grant'],
      [base + '?token=private', 'jubjub-schnorr', 'withdraw-unshielded'],
    ])
      assert.equal((await runCli(args)).code, 3);
    assert.equal(requests.length, before);
  } finally {
    server.closeAllConnections();
    await new Promise((r, j) => server.close((e) => (e ? j(e) : r(undefined))));
  }
});

test.after(() => rmSync(scratch, { recursive: true, force: true }));
