import type { NightSendLeg } from '../midnames/night-send.js';

const HEX = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{66}$/;
const PREFIX = 'mn-passport:dust-registration:v1:';

interface PendingRegistration {
  readonly version: 1;
  readonly networkId: string;
  readonly address: string;
  readonly original: NightSendLeg;
  readonly createdAt: string;
}

/** A finalized ID is durable before dispatch; an uncertain send never starts a replacement. */
export function dustRegistrationJournal(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  networkId: string,
  address: string,
) {
  if (networkId !== 'undeployed' || !/^mn_addr_undeployed1[a-z0-9]+$/.test(address))
    throw new Error('Invalid wallet DUST registration scope.');
  const key = `${PREFIX}${networkId}:${address}:active`;
  const checked = (raw: string): PendingRegistration => {
    const row: unknown = JSON.parse(raw);
    if (!row || typeof row !== 'object' || Array.isArray(row))
      throw new Error('Invalid saved DUST registration.');
    const value = row as Record<string, unknown>;
    const original = value.original as Record<string, unknown> | undefined;
    if (
      value.version !== 1 ||
      value.networkId !== networkId ||
      value.address !== address ||
      typeof value.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      !original ||
      typeof original.hash !== 'string' ||
      !HEX.test(original.hash) ||
      !Array.isArray(original.identifiers) ||
      original.identifiers.length === 0 ||
      original.identifiers.length > 32 ||
      original.identifiers.some((id) => typeof id !== 'string' || !ID.test(id)) ||
      new Set(original.identifiers).size !== original.identifiers.length
    )
      throw new Error('Invalid saved DUST registration.');
    return {
      version: 1,
      networkId,
      address,
      original: {
        hash: original.hash,
        identifiers: original.identifiers.map((id) => String(id)),
      },
      createdAt: value.createdAt,
    };
  };
  const read = () => {
    const raw = storage.getItem(key);
    if (!raw) return undefined;
    if (raw.length > 4096) throw new Error('Invalid saved DUST registration.');
    return checked(raw);
  };
  return {
    read,
    create(original: NightSendLeg) {
      if (read())
        throw new Error('Reconcile the original DUST registration before starting another.');
      const row = checked(
        JSON.stringify({
          version: 1,
          networkId,
          address,
          original,
          createdAt: new Date().toISOString(),
        }),
      );
      storage.setItem(key, JSON.stringify(row));
      if (JSON.stringify(read()) !== JSON.stringify(row))
        throw new Error('DUST registration was not saved before submission.');
    },
    archive(original: NightSendLeg) {
      const row = read();
      if (!row || JSON.stringify(row.original) !== JSON.stringify(original))
        throw new Error('The original DUST registration changed.');
      const history = `${PREFIX}${networkId}:${address}:history:${original.hash}`;
      const archived = JSON.stringify({ ...row, finalizedAt: new Date().toISOString() });
      const prior = storage.getItem(history);
      if (prior && JSON.parse(prior).original?.hash !== original.hash)
        throw new Error('DUST registration history conflicts with the original.');
      if (!prior) storage.setItem(history, archived);
      storage.removeItem(key);
    },
  };
}
