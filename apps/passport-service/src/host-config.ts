import { readFileSync, lstatSync } from 'node:fs';
import {
  createHostMutationExecutor,
  encryptedHostMutationStore,
  hostMutationRoute,
  type HostMutationDriver,
  serial,
} from '@input-output-hk/mn-passport-service';
import type { ServiceConfig } from './config.ts';

export function configuredHostMutations(
  config: ServiceConfig,
  driver: HostMutationDriver | undefined,
  env: NodeJS.ProcessEnv,
  runExclusive: ReturnType<typeof serial>,
  acceptDeployment: () => void,
) {
  const directory = env.PASSPORT_HOST_MUTATION_DIR,
    keyFile = env.PASSPORT_HOST_MUTATION_KEY_FILE,
    tokenFile = env.PASSPORT_HOST_MUTATION_TOKEN_FILE;
  if (!directory && !keyFile && !tokenFile) return undefined;
  if (!directory || !keyFile || !tokenFile || !driver)
    throw new Error(
      'Set all three PASSPORT_HOST_MUTATION settings with a supported reference driver.',
    );
  if (keyFile === tokenFile)
    throw new Error('Use separate host encryption and authentication keys.');
  const read = (path: string) => {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.size > 128)
      throw new Error('Host key/token must be a private regular file (0600).');
    const text = readFileSync(path, 'utf8').trim();
    if (!/^[0-9a-f]{64}$/.test(text))
      throw new Error('Host key/token file must hold 32-byte lowercase hex.');
    return new Uint8Array(Buffer.from(text, 'hex'));
  };
  const key = read(keyFile),
    token = read(tokenFile);
  try {
    if (Buffer.from(key).equals(Buffer.from(token)))
      throw new Error('Use independent host encryption and authentication keys.');
    const store = encryptedHostMutationStore(directory, key),
      executor = createHostMutationExecutor(store, driver);
    return hostMutationRoute({
      executor,
      pins: {
        networkId: config.networkId,
        bindingId: config.bindingId,
        manifestSha256: config.manifestSha256,
      },
      token,
      runExclusive,
      acceptDeployment,
    });
  } finally {
    key.fill(0);
    token.fill(0);
  }
}
