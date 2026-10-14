#!/usr/bin/env node
// One-command local Passport demo: pin and prepare the ACC, then reuse the
// existing service runner so its startup order and cleanup stay authoritative.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binding = JSON.parse(
  readFileSync(join(root, 'packages/contract/acc-binding-v2.generated.json'), 'utf8'),
);
const revision = binding.source.revision;
const manifestPin = binding.manifestSha256;
const keyPort = 8788;
const fundingPort = 8789;

/** @typedef {{ command: string, keyService: boolean, funding: boolean, open: boolean, mockPasskey: boolean, passportRepo?: string, contractDir?: string, account?: string, color?: string, amount?: string, requestId?: string, help?: boolean }} DemoOptions */

/** @param {string[]} argv @returns {DemoOptions} */
export function parseArgs(argv) {
  const args = [...argv];
  const first = args[0];
  const command = first && !first.startsWith('-') ? (args.shift() ?? 'up') : 'up';
  if (!['up', 'setup', 'check', 'fund'].includes(command))
    throw new Error(`unknown command: ${command}`);
  /** @type {DemoOptions} */
  const options = { command, keyService: true, funding: false, open: false, mockPasskey: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--passport-repo' || arg === '--contract-dir') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a directory`);
      options[arg === '--passport-repo' ? 'passportRepo' : 'contractDir'] = resolve(value);
    } else if (
      arg === '--account' ||
      arg === '--color' ||
      arg === '--amount' ||
      arg === '--request-id'
    ) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      if (arg === '--account') options.account = value;
      else if (arg === '--color') options.color = value;
      else if (arg === '--amount') options.amount = value;
      else options.requestId = value;
    } else if (arg === '--no-key-service') options.keyService = false;
    else if (arg === '--funding') options.funding = true;
    else if (arg === '--open') options.open = true;
    else if (arg === '--mock-passkey') options.mockPasskey = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

const usage = `Usage: nix develop -c node scripts/demo.mjs [up|setup|check|fund] [options]

  up                 Prepare the pinned ACC, then start the key service,
                     localnet, sponsor/prover backend and browser page.
  setup              Prepare and verify the ACC without starting services.
  check              Check Nix, Docker memory and required local ports.
  fund               Deposit an allowlisted asset into a deployed ACC through
                     the running funding service; requires the four flags below.

  --passport-repo X  Local checkout of midnightntwrk/passport (or PASSPORT_REPO).
  --contract-dir X   Reuse a previously compiled ACC tree (or PASSPORT_CONTRACT_DIR).
  --no-key-service   Skip the optional standalone key server on port 8788.
  --funding          Start the separate funding service on port 8789 (localnet).
  --mock-passkey     Use the dev-only mock-passkey URL.
  --open             Open the demo URL in the default browser.
  --account HEX      Fund command: deployed ACC address (32 bytes).
  --color HEX        Fund command: allowlisted asset color (32 bytes).
  --amount N         Fund command: positive decimal amount.
  --request-id UUID  Fund command: stable idempotency key for retries.

Ctrl-C stops only the processes and localnet containers started by this run.
`;

/** @param {string} command @param {string[]} args @param {{ cwd?: string, env?: NodeJS.ProcessEnv, capture?: boolean }} [options] */
function run(command, args, { cwd = root, env = process.env, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
  return result.stdout ?? '';
}

/** @param {DemoOptions} options */
function preparedContract(options) {
  const explicit =
    options.contractDir ?? (options.passportRepo ? undefined : process.env.PASSPORT_CONTRACT_DIR);
  if (explicit) return resolve(explicit);
  const repo = options.passportRepo ?? process.env.PASSPORT_REPO;
  if (!repo) throw new Error('pass --passport-repo /path/to/passport (or set PASSPORT_REPO)');
  const output = run(join(root, 'experiments/acc-0.35/fetch-acc.sh'), [revision], {
    env: { ...process.env, PASSPORT_REPO: resolve(repo) },
    capture: true,
  });
  process.stdout.write(output);
  const dir = output.trim().split('\n').at(-1);
  if (!dir || !existsSync(dir)) throw new Error('ACC export did not return a contract directory');
  return resolve(dir);
}

/** @param {string} contractDir */
export function manifestStatus(contractDir) {
  const file = join(contractDir, 'contracts/managed/account/compiler/contract-manifest.json');
  if (!existsSync(file)) return 'missing';
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (actual !== manifestPin)
    throw new Error(`ACC manifest differs from the pinned ${binding.id} binding: ${actual}`);
  return 'pinned';
}

/** @param {DemoOptions} options */
function prepare(options) {
  run(join(root, 'experiments/acc-0.35/guard.sh'), []);
  const contractDir = preparedContract(options);
  if (manifestStatus(contractDir) === 'missing') {
    console.log('demo: compiling the pinned ACC and its keys (first run takes tens of minutes)');
    run(join(root, 'experiments/acc-0.35/compile.sh'), [contractDir, 'full']);
    if (manifestStatus(contractDir) !== 'pinned')
      throw new Error('ACC compilation produced no manifest');
  } else {
    console.log(`demo: reusing the pinned ACC at ${contractDir}`);
  }
  const artefactDir = join(contractDir, 'contracts/managed/account');
  const keyManifest = JSON.parse(
    readFileSync(join(artefactDir, 'compiler/contract-manifest.json'), 'utf8'),
  );
  const keyFiles = Object.entries(keyManifest.keys ?? {}).filter(([name]) =>
    name.endsWith('.prover'),
  );
  if (keyFiles.length !== binding.roster.length)
    throw new Error(`ACC key roster is incomplete (${keyFiles.length}/${binding.roster.length})`);
  console.log('demo: verifying the pinned key hashes and restoring any missing keys');
  run('node', [
    join(root, 'packages/contract/bin/restore-acc-keys.mjs'),
    '--binding',
    binding.id,
    '--source',
    artefactDir,
    '--output',
    join(artefactDir, 'keys'),
  ]);
  if (!existsSync(join(contractDir, 'node_modules'))) {
    console.log('demo: installing the reference client dependencies');
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: contractDir });
  }
  console.log('demo: installing and building the SDK');
  run('pnpm', ['install', '--frozen-lockfile']);
  run('pnpm', ['run', 'build']);
  return contractDir;
}

/** @param {number} port */
async function freePort(port) {
  await new Promise((resolveReady, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`port ${port} is occupied`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolveReady));
  });
}

/** @param {DemoOptions} options */
async function check(options) {
  run(join(root, 'experiments/acc-0.35/guard.sh'), []);
  const memory = Number(
    run('docker', ['info', '--format', '{{.MemTotal}}'], { capture: true }).trim(),
  );
  const minimum = Number(process.env.ACC_MIN_DOCKER_GIB ?? '24');
  if (!Number.isFinite(memory) || memory < minimum * 1024 ** 3)
    throw new Error(`Docker needs at least ${minimum} GiB for P-256 proofs`);
  run('bash', [join(root, 'scripts/prototype-up.sh'), '--check']);
  if (options.keyService) await freePort(keyPort);
  if (options.funding) {
    if ((process.env.MIDNIGHT_STACK ?? 'undeployed') !== 'undeployed')
      throw new Error('--funding currently requires the local undeployed stack');
    for (const name of ['PASSPORT_FUNDING_TOKEN_FILE', 'PASSPORT_FUNDING_ASSETS_FILE']) {
      if (!process.env[name] || !existsSync(process.env[name]))
        throw new Error(`--funding requires an existing ${name}`);
    }
    await freePort(fundingPort);
  }
  console.log('demo: toolchain, Docker memory and ports are ready');
}

/** @param {string} command @param {string[]} args @param {NodeJS.ProcessEnv} env */
function spawnOwned(command, args, env) {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', detached: true });
  child.on('error', (error) => console.error(`demo: ${command}: ${error.message}`));
  return child;
}

/** @param {import('node:child_process').ChildProcess | undefined} child */
function stopOwned(child) {
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already exited */
    }
  }
}

/** @param {import('node:child_process').ChildProcess} child */
async function waitForKeyService(child) {
  for (let attempt = 0; attempt < 900; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('key service exited before readiness');
    try {
      const response = await fetch(`http://127.0.0.1:${keyPort}/healthz`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      /* restoring or verifying keys */
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error('key service did not become ready within 15 minutes');
}

/** @param {import('node:child_process').ChildProcess} child */
async function waitForFundingService(child) {
  for (let attempt = 0; attempt < 180; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('funding service exited before readiness');
    try {
      const response = await fetch(`http://127.0.0.1:${fundingPort}/healthz`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      /* verifying keys or syncing the dedicated wallet */
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error('funding service did not become ready within 3 minutes');
}

/** @param {DemoOptions} options */
export async function fund(options) {
  if (!options.account || !/^[0-9a-f]{64}$/.test(options.account))
    throw new Error('fund needs --account as 32-byte lowercase hex');
  if (!options.color || !/^[0-9a-f]{64}$/.test(options.color))
    throw new Error('fund needs --color as 32-byte lowercase hex');
  if (!options.amount || !/^[1-9][0-9]*$/.test(options.amount))
    throw new Error('fund needs --amount as a positive decimal');
  if (
    !options.requestId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      options.requestId,
    )
  )
    throw new Error('fund needs --request-id as a lowercase UUID');
  const tokenFile = process.env.PASSPORT_FUNDING_TOKEN_FILE;
  if (!tokenFile) throw new Error('fund needs PASSPORT_FUNDING_TOKEN_FILE');
  const token = readFileSync(tokenFile, 'utf8').trim();
  const base = process.env.PASSPORT_FUNDING_URL ?? `http://127.0.0.1:${fundingPort}`;
  const endpoint = new URL(base);
  if (
    endpoint.protocol !== 'https:' &&
    !(
      endpoint.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
    )
  )
    throw new Error('PASSPORT_FUNDING_URL must use HTTPS or loopback HTTP');
  const health = await fetch(new URL('/healthz', endpoint), { signal: AbortSignal.timeout(5000) });
  if (!health.ok) throw new Error(`funding service is not ready (${health.status})`);
  const config = /** @type {{ networkId: string, bindingId: string, manifestSha256: string }} */ (
    await health.json()
  );
  if (config.bindingId !== binding.id || config.manifestSha256 !== manifestPin)
    throw new Error('funding service binding differs from the demo pin');
  const response = await fetch(new URL('/v1/faucet/fund', endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      requestId: options.requestId,
      networkId: config.networkId,
      bindingId: config.bindingId,
      manifestSha256: config.manifestSha256,
      accountAddress: options.account,
      color: options.color,
      amount: options.amount,
    }),
  });
  const result =
    /** @type {{ error?: string, requestId?: string, txId?: string, creditedBalance?: string }} */ (
      await response.json()
    );
  if (response.status !== 200)
    throw new Error(`funding refused (${response.status}): ${result.error ?? 'unknown'}`);
  if (result.requestId !== options.requestId || !result.txId || !result.creditedBalance)
    throw new Error('funding service returned an invalid confirmation');
  console.log(
    `demo: ACC ${options.account} credited to ${result.creditedBalance}; transaction ${result.txId}`,
  );
  return result;
}

/** @param {import('node:child_process').ChildProcess} child */
async function waitForPage(child) {
  for (let attempt = 0; attempt < 1800; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('demo stack exited before the page was ready');
    try {
      const response = await fetch('http://localhost:5173/', {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      /* localnet, service or page still starting */
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error('demo page did not become ready within 30 minutes');
}

/** @param {DemoOptions} options */
async function up(options) {
  await check(options);
  const contractDir = prepare(options);
  const artefactDir = join(contractDir, 'contracts/managed/account');
  const env = {
    ...process.env,
    PASSPORT_CONTRACT_DIR: contractDir,
    PASSPORT_MANIFEST_SHA256: manifestPin,
  };
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let keys;
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let prototype;
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let funding;
  const cleanup = () => {
    stopOwned(funding);
    stopOwned(prototype);
    stopOwned(keys);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  try {
    if (options.keyService) {
      console.log('demo: verifying the key cache and starting the key service');
      keys = spawnOwned('node', [join(root, 'apps/passport-key-service/src/main.mjs')], {
        ...env,
        PASSPORT_KEY_DIR: join(artefactDir, 'keys'),
        PASSPORT_KEY_HOST: '127.0.0.1',
        PASSPORT_KEY_PORT: String(keyPort),
      });
      await waitForKeyService(keys);
    }
    const url = `http://localhost:5173/${options.mockPasskey ? '?mockPasskey' : ''}`;
    console.log('demo: starting localnet, backend and page');
    if (options.keyService)
      console.log(`demo: standalone key service ready at http://127.0.0.1:${keyPort}`);
    const mainChild = spawnOwned('bash', [join(root, 'scripts/prototype-up.sh')], env);
    prototype = mainChild;
    await waitForPage(mainChild);
    if (options.funding) {
      console.log('demo: starting the dedicated ACC funding wallet');
      funding = spawnOwned('pnpm', ['prototype:funding-service'], env);
      await waitForFundingService(funding);
      console.log(`demo: funding service ready at http://127.0.0.1:${fundingPort}`);
    }
    console.log(`demo: ready at ${url}`);
    if (options.open) {
      const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
      // The page may need a few seconds; opening early lets the browser wait for Vite.
      const opened = spawn(opener, [url], { stdio: 'ignore', detached: true });
      opened.on('error', (error) =>
        console.error(`demo: could not open browser: ${error.message}`),
      );
      opened.unref();
    }
    const status = await new Promise((done) => {
      /** @param {number | null} code @param {NodeJS.Signals | null} signal */
      const exited = (code, signal) => done(signal ? 130 : (code ?? 1));
      mainChild.once('exit', exited);
      if (mainChild.exitCode !== null || mainChild.signalCode !== null)
        exited(mainChild.exitCode, mainChild.signalCode);
    });
    if (status !== 0 && status !== 130) process.exitCode = status;
  } finally {
    cleanup();
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    return;
  }
  if (options.command === 'check') await check(options);
  else if (options.command === 'setup') prepare(options);
  else if (options.command === 'fund') await fund(options);
  else await up(options);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`demo: ${error.message}`);
    process.exitCode = 1;
  });
}
