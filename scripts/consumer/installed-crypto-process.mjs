import { spawn } from 'node:child_process';
import { createOwnedProcessStopper } from '../qualification/process-stop.mjs';

/** @param {string[]} args @param {{cwd:string,timeoutMs?:number,maxOutputBytes?:number}} options */
export async function runCryptoChild(args, options) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxOutputBytes = options.maxOutputBytes ?? 4 * 1024 * 1024;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60_000 ||
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes < 1 ||
    maxOutputBytes > 4 * 1024 * 1024
  )
    throw Error('Invalid installed crypto child limits');
  const started = performance.now();
  const child = spawn(process.execPath, args, {
    cwd: options.cwd,
    env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8' },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stopper = createOwnedProcessStopper(child, 1000);
  /** @type {'timeout'|'output-limit'|'interrupted'|undefined} */ let stopped;
  /** @type {Error|undefined} */ let spawnError;
  /** @type {Buffer[]} */ const stdout = [];
  /** @type {Buffer[]} */ const stderr = [];
  let outputBytes = 0;
  /** @param {NonNullable<typeof stopped>} reason */
  const stop = (reason) => {
    stopped ??= reason;
    stopper.stop();
  };
  const interrupt = () => stop('interrupted');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const timer = setTimeout(() => stop('timeout'), timeoutMs);
  /** @param {Buffer[]} target @param {Buffer} chunk */
  const collect = (target, chunk) => {
    outputBytes += chunk.length;
    if (outputBytes <= maxOutputBytes) target.push(chunk);
    else stop('output-limit');
  };
  child.stdout.on('data', (chunk) => collect(stdout, chunk));
  child.stderr.on('data', (chunk) => collect(stderr, chunk));
  child.once('error', (error) => {
    spawnError = error;
  });
  try {
    /** @type {{code:number|null,signal:NodeJS.Signals|null}} */
    const exit = await new Promise((resolve) => {
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    return {
      outcome: stopped ?? (spawnError || exit.code !== 0 ? 'failed' : 'passed'),
      exitCode: exit.code,
      signal: exit.signal,
      elapsedMs: performance.now() - started,
      spawnError: spawnError?.message,
      outputBytes,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
    };
  } finally {
    clearTimeout(timer);
    stopper.dispose();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}
