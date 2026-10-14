import { existsSync, readFileSync } from 'node:fs';

/** Read the sponsor's trusted wave-deployment log afresh before each funding request. */
export function deployedAddresses(file: string, networkId: string): Set<string> {
  if (!existsSync(file)) return new Set();
  const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('funding deployment log is invalid');
  const rows = (data as Record<string, unknown>)[networkId];
  if (rows === undefined) return new Set();
  if (
    !Array.isArray(rows) ||
    !rows.every((address) => typeof address === 'string' && /^[0-9a-f]{64}$/i.test(address))
  )
    throw new Error('funding deployment list is invalid');
  return new Set(rows.map((address: string) => address.toLowerCase()));
}
