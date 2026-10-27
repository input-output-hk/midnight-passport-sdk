import { readFileSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, sep } from 'node:path';
import {
  createHostMutationExecutor,
  encryptedHostMutationStore,
  hostMutationRoute,
  createHostMutationJobs,
  encryptedHostJobStore,
  hostJobRoute,
  HttpError,
  type HostMutationDriver,
  type Route,
  serial,
} from '@input-output-hk/mn-passport-service';
import type { ServiceConfig } from './config.ts';

/** Callable for existing route composition; close only after stopping HTTP admission. */
export type ConfiguredHostMutations = Route & {
  readonly hostJobs: boolean;
  stopAdmission(): void;
  drain(): Promise<void>;
  close(): Promise<void>;
};

const bounded = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
) => {
  const text = env[name];
  if (text === undefined) return fallback;
  const n = Number(text);
  if (!/^(0|[1-9][0-9]*)$/.test(text) || !Number.isSafeInteger(n) || n < min || n > max)
    throw new Error(`Invalid ${name}; expected an integer from ${min} to ${max}.`);
  return n;
};
const canonicalPath = (path: string): string => {
  const absolute = resolve(path);
  return existsSync(absolute)
    ? realpathSync(absolute)
    : resolve(canonicalPath(dirname(absolute)), basename(absolute));
};

export function configuredHostMutations(
  config: ServiceConfig,
  driver: HostMutationDriver | undefined,
  env: NodeJS.ProcessEnv,
  runExclusive: ReturnType<typeof serial>,
  acceptDeployment: () => void,
): ConfiguredHostMutations | undefined {
  const directory = env.PASSPORT_HOST_MUTATION_DIR,
    keyFile = env.PASSPORT_HOST_MUTATION_KEY_FILE,
    tokenFile = env.PASSPORT_HOST_MUTATION_TOKEN_FILE;
  const jobSettings = Object.keys(env).some(
    (k) => k.startsWith('PASSPORT_HOST_JOB_') && env[k] !== undefined,
  );
  if (!directory && !keyFile && !tokenFile && !jobSettings) return undefined;
  if (!directory || !keyFile || !tokenFile || !driver)
    throw new Error(
      'Set all three PASSPORT_HOST_MUTATION settings with a supported reference driver.',
    );
  const jobDirectory = env.PASSPORT_HOST_JOB_DIR,
    jobKeyFile = env.PASSPORT_HOST_JOB_KEY_FILE,
    jobTokenFile = env.PASSPORT_HOST_JOB_TOKEN_FILE;
  if (jobSettings && (!jobDirectory || !jobKeyFile || !jobTokenFile))
    throw new Error('Host jobs require all three PASSPORT_HOST_JOB directory/key/token settings.');
  const maxJobs = bounded(env, 'PASSPORT_HOST_JOB_MAX_JOBS', 128, 1, 4096),
    maxActive = bounded(env, 'PASSPORT_HOST_JOB_MAX_ACTIVE', 8, 1, 128),
    eventLimit = bounded(env, 'PASSPORT_HOST_JOB_EVENT_LIMIT', 32, 1, 256),
    completedTtlMs = bounded(env, 'PASSPORT_HOST_JOB_COMPLETED_TTL_MS', 600000, 0, 3650 * 86400000);
  if (jobDirectory) {
    const a = canonicalPath(directory),
      b = canonicalPath(jobDirectory);
    if (a === b || a.startsWith(b + sep) || b.startsWith(a + sep))
      throw new Error('Use distinct, non-nested host and job journal directories.');
  }
  const secrets: Uint8Array[] = [];
  const read = (path: string) => {
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.mode & 0o077 ||
      stat.size > 128 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new Error('Host key/token must be an owned private regular file (0600).');
    const text = readFileSync(path, 'utf8').trim();
    if (!/^[0-9a-f]{64}$/.test(text))
      throw new Error('Host key/token file must hold 32-byte lowercase hex.');
    const value = new Uint8Array(Buffer.from(text, 'hex'));
    if (
      text === config.sponsorSeed ||
      secrets.some((s) => Buffer.from(s).equals(Buffer.from(value)))
    ) {
      value.fill(0);
      throw new Error(
        'Use independent host/job encryption and authentication keys, separate from the sponsor seed.',
      );
    }
    secrets.push(value);
    return value;
  };
  let hostStore: ReturnType<typeof encryptedHostMutationStore> | undefined,
    jobStore: ReturnType<typeof encryptedHostJobStore> | undefined;
  try {
    const key = read(keyFile),
      token = read(tokenFile),
      jobKey = jobKeyFile ? read(jobKeyFile) : undefined,
      jobToken = jobTokenFile ? read(jobTokenFile) : undefined;
    hostStore = encryptedHostMutationStore(directory, key);
    const raw = createHostMutationExecutor(hostStore, driver);
    // Both entry points run this wrapper inside the SAME wallet queue. Count only a new
    // deployment registration, with the existing per-process budget (failures count).
    const executor = {
      ...raw,
      execute: async (...args: Parameters<typeof raw.execute>) => {
        if (args[0].kind === 'deploy' && !(await raw.inspect(args[0]))) acceptDeployment();
        return raw.execute(...args);
      },
    };
    const pins = {
      networkId: config.networkId,
      bindingId: config.bindingId,
      manifestSha256: config.manifestSha256,
    };
    const direct = hostMutationRoute({ executor, pins, token, runExclusive });
    if (jobDirectory && jobKey) jobStore = encryptedHostJobStore(jobDirectory, jobKey, { maxJobs });
    const jobs = jobStore
      ? createHostMutationJobs(jobStore, executor, {
          pins,
          runExclusive,
          maxActive,
          eventLimit,
          completedTtlMs,
        })
      : undefined;
    const jobRoute = jobs && jobToken ? hostJobRoute({ jobs, pins, token: jobToken }) : undefined;
    let open = true,
      inFlight = 0,
      closed = false;
    const waiters = new Set<() => void>();
    const stopAdmission = () => {
      open = false;
      jobs?.stopAdmission();
    };
    const drain = async () => {
      if (inFlight) await new Promise<void>((resolve) => waiters.add(resolve));
      await jobs?.drain();
    };
    const route: Route = async (req, res, url) => {
      if (!url.pathname.startsWith('/v1/mutations/') && !url.pathname.startsWith('/v1/host-jobs/'))
        return false;
      if (!open) throw new HttpError(503, 'host service is draining; retain the original identity');
      inFlight++;
      try {
        return (jobRoute && (await jobRoute(req, res, url))) || (await direct(req, res, url));
      } finally {
        if (--inFlight === 0) {
          for (const done of waiters) done();
          waiters.clear();
        }
      }
    };
    return Object.assign(route, {
      hostJobs: jobs !== undefined,
      stopAdmission,
      drain,
      async close() {
        stopAdmission();
        await drain();
        if (!closed) {
          jobStore?.close();
          hostStore?.close();
          closed = true;
        }
      },
    });
  } catch (cause) {
    jobStore?.close();
    hostStore?.close();
    throw cause;
  } finally {
    for (const secret of secrets) secret.fill(0);
  }
}
