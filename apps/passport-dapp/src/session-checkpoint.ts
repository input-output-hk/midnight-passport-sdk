import type { DemoSessionSnapshot } from './session.js';

const pending = (s: DemoSessionSnapshot) =>
  ['authorizing', 'spending', 'revoking', 'blocked'].includes(s.status);
function validatePendingWithdrawal(v: Record<string, unknown>) {
  if (
    v.pendingWithdrawal !== undefined &&
    (typeof v.pendingWithdrawal !== 'string' ||
      !/^[1-9][0-9]{0,38}$/.test(v.pendingWithdrawal) ||
      BigInt(v.pendingWithdrawal) >= 1n << 128n ||
      !['spending', 'blocked'].includes(String(v.status)))
  )
    throw new Error('Invalid pending withdrawal.');
}
/** Public metadata, plus independent intent records that a stale display write cannot erase. */
export function sessionCheckpoint(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'key' | 'length'>,
  network: string,
  binding: string,
) {
  const key = `passport-demo:session:v1:${network}:${binding}`;
  const prefix = `${key}:intent:`;
  const statuses = [
    'locked',
    'authorizing',
    'active',
    'spending',
    'revoking',
    'expired',
    'blocked',
    'revoked',
  ];
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
    'intentId',
    'pendingWithdrawal',
  ]);
  const invalid = (): DemoSessionSnapshot => ({ status: 'blocked', spent: '0' });
  const parse = (value: unknown): DemoSessionSnapshot => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid session record.');
    const v = value as Record<string, unknown>;
    if (
      Object.keys(v).some((k) => !allowed.has(k)) ||
      !statuses.includes(String(v.status)) ||
      typeof v.spent !== 'string' ||
      !/^(0|[1-9][0-9]*)$/.test(v.spent)
    )
      throw new Error('Invalid session fields.');
    for (const field of ['account', 'grantId', 'color', 'recipient'])
      if (
        v[field] !== undefined &&
        (typeof v[field] !== 'string' || !/^[0-9a-f]{64}$/.test(v[field] as string))
      )
        throw new Error('Invalid public session identity.');
    if (
      v.txHash !== undefined &&
      (typeof v.txHash !== 'string' || !/^[0-9a-f]{64}(?:[0-9a-f]{2})?$/i.test(v.txHash))
    )
      throw new Error('Invalid transaction identity.');
    if (
      v.intentId !== undefined &&
      (typeof v.intentId !== 'string' ||
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v.intentId))
    )
      throw new Error('Invalid intent identity.');
    validatePendingWithdrawal(v);
    for (const field of ['cap', 'perCallCap'])
      if (
        v[field] !== undefined &&
        (typeof v[field] !== 'string' || !/^[1-9][0-9]*$/.test(v[field] as string))
      )
        throw new Error('Invalid session cap.');
    if (
      v.expiresAt !== undefined &&
      (!Number.isSafeInteger(v.expiresAt) || (v.expiresAt as number) <= 0)
    )
      throw new Error('Invalid session expiry.');
    return {
      ...v,
      ...(typeof v.txHash === 'string' && { txHash: v.txHash.toLowerCase() }),
    } as unknown as DemoSessionSnapshot;
  };
  const publicSnapshot = (snapshot: DemoSessionSnapshot) =>
    parse(Object.fromEntries(Object.entries(snapshot).filter(([field]) => allowed.has(field))));
  const metadata = () => {
    const text = storage.getItem(key);
    return text ? parse(JSON.parse(text)) : undefined;
  };
  const record = (id: string) => {
    const text = storage.getItem(prefix + id);
    if (!text) return;
    const r = JSON.parse(text) as { phase: unknown; snapshot: unknown };
    if (!r || !['pending', 'settled'].includes(String(r.phase)))
      throw new Error('Invalid intent record.');
    const snapshot = parse(r.snapshot);
    if (snapshot.intentId !== id) throw new Error('Intent record identity mismatch.');
    return { phase: r.phase, snapshot };
  };
  const writeRecord = (phase: 'pending' | 'settled', snapshot: DemoSessionSnapshot) => {
    if (!snapshot.intentId) throw new Error('Session effects need a public intent ID.');
    storage.setItem(
      prefix + snapshot.intentId,
      JSON.stringify({ phase, snapshot: publicSnapshot(snapshot) }),
    );
  };
  return {
    read(): DemoSessionSnapshot | undefined {
      try {
        // Enumerate independent rows, not an overwriteable shared pointer/index.
        const names = Array.from({ length: storage.length }, (_, i) => storage.key(i))
          .filter((name): name is string => !!name && name.startsWith(prefix))
          .sort();
        for (const name of names) {
          const row = record(name.slice(prefix.length));
          if (!row) throw new Error('Intent disappeared during observation.');
          if (row.phase === 'pending') return { ...row.snapshot, status: 'blocked' };
        }
        const display = metadata();
        if (!display?.intentId) return display;
        const row = record(display.intentId);
        // A settled tombstone wins over a late pending/blocked write from an old tab.
        return row?.phase === 'settled'
          ? { ...row.snapshot, ...(!pending(display) && { status: display.status }) }
          : display;
      } catch {
        return invalid();
      }
    },
    begin(snapshot: DemoSessionSnapshot) {
      const previous = this.read();
      if (previous && pending(previous))
        throw new Error('Reconcile the original session transaction before another effect.');
      if (!snapshot.intentId || record(snapshot.intentId))
        throw new Error('A fresh session intent is required.');
      writeRecord('pending', snapshot); // Durable before any credential/transport effect.
      storage.setItem(key, JSON.stringify(publicSnapshot(snapshot)));
    },
    write(snapshot: DemoSessionSnapshot) {
      const current = metadata();
      const row = snapshot.intentId ? record(snapshot.intentId) : undefined;
      if (row?.phase === 'settled' && pending(snapshot)) return;
      if (row?.phase === 'pending') writeRecord('pending', snapshot);
      if (current?.status === 'blocked' && !current.intentId) return; // Preserve legacy unknowns too.
      if (current?.intentId !== snapshot.intentId && current?.intentId) return;
      storage.setItem(key, JSON.stringify(publicSnapshot(snapshot)));
    },
    settle(snapshot: DemoSessionSnapshot) {
      if (pending(snapshot)) throw new Error('Cannot settle an uncertain intent.');
      const current = metadata();
      if (snapshot.intentId && record(snapshot.intentId)) writeRecord('settled', snapshot);
      if (!current?.intentId || current.intentId === snapshot.intentId)
        storage.setItem(key, JSON.stringify(publicSnapshot(snapshot)));
    },
  };
}
