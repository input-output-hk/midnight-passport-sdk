// Bounded commands with private output; no shell interpolation or arbitrary environment logs.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { put, sha256 } from './files.mjs';

/** Probes do not inherit registry credentials, sponsor overrides or Node preload hooks. */
export function probeEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name, value]) =>
        value !== undefined &&
        /^(?:PATH|HOME|TMPDIR|TMP|TEMP|IN_NIX_SHELL|NIX_SSL_CERT_FILE|SSL_CERT_FILE|COMPACT_DIRECTORY|COMPACT_HOME|LANG|TZ)$/.test(
          name,
        ),
    ),
  );
}

export class CommandTransportFailure extends Error {
  /** @param {string} binary @param {{stdout:string,stderr:string}} partial */
  constructor(binary, partial) {
    super(`${binary} transport failed; dispatch may have occurred`);
    this.name = 'CommandTransportFailure';
    this.partial = partial;
  }
}

/** @param {string} binary @param {string[]} args @param {{cwd?:string,env?:NodeJS.ProcessEnv,input?:string|Buffer|undefined,timeout?:number,allowFailure?:boolean|undefined}} [options] */
export function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    encoding: 'utf8',
    timeout: options.timeout ?? 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.signal || result.status === null)
    throw new CommandTransportFailure(binary, {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    });
  if (result.status !== 0 && !options.allowFailure)
    throw Error(`${binary} failed; output retained privately by caller when applicable`);
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}
/** @param {string} root @param {string} name @param {string} binary @param {string[]} args @param {Parameters<typeof command>[2]} [options] */
export function loggedCommand(root, name, binary, args, options = {}) {
  let failure;
  let result;
  try {
    result = command(binary, args, { ...options, allowFailure: true });
  } catch (error) {
    if (!(error instanceof CommandTransportFailure)) throw error;
    failure = error;
    result = { ...error.partial, status: -1 };
  }
  let output = result.stdout + result.stderr;
  for (const secret of [
    process.env.GITHUB_TOKEN,
    process.env.GH_TOKEN,
    options.env?.GITHUB_TOKEN,
    options.env?.GH_TOKEN,
  ])
    if (secret) output = output.replaceAll(secret, '[REDACTED]');
  output = output.replace(
    /https:\/\/pkg-npm\.githubusercontent\.com\/[^\s"'<>]+/g,
    '[SIGNED-CDN-URL-OMITTED]',
  );
  const bytes = Buffer.from(output);
  put(join(root, name), bytes);
  if (failure)
    throw Error(`${binary} transport failed; partial output retained privately in ${name}`);
  if (result.status !== 0 && !options.allowFailure)
    throw Error(`${binary} failed; inspect private ${name}`);
  return { ...result, log: { file: name, sha256: sha256(bytes), bytes: bytes.length } };
}
