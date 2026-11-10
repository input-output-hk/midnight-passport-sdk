// Test-only controller kills itself. Never signal a caller-supplied PID.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { sourceProcess } from '../../scripts/release/process-client.mjs';
import {
  prepareProcessLaunch,
  readProcessLaunch,
  admitControlSocket,
} from '../../scripts/release/process-launch.mjs';
import { processProof } from '../../scripts/release/process-protocol.mjs';
import { observeProcess } from '../../scripts/release/process-identity.mjs';
import { put, syncDirectory } from '../../scripts/release/files.mjs';
import { processRecord } from '../../scripts/release/process-record.mjs';
const root = process.env.PASSPORT_PROCESS_FIXTURE_ROOT;
if (!root) throw Error('Fixture root missing');
const controller = observeProcess(process.pid);
if (!controller) throw Error('Controller identity unavailable');
const program = fileURLToPath(new URL('./process-source.mjs', import.meta.url));
const save = (/** @type {unknown} */ value) => {
  put(join(root, 'reference.json'), JSON.stringify(value) + '\n');
  syncDirectory(root);
};
process.on('message', (message) => {
  if (message === 'kill-self') process.kill(process.pid, 'SIGKILL');
});
const mode = process.env.PASSPORT_PROCESS_PARENT_MODE;
if (mode !== 'admitted') {
  const prepared = prepareProcessLaunch(
    root,
    'a'.repeat(16),
    program,
    controller,
    join(root, 'ctl'),
  );
  save({ directory: prepared.directory, launchSha256: prepared.launchSha256 });
  spawn(
    prepared.launch.executable,
    [
      mode === 'before-claim' || mode === 'before-record'
        ? fileURLToPath(new URL('./process-bootstrap.mjs', import.meta.url))
        : prepared.launch.worker,
      '--intent',
      prepared.directory,
      '--sha256',
      prepared.launchSha256,
    ],
    { env: process.env, detached: true, stdio: 'ignore' },
  ).unref();
  if (mode === 'before-record') {
    while (!existsSync(join(prepared.directory, 'worker-claim.json'))) await delay(10);
  } else if (mode !== 'before-claim')
    while (
      !existsSync(join(prepared.directory, 'record.json')) ||
      processRecord(prepared.directory, prepared.launchSha256).phase !== 'ready'
    )
      await delay(10);
  if (mode === 'before-claim' || mode === 'before-record') {
    put(
      join(root, 'early-boundary.json'),
      JSON.stringify({
        claim: existsSync(join(prepared.directory, 'worker-claim.json')),
        record: existsSync(join(prepared.directory, 'record.json')),
      }) + '\n',
    );
  }
  if (mode === 'lost-go-ack') {
    const record = processRecord(prepared.directory, prepared.launchSha256);
    if (!record.socket) throw Error('Socket missing');
    const { launch, key } = readProcessLaunch(prepared.directory, prepared.launchSha256);
    put(
      join(prepared.directory, 'go-intent.json'),
      JSON.stringify({
        launchSha256: prepared.launchSha256,
        identitySha256: record.identitySha256,
      }) + '\n',
    );
    syncDirectory(prepared.directory);
    const socket = createConnection(admitControlSocket(launch, record.socket));
    socket.pause();
    const request = {
      schema: 1,
      action: 'go',
      challenge: randomBytes(32).toString('hex'),
      launch: prepared.launchSha256,
      identity: record.identitySha256,
    };
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.once('connect', () => {
        socket.write(
          JSON.stringify({ ...request, proof: processProof(key, 'request', request) }) + '\n',
        );
        resolve(undefined);
      });
    });
    while (processRecord(prepared.directory, prepared.launchSha256).phase !== 'admitted')
      await delay(10);
    key.fill(0); // Deliberately never read the GO reply or persist an ACK.
  }
} else {
  const client = sourceProcess({
    root,
    runId: 'a'.repeat(16),
    program,
    controller,
    env: process.env,
    check: () => {},
    onLaunch: save,
    controlParent: join(root, 'ctl'),
  });
  await client.start();
}
process.send?.('ready');
