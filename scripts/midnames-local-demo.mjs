#!/usr/bin/env node
// Attach to the designated Ledger 9 stack, or start a separate Passport-owned
// project from the repo template. The browser demo never controls shared Docker.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statfsSync,
  statSync,
  unlinkSync,
  writeFileSync,
  closeSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lockDir = join(homedir(), '.local/share/midnight-passport');
const lockPath = join(lockDir, 'midnames-local-demo.lock');
const template = join(root, 'infra/localnet/docker-compose.ledger9.yml');
const compatTemplate = join(root, 'infra/localnet/docker-compose.compat-prover.yml');
const compatImage =
  'midnightntwrk/proof-server@sha256:2666c7bd7b4517f8ad135565387f98d14347a9ac715c6c466d4a8a852b545ecf';
const defaultProfile = join(
  root,
  'examples/midnames-local/evidence/shared-ledger9-paidfix-deposit-20261118.json',
);
const candidateManifest = JSON.parse(
  readFileSync(join(root, 'packages/contract/acc-versions.generated.json'), 'utf8'),
).versions['acc-s3r1.1-zkir036'].manifestSha256;
const usage = `Usage: nix develop -c node scripts/midnames-local-demo.mjs [check|stack|up|stop] [options]

  check               Read-only attach and name-to-ACC verification. Never starts Docker.
  stack               Attach, or start a separate Passport-owned Ledger 9 project.
  up                  Attach/start, verify the claim, then run the JubJub browser demo.
  stop                Stop only the recorded Passport-owned fallback project.

  --profile PATH      Public local-chain claim receipt (default: shipped paidfix receipt).
  --state-dir PATH    Private state directory (default: ~/.local/share/midnight-passport/local-demo).
  --passport-repo X   Passport architecture checkout for pinned ACC preparation.
  --contract-dir X    Reuse a prepared pinned ACC instead of --passport-repo.
  --attach-only       Refuse to start an owned stack when the shared stack is absent.
  --real-passkey      Use a PRF-capable passkey instead of the development mock.
  --setup             Open account creation without a name (fresh chain only).
  --claim             Enable registration against the verified local .night registry.
  --claim-journal-id X  Select a retained, isolated claim journal for this demo run.
  --funding           Enable deposits with the separately funded demo wallet.
  --night-send        Opt in to candidate ACC named NIGHT send (needs --claim --funding).
  --prepared-registry PATH  Pinned Compact 0.35 registry artifacts for --claim.
  --candidate-assets PATH   Explicit provisional ACC assets on the local release prover.
  --open              Open the page in the default browser after it is ready.

The fallback uses the repo's digest-pinned Ledger 9 Compose template and a
private credential file. It never starts or stops the owner's midnight-network
project. The stack command leaves a newly started project running for setup.
The up command stops only its own newly started containers on exit; all volumes
and private records are preserved.
`;

class CleanupUnconfirmedError extends Error {}

/** @typedef {{command: 'check'|'stack'|'up'|'stop', profile: string, stateDir: string, passportRepo: string|undefined, contractDir: string|undefined, preparedRegistry: string|undefined, candidateAssets: string|undefined, claimJournalId: string|undefined, attachOnly: boolean, mockPasskey: boolean, setup: boolean, claim: boolean, funding: boolean, nightSend: boolean, open: boolean, help: boolean}} DemoOptions */
/** @typedef {{command: string, args: string[], env: NodeJS.ProcessEnv}} ComposeTarget */
/** @typedef {{networkId: string, registryAddress: string, name: string, accountAddress: string, claimBlock: {height: number, hash: string}}} Claim */

/** @param {string[]} argv */
export function parseArgs(argv) {
  const args = [...argv];
  const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'up';
  if (!command || !['check', 'stack', 'up', 'stop'].includes(command))
    throw new Error(`Unknown command: ${command}`);
  /** @type {DemoOptions} */
  const result = {
    command: /** @type {DemoOptions['command']} */ (command),
    profile: defaultProfile,
    stateDir: join(homedir(), '.local/share/midnight-passport/local-demo'),
    passportRepo: process.env.PASSPORT_REPO,
    contractDir: process.env.PASSPORT_CONTRACT_DIR,
    preparedRegistry: process.env.PASSPORT_MIDNAMES_PREPARED_REGISTRY,
    candidateAssets: undefined,
    claimJournalId: undefined,
    attachOnly: false,
    mockPasskey: true,
    setup: false,
    claim: false,
    funding: false,
    nightSend: false,
    open: false,
    help: false,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (
      arg &&
      [
        '--profile',
        '--state-dir',
        '--passport-repo',
        '--contract-dir',
        '--prepared-registry',
        '--candidate-assets',
        '--claim-journal-id',
      ].includes(arg)
    ) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a path.`);
      if (arg === '--profile') result.profile = resolve(value);
      else if (arg === '--state-dir') result.stateDir = resolve(value);
      else if (arg === '--passport-repo') result.passportRepo = resolve(value);
      else if (arg === '--prepared-registry') result.preparedRegistry = resolve(value);
      else if (arg === '--candidate-assets') result.candidateAssets = resolve(value);
      else if (arg === '--claim-journal-id') {
        if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(value))
          throw new Error('--claim-journal-id needs a lowercase letters/digits/hyphens label.');
        result.claimJournalId = value;
      } else result.contractDir = resolve(value);
    } else if (arg === '--attach-only') result.attachOnly = true;
    else if (arg === '--real-passkey') result.mockPasskey = false;
    else if (arg === '--setup') result.setup = true;
    else if (arg === '--claim') result.claim = true;
    else if (arg === '--funding') result.funding = true;
    else if (arg === '--night-send') result.nightSend = true;
    else if (arg === '--open') result.open = true;
    else if (arg === '--help' || arg === '-h') result.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return result;
}

/** @param {DemoOptions} options */
export function claimJournalDirectory(options) {
  const profile = options.candidateAssets ? 'candidate' : 'stable';
  const name = options.claimJournalId
    ? `claim-journal-${profile}-${options.claimJournalId}`
    : profile === 'candidate'
      ? 'claim-journal-candidate'
      : 'claim-journal';
  return join(options.stateDir, name);
}

/** @param {string} command @param {string[]} args @param {{env?: NodeJS.ProcessEnv, timeout?: number}} [options] */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: options.env ?? process.env,
    encoding: 'utf8',
    timeout: options.timeout ?? 20_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const detail = result.stderr?.trim() || result.error?.message || `exit ${result.status}`;
    throw new Error(`${command} ${args[0] ?? ''}: ${detail}`);
  }
  return result.stdout.trim();
}

/** @param {string} path */
function privateState(path) {
  assert.ok(isAbsolute(path) && !path.startsWith(`${root}/`), 'Keep demo state outside Git.');
  mkdirSync(path, { recursive: true, mode: 0o700 });
  assert.equal(realpathSync(path), path, 'Use a canonical private state path.');
  const stat = statSync(path);
  assert.ok(stat.isDirectory() && (stat.mode & 0o077) === 0, 'State must be mode 0700.');
  if (process.getuid) assert.equal(stat.uid, process.getuid(), 'State owner differs.');
}

/** @param {string} path @param {string} content */
function privateFile(path, content) {
  if (existsSync(path)) {
    const stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
    assert.equal(stat.mode & 0o077, 0, 'Private file has loose permissions.');
    return;
  }
  const file = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(file, content);
  } finally {
    closeSync(file);
  }
}

function lockLauncher() {
  privateState(lockDir);
  const path = lockPath;
  let fd;
  try {
    fd = openSync(path, 'wx', 0o600);
    writeFileSync(
      fd,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n',
    );
    fsyncSync(fd);
  } catch (error) {
    if (fd !== undefined) {
      closeSync(fd);
      unlinkSync(path);
    }
    throw new Error(
      `Another demo launcher is active, or ${path} needs reconciliation after an interrupted run: ${String(error)}`,
    );
  }
  const owned = fstatSync(fd);
  return () => {
    const current = lstatSync(path);
    assert.ok(current.isFile() && current.dev === owned.dev && current.ino === owned.ino);
    unlinkSync(path);
    closeSync(fd);
  };
}

/** @param {string} stateDir */
function ownedProject(stateDir) {
  const suffix = createHash('sha256').update(stateDir).digest('hex').slice(0, 8);
  return `midnight-passport-ledger9-demo-${suffix}`;
}

/** @param {string} project @param {boolean} [all] */
function projectContainerIds(project, all = true) {
  const output = run('docker', [
    'ps',
    ...(all ? ['-a'] : []),
    '--no-trunc',
    '--filter',
    `label=com.docker.compose.project=${project}`,
    '--format',
    '{{.ID}}',
  ]);
  const ids = output ? output.split('\n').sort() : [];
  for (const id of ids) assert.match(id, /^[a-f0-9]{64}$/);
  return ids;
}

/** @param {string} marker @param {string} project @param {string[]} containerIds @param {string} [sourceTemplate] */
function recordContainers(marker, project, containerIds, sourceTemplate = template) {
  const current = lstatSync(marker);
  assert.ok(current.isFile() && !current.isSymbolicLink() && (current.mode & 0o077) === 0);
  const temp = `${marker}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeFileSync(
      fd,
      JSON.stringify(
        { schemaVersion: 2, project, template: sourceTemplate, containerIds },
        null,
        2,
      ) + '\n',
    );
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, marker);
  const directory = openSync(dirname(marker), 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

/** @param {string} project @param {string[]} containerIds */
function stopRecordedContainers(project, containerIds) {
  try {
    assert.deepEqual(projectContainerIds(project), containerIds, 'Owned container IDs changed.');
    const running = projectContainerIds(project, false);
    for (const id of running) {
      assert.ok(containerIds.includes(id), 'Unrecorded container is running.');
      run('docker', ['stop', id], { timeout: 60_000 });
    }
    assert.deepEqual(projectContainerIds(project, false), [], 'Owned containers remain running.');
    assert.deepEqual(projectContainerIds(project), containerIds, 'Owned container IDs changed.');
  } catch (error) {
    throw new CleanupUnconfirmedError(
      `Could not confirm all recorded containers stopped for ${project}: ${String(error)}`,
    );
  }
}

/** @param {number} port */
async function freePort(port) {
  await new Promise((done, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is occupied; inspect its owner.`)));
    server.listen(port, '127.0.0.1', () => server.close(done));
  });
}

function attach() {
  return JSON.parse(run('bash', [join(root, 'scripts/midnight-attach.sh')], { timeout: 18_000 }));
}

/** @param {string} project @param {string} file @param {NodeJS.ProcessEnv} env */
function compose(project, file, env) {
  return {
    command: 'docker',
    args: ['compose', '-p', project, '-f', file],
    env,
  };
}

/** @param {ComposeTarget} target @param {string[]} args @param {number} [timeout] */
function composeRun(target, args, timeout = 180_000) {
  return run(target.command, [...target.args, ...args], { env: target.env, timeout });
}

/** @param {DemoOptions} options */
async function stack(options) {
  try {
    const profile = attach();
    console.log('midnames-demo: attached to the existing Ledger 9 stack; Docker unchanged.');
    return { profile, started: false };
  } catch (error) {
    if (options.command === 'check' || options.attachOnly) throw error;
    console.error(
      `midnames-demo: attach unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const port of [9944, 8088, 6300]) await freePort(port);
  const memory = Number(run('docker', ['info', '--format', '{{.MemTotal}}'], { timeout: 12_000 }));
  assert.ok(memory >= 24 * 1024 ** 3, 'Docker needs at least 24 GiB for ACC proving.');
  privateState(options.stateDir);
  const project = ownedProject(options.stateDir);
  const marker = join(options.stateDir, 'owned-stack.json');
  privateFile(
    marker,
    JSON.stringify({ schemaVersion: 2, project, template, containerIds: [] }, null, 2) + '\n',
  );
  const recorded = JSON.parse(readFileSync(marker, 'utf8'));
  assert.equal(recorded.schemaVersion, 2);
  assert.equal(recorded.project, project);
  assert.equal(recorded.template, template);
  assert.ok(Array.isArray(recorded.containerIds));
  assert.deepEqual(projectContainerIds(project), recorded.containerIds);
  const running = run('docker', [
    'ps',
    '--filter',
    `label=com.docker.compose.project=${project}`,
    '--format',
    '{{.ID}}',
  ]);
  assert.equal(running, '', 'Owned project is running but failed attach; reconcile it.');
  const secrets = join(options.stateDir, 'indexer.env');
  privateFile(
    secrets,
    [
      'APP__INFRA__STORAGE__PASSWORD',
      'APP__INFRA__PUB_SUB__PASSWORD',
      'APP__INFRA__LEDGER_STATE_STORAGE__PASSWORD',
      'APP__INFRA__SECRET',
    ]
      .map((name) => `${name}=${randomBytes(32).toString('hex')}`)
      .join('\n') + '\n',
  );
  const lines = readFileSync(secrets, 'utf8').trim().split('\n');
  assert.deepEqual(
    lines.map((line) => line.split('=')[0]),
    [
      'APP__INFRA__STORAGE__PASSWORD',
      'APP__INFRA__PUB_SUB__PASSWORD',
      'APP__INFRA__LEDGER_STATE_STORAGE__PASSWORD',
      'APP__INFRA__SECRET',
    ],
    'Existing indexer credential file has an unexpected shape.',
  );
  for (const line of lines) assert.match(line.split('=')[1] ?? '', /^[a-f0-9]{64}$/);
  const target = compose(project, template, {
    ...process.env,
    PASSPORT_LOCALNET_PROJECT: project,
    PASSPORT_INDEXER_ENV_FILE: secrets,
    MN_NODE_PORT: '9944',
    MN_INDEXER_PORT: '8088',
    MN_PROOF_PORT: '6300',
  });
  composeRun(target, ['config', '--quiet']);
  console.log(`midnames-demo: starting only Passport-owned project ${project}.`);
  try {
    composeRun(target, ['up', '-d']);
    const containerIds = projectContainerIds(project);
    assert.ok(containerIds.length > 0, 'Compose started no owned containers.');
    recordContainers(marker, project, containerIds);
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const profile = attach();
        return { profile, started: true, project, containerIds };
      } catch {
        await new Promise((done) => setTimeout(done, 3_000));
      }
    }
    throw new Error(`Owned project ${project} did not pass Ledger 9 attach; inspect its logs.`);
  } catch (error) {
    try {
      const containerIds = projectContainerIds(project);
      recordContainers(marker, project, containerIds);
      stopRecordedContainers(project, containerIds);
    } catch (cleanupError) {
      throw new CleanupUnconfirmedError(
        `Owned project ${project} startup failed and its containers could not be confirmed stopped: ${String(error)}; cleanup: ${String(cleanupError)}`,
      );
    }
    throw error;
  }
}

/** @param {string} stateDir */
function stopOwnedStack(stateDir) {
  privateState(stateDir);
  const marker = join(stateDir, 'owned-stack.json');
  const project = ownedProject(stateDir);
  try {
    assert.ok(existsSync(marker), 'No Passport-owned fallback project is recorded.');
    const recorded = JSON.parse(readFileSync(marker, 'utf8'));
    assert.equal(recorded.schemaVersion, 2);
    assert.equal(recorded.project, project);
    assert.equal(recorded.template, template);
    assert.ok(Array.isArray(recorded.containerIds));
    assert.ok(existsSync(join(stateDir, 'indexer.env')), 'Owned indexer credentials are missing.');
    stopRecordedContainers(project, recorded.containerIds);
    console.log(`midnames-demo: stopped only ${project}; volumes retained.`);
  } catch (error) {
    if (error instanceof CleanupUnconfirmedError) throw error;
    let containerIds;
    try {
      containerIds = projectContainerIds(project);
    } catch (inspectionError) {
      throw new CleanupUnconfirmedError(
        `Cannot inspect ${project} after stop refusal: ${String(error)}; Docker: ${String(inspectionError)}`,
      );
    }
    if (containerIds.length > 0)
      throw new CleanupUnconfirmedError(
        `Cannot use the ownership marker for ${project}; recorded containers require reconciliation: ${String(error)}`,
      );
    throw error;
  }
}

/** @param {string} file @returns {Promise<Claim>} */
async function verifyProfile(file) {
  assert.ok(isAbsolute(file) && existsSync(file), 'Pass an existing absolute --profile path.');
  const env = {
    ...process.env,
    MN_NODE_URL: 'http://127.0.0.1:9944',
    MN_INDEXER_URL: 'http://127.0.0.1:8088/api/v4/graphql',
    MN_INDEXER_WS_URL: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
  };
  const result = run(
    'pnpm',
    [
      '--filter',
      'passport-dapp',
      'exec',
      'node',
      '--experimental-import-meta-resolve',
      '--import',
      'tsx',
      join(root, 'examples/midnames-local/check-live-profile.mjs'),
      file,
    ],
    { env, timeout: 60_000 },
  );
  return JSON.parse(result);
}

function ensureWorkspaceDependencies() {
  if (!existsSync(join(root, 'apps/passport-dapp/node_modules/.bin/tsx'))) {
    console.log(
      'midnames-demo: installing pinned workspace dependencies for the live claim check.',
    );
    run('pnpm', ['install', '--frozen-lockfile'], { timeout: 180_000 });
  }
  if (
    !existsSync(join(root, 'packages/account/dist/names.js')) ||
    !existsSync(join(root, 'packages/contract/dist/index.js'))
  ) {
    console.log('midnames-demo: building workspace packages for the live claim check.');
    run('pnpm', ['run', 'build'], { timeout: 180_000 });
  }
}

/** @param {DemoOptions} options @param {Claim|undefined} claim @param {NodeJS.ProcessEnv} env */
async function startClaimHost(options, claim, env) {
  assert.ok(
    claim && options.preparedRegistry && options.contractDir,
    '--claim needs a verified profile, --prepared-registry and --contract-dir.',
  );
  const ownerPort = 15190;
  const sponsorPort = 15189;
  await freePort(ownerPort);
  await freePort(sponsorPort);
  for (const name of ['claim-sponsor-seed.private.hex', 'claim-sponsor-wallet-provision.json'])
    assert.ok(existsSync(join(options.stateDir, name)), `--claim needs funded ${name}.`);
  const provision = JSON.parse(
    readFileSync(join(options.stateDir, 'claim-sponsor-wallet-provision.json'), 'utf8'),
  );
  assert.equal(provision.status, 'complete', 'Claim sponsor wallet funding is unresolved.');
  const journal = claimJournalDirectory(options);
  console.log(`midnames-demo: retaining claim journal at ${journal}.`);
  privateState(journal);
  const args = [
    '--experimental-import-meta-resolve',
    '--import',
    'tsx',
    join(root, 'examples/midnames-local/claim-demo-host.mjs'),
    options.preparedRegistry,
    options.contractDir,
    claim.registryAddress,
    join(options.stateDir, 'claim-sponsor-seed.private.hex'),
    journal,
    String(sponsorPort),
    String(ownerPort),
  ];
  // Keep the wallet process as our direct child. A pnpm wrapper can exit while
  // its Node grandchild still holds the sponsor wallet and claim journal.
  const child = spawn('node', args, {
    cwd: join(root, 'apps/passport-dapp'),
    env: { ...env, MN_PROOF_SERVER_URL: 'http://127.0.0.1:16320' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let output = '';
  try {
    await new Promise((done, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Claim host did not become ready.')),
        180_000,
      );
      /** @param {Error|undefined} error */
      const finish = (error) => {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        child.off('exit', onExit);
        child.off('error', finish);
        if (error) reject(error);
        else done(undefined);
      };
      /** @param {number|null} code */
      const onExit = (code) => finish(new Error(`Claim host exited before readiness (${code}).`));
      /** @param {Buffer} chunk */
      const onData = (chunk) => {
        const text = chunk.toString();
        process.stdout.write(text);
        output = (output + text).slice(-4096);
        if (
          output.includes(`PASSPORT_MIDNAMES_OWNER_PORT=${ownerPort}`) &&
          output.includes(`PASSPORT_MIDNAMES_SPONSOR_PORT=${sponsorPort}`)
        )
          finish(undefined);
      };
      child.stdout?.on('data', onData);
      child.once('exit', onExit);
      child.once('error', finish);
    });
    child.stdout?.pipe(process.stdout);
  } catch (error) {
    child.kill('SIGINT');
    await new Promise((done) => {
      if (child.exitCode !== null || child.signalCode !== null) return done(undefined);
      child.once('exit', () => done(undefined));
      setTimeout(() => done(undefined), 15_000).unref();
    });
    if (child.exitCode === null && child.signalCode === null)
      throw new CleanupUnconfirmedError(
        `Claim host startup failed and its wallet did not confirm shutdown: ${String(error)}`,
      );
    throw error;
  }
  return { child, ownerPort, sponsorPort };
}

/** @param {string} stateDir */
async function compatProver(stateDir) {
  const url = 'http://127.0.0.1:16320/version';
  // Never send a naming witness to an unrecorded listener, even if its version matches.
  await freePort(16320);
  const project = `${ownedProject(stateDir)}-compat`;
  const marker = join(stateDir, 'compat-prover.json');
  privateFile(
    marker,
    JSON.stringify(
      { schemaVersion: 2, project, template: compatTemplate, containerIds: [] },
      null,
      2,
    ) + '\n',
  );
  const recorded = JSON.parse(readFileSync(marker, 'utf8'));
  assert.equal(recorded.schemaVersion, 2);
  assert.equal(recorded.project, project);
  assert.equal(recorded.template, compatTemplate);
  assert.ok(Array.isArray(recorded.containerIds));
  assert.deepEqual(projectContainerIds(project), recorded.containerIds);
  const running = run('docker', [
    'ps',
    '--filter',
    `label=com.docker.compose.project=${project}`,
    '--format',
    '{{.ID}}',
  ]);
  assert.equal(running, '', 'Owned compatibility prover is running at another port.');
  const target = compose(project, compatTemplate, {
    ...process.env,
    PASSPORT_COMPAT_PROVER_PROJECT: project,
    PASSPORT_COMPAT_PROVER_PORT: '16320',
  });
  try {
    composeRun(target, ['up', '-d', 'proof-server']);
    const containerIds = projectContainerIds(project);
    assert.equal(containerIds.length, 1, 'Compatibility prover must own one container.');
    const containerId = containerIds[0];
    assert.ok(containerId);
    const container = JSON.parse(run('docker', ['inspect', '--format', '{{json .}}', containerId]));
    assert.equal(container.Id, containerId);
    assert.equal(container.Config.Image, compatImage);
    assert.equal(container.HostConfig.NetworkMode, 'bridge');
    assert.deepEqual(container.HostConfig.PortBindings, {
      '6300/tcp': [{ HostIp: '127.0.0.1', HostPort: '16320' }],
    });
    assert.equal(container.State.Running, true);
    recordContainers(marker, project, containerIds, compatTemplate);
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(4_000) });
        if (response.ok && (await response.text()) === '9.0.0-rc.8')
          return { started: true, project, containerIds };
      } catch {
        /* wait */
      }
      await new Promise((done) => setTimeout(done, 2_000));
    }
    throw new Error('Owned Compact 0.35 prover did not become ready.');
  } catch (error) {
    try {
      const containerIds = projectContainerIds(project);
      recordContainers(marker, project, containerIds, compatTemplate);
      stopRecordedContainers(project, containerIds);
    } catch (cleanupError) {
      throw new CleanupUnconfirmedError(
        `Owned compatibility prover startup failed and its container could not be confirmed stopped: ${String(error)}; cleanup: ${String(cleanupError)}`,
      );
    }
    throw error;
  }
}

/** @param {DemoOptions} options @param {Claim|undefined} claim */
async function demo(options, claim) {
  privateState(options.stateDir);
  const prover = await compatProver(options.stateDir);
  /** @type {Awaited<ReturnType<typeof startClaimHost>> | undefined} */
  let claimHost;
  try {
    /** @type {NodeJS.ProcessEnv} */
    const env = {
      ...process.env,
      MIDNIGHT_STACK: 'shared-ledger9',
      ...(options.contractDir ? { PASSPORT_CONTRACT_DIR: options.contractDir } : {}),
      PASSPORT_REGISTRY_FILE: join(
        options.stateDir,
        options.candidateAssets ? 'registry-candidate.json' : 'registry.json',
      ),
      ...(options.candidateAssets
        ? {
            PASSPORT_BINDING_ID: 'acc-s3r1.1-zkir036',
            PASSPORT_CANDIDATE_LOCAL: '1',
            PASSPORT_MANIFEST_SHA256: candidateManifest,
            PASSPORT_ARTEFACT_DIR: options.candidateAssets,
            PASSPORT_COMPAT_PROVER: '0',
            PASSPORT_PUBLIC_PROOF_SERVER_URL: 'http://127.0.0.1:6300',
          }
        : {
            PASSPORT_BINDING_ID: 'acc-s3r1.1',
            PASSPORT_CANDIDATE_LOCAL: '0',
            PASSPORT_COMPAT_PROVER: '1',
            PASSPORT_COMPAT_PROVER_PORT: '16320',
          }),
      MN_NETWORK_ID: 'undeployed',
      MN_NODE_URL: 'http://127.0.0.1:9944',
      MN_INDEXER_URL: 'http://127.0.0.1:8088/api/v4/graphql',
      MN_INDEXER_WS_URL: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
      MN_PROOF_SERVER_URL: options.candidateAssets
        ? 'http://127.0.0.1:6300'
        : 'http://127.0.0.1:16320',
    };
    if (options.candidateAssets) delete env.PASSPORT_PUBLIC_ZK_BASE_URL;
    for (const key of Object.keys(env)) {
      if (key.startsWith('VITE_MIDNAMES_')) delete env[key];
    }
    if (claim) {
      Object.assign(env, {
        VITE_MIDNAMES_REGISTRY_PROFILE: 'standalone-0.35',
        VITE_MIDNAMES_CLAIM_PROTOCOL_VERSION: '2001100',
        VITE_MIDNAMES_REGISTRY_ADDRESS: claim.registryAddress,
        VITE_MIDNAMES_NAMESPACE: 'night',
        VITE_MIDNAMES_NETWORK_ID: 'undeployed',
        VITE_MIDNAMES_INDEXER_URL: 'http://127.0.0.1:8088/api/v4/graphql',
        VITE_MIDNAMES_INDEXER_WS_URL: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
        VITE_MIDNAMES_NODE_URL: 'http://127.0.0.1:9944',
        VITE_MIDNAMES_CHAIN_ANCHOR_HEIGHT: String(claim.claimBlock.height),
        VITE_MIDNAMES_CHAIN_ANCHOR_HASH: claim.claimBlock.hash,
        ...(!options.candidateAssets && {
          VITE_MIDNAMES_KNOWN_NAME: claim.name,
          VITE_MIDNAMES_KNOWN_ACC: claim.accountAddress,
        }),
        VITE_MIDNAMES_NIGHT_SEND: options.candidateAssets && !options.nightSend ? '0' : '1',
      });
    }
    if (options.funding) {
      const fundingName = options.candidateAssets ? 'candidate-funding' : 'funding';
      if (options.candidateAssets) {
        // The stable demo may own 8789. Keep the candidate wallet and its
        // Passport-service proxy on one separate loopback port.
        env.PASSPORT_FUNDING_PORT = '18789';
        env.PASSPORT_FUNDING_URL = 'http://127.0.0.1:18789';
      }
      const provision = JSON.parse(
        readFileSync(join(options.stateDir, `${fundingName}-wallet-provision.json`), 'utf8'),
      );
      assert.equal(provision.status, 'complete', 'Funding wallet setup is unresolved.');
      Object.assign(env, {
        PASSPORT_FUNDING_SEED_FILE: join(options.stateDir, `${fundingName}-seed.private.hex`),
        PASSPORT_FUNDING_TOKEN_FILE: join(options.stateDir, `${fundingName}-token.private.txt`),
        PASSPORT_FUNDING_ASSETS_FILE: join(options.stateDir, `${fundingName}-assets.private.json`),
        PASSPORT_FUNDING_RESERVATIONS_FILE: join(
          options.stateDir,
          `${fundingName}-reservations.json`,
        ),
        PASSPORT_FUNDING_DEPLOYMENTS_FILE: join(
          options.stateDir,
          options.candidateAssets
            ? 'registry-candidate.deployments.json'
            : 'registry.deployments.json',
        ),
      });
    }
    if (options.claim) {
      claimHost = await startClaimHost(options, claim, env);
      Object.assign(env, {
        PASSPORT_MIDNAMES_OWNER_PORT: String(claimHost.ownerPort),
        PASSPORT_MIDNAMES_SPONSOR_PORT: String(claimHost.sponsorPort),
        VITE_MIDNAMES_CLAIM_SPONSOR: '1',
        VITE_MIDNAMES_CLAIM_PREPARATION: '1',
      });
    }
    const args = [join(root, 'scripts/demo.mjs'), 'up', '--no-key-service', '--arm', 'jubjub'];
    if (options.funding) args.push('--funding');
    if (options.mockPasskey) args.push('--mock-passkey');
    if (options.open) args.push('--open');
    if (options.contractDir) args.push('--contract-dir', options.contractDir);
    else {
      assert.ok(options.passportRepo);
      args.push('--passport-repo', options.passportRepo);
    }
    if (claim) console.log(`midnames-demo: ${claim.name} resolves to ${claim.accountAddress}.`);
    else console.log('midnames-demo: account setup mode; claim a name before enabling named send.');
    console.log('midnames-demo: open the printed localhost URL in a dedicated browser profile.');
    // The direct Node child must finish the shared service drain before this
    // launcher releases its claim host and prover. Keep terminal SIGINT in
    // this process group so the child receives only the forwarded signal.
    const child = spawn('node', args, { cwd: root, env, stdio: 'inherit', detached: true });
    let interrupted = false;
    const forward = () => {
      interrupted = true;
      child.kill('SIGINT');
    };
    process.once('SIGINT', forward);
    process.once('SIGTERM', forward);
    let outcome;
    try {
      outcome = await new Promise((done, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => done({ code, signal }));
      });
    } finally {
      process.removeListener('SIGINT', forward);
      process.removeListener('SIGTERM', forward);
    }
    if (outcome.code !== 0 && !interrupted)
      throw new Error(`Demo exited ${outcome.code ?? outcome.signal}.`);
  } finally {
    /** @type {string[]} */
    const cleanupErrors = [];
    if (claimHost) {
      const host = claimHost;
      host.child.kill('SIGINT');
      await new Promise((done) => {
        if (host.child.exitCode !== null || host.child.signalCode !== null) return done(undefined);
        host.child.once('exit', done);
        setTimeout(() => done(undefined), 15_000).unref();
      });
      if (host.child.exitCode === null && host.child.signalCode === null)
        cleanupErrors.push('Claim host did not confirm shutdown; preserve its journal.');
    }
    if (prover.started && prover.project && prover.containerIds) {
      try {
        stopRecordedContainers(prover.project, prover.containerIds);
      } catch (error) {
        cleanupErrors.push(`Owned compatibility prover did not confirm shutdown: ${String(error)}`);
      }
    }
    if (cleanupErrors.length)
      throw new CleanupUnconfirmedError(`${cleanupErrors.join(' ')} Preserve the launcher lock.`);
  }
}

/** @param {string[]} [argv] */
export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return console.log(usage);
  assert.ok(process.env.IN_NIX_SHELL, 'Run through nix develop -c.');
  const release = options.command === 'check' ? undefined : lockLauncher();
  let retainLock = false;
  try {
    if (options.command === 'stop') return stopOwnedStack(options.stateDir);
    if (options.setup && options.command !== 'up') throw new Error('--setup applies only to up.');
    if ((options.claim || options.funding) && options.command !== 'up')
      throw new Error('--claim and --funding apply only to up.');
    if (options.claimJournalId && !options.claim)
      throw new Error('--claim-journal-id needs --claim.');
    if (
      options.nightSend &&
      (options.command !== 'up' || !options.candidateAssets || !options.claim || !options.funding)
    )
      throw new Error('--night-send needs up with --candidate-assets, --claim and --funding.');
    if (options.command === 'up' && options.candidateAssets && !options.claim)
      throw new Error(
        '--candidate-assets needs --claim and a verified standalone registry profile.',
      );
    if (options.claim && options.setup && !options.candidateAssets)
      throw new Error('--claim needs a verified local registry profile.');
    if (options.command === 'up' && !options.contractDir && !options.passportRepo)
      throw new Error('Pass --contract-dir or --passport-repo for the pinned ACC.');
    if (options.command === 'up') {
      const disk = statfsSync(root);
      assert.ok(
        BigInt(disk.bavail) * BigInt(disk.bsize) >= 50n * 1024n ** 3n,
        'Need 50 GiB free before preparing the ACC; clean owned outputs first.',
      );
    }
    const selected = await stack(options);
    console.log(JSON.stringify(selected.profile));
    if (options.command === 'stack') return;
    try {
      if (!options.setup || options.claim) ensureWorkspaceDependencies();
      const claim =
        options.setup && !options.claim ? undefined : await verifyProfile(options.profile);
      if (claim)
        console.log(`midnames-demo: live name pin verified at block ${claim.claimBlock.height}.`);
      if (options.command === 'up') await demo(options, claim);
    } finally {
      if (selected.started && selected.project && selected.containerIds) {
        // Never stop a pre-existing stack, even when it belongs to this repo.
        stopRecordedContainers(selected.project, selected.containerIds);
        console.log("midnames-demo: stopped only this run's owned containers; volumes retained.");
      }
    }
  } catch (error) {
    if (error instanceof CleanupUnconfirmedError) {
      retainLock = true;
      console.error(`midnames-demo: launcher lock retained at ${lockPath}.`);
    }
    throw error;
  } finally {
    if (!retainLock) release?.();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`midnames-demo: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
