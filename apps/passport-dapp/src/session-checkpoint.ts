import type { DemoSessionSnapshot } from './session.js';

/** Public authorization metadata and uncertain-effect fences, never secrets or scope openings. */
export function sessionCheckpoint(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  network: string,
  binding: string,
) {
  const key = `passport-demo:session:v1:${network}:${binding}`;
  const statuses = ['locked', 'authorizing', 'active', 'spending', 'expired', 'blocked', 'revoked'];
  const allowed = new Set([
    'status',
    'account',
    'grantId',
    'expiresAt',
    'color',
    'recipient',
    'perCallCap',
    'cap',
    'spent',
    'txHash',
  ]);
  const invalid = (): DemoSessionSnapshot => ({ status: 'blocked', spent: '0' });
  return {
    read(): DemoSessionSnapshot | undefined {
      try {
        const text = storage.getItem(key);
        if (!text) return;
        const value: unknown = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
        const v = value as Record<string, unknown>;
        if (
          Object.keys(v).some((k) => !allowed.has(k)) ||
          !statuses.includes(String(v.status)) ||
          typeof v.spent !== 'string' ||
          !/^(0|[1-9][0-9]*)$/.test(v.spent)
        )
          return invalid();
        for (const field of ['account', 'grantId', 'color', 'recipient', 'txHash'])
          if (
            v[field] !== undefined &&
            (typeof v[field] !== 'string' || !/^[0-9a-f]{64}$/.test(v[field] as string))
          )
            return invalid();
        for (const field of ['cap', 'perCallCap'])
          if (
            v[field] !== undefined &&
            (typeof v[field] !== 'string' || !/^[1-9][0-9]*$/.test(v[field] as string))
          )
            return invalid();
        if (
          v.expiresAt !== undefined &&
          (!Number.isSafeInteger(v.expiresAt) || (v.expiresAt as number) <= 0)
        )
          return invalid();
        return v as unknown as DemoSessionSnapshot;
      } catch {
        return invalid();
      }
    },
    write(snapshot: DemoSessionSnapshot) {
      // Never spread caller data into storage: persist only this public whitelist.
      const value = Object.fromEntries(
        Object.entries(snapshot).filter(([field]) => allowed.has(field)),
      );
      storage.setItem(key, JSON.stringify(value));
    },
  };
}
