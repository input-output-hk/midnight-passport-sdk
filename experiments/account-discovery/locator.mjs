import { createHash } from 'node:crypto';

const domain = Buffer.alloc(32);
domain.write('midnight:passport:locator:v1', 'ascii');

export const locatorPrfSalt = () =>
  createHash('sha256').update('midnight:passport:discovery:prf:v1', 'ascii').digest();

export function discoveryNamespace(network) {
  if (
    typeof network !== 'string' ||
    network.length > 32 ||
    network.match(/^[a-z0-9]+(?:-[a-z0-9]+)*/)?.[0] !== network
  ) {
    throw new TypeError('Expected a canonical ASCII network identifier of at most 32 bytes');
  }
  const namespace = Buffer.alloc(32);
  namespace.write(network, 'ascii');
  return namespace;
}

export function discoveryLocator({ network, registry, secret }) {
  if (typeof registry !== 'string' || registry.length !== 64 || /[^0-9a-f]/.test(registry)) {
    throw new TypeError('Expected a 32-byte lowercase hexadecimal registry address');
  }
  if (!(secret instanceof Uint8Array) || secret.byteLength !== 32) {
    throw new TypeError('Expected a 32-byte discovery PRF output');
  }
  return createHash('sha256')
    .update(domain)
    .update(discoveryNamespace(network))
    .update(Buffer.from(registry, 'hex'))
    .update(secret)
    .digest();
}
