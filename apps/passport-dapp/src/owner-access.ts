import type { PassportAccount, FlowOptions } from '@input-output-hk/mn-passport-protocol';
import type { AuthenticatedJubjubOwner } from '@input-output-hk/mn-passport-keys';

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Verify an existing owner first. Bootstrap a P-256 companion only after explicit review. */
export async function authenticateOwnerAccount(input: {
  primary: PassportAccount;
  owner: AuthenticatedJubjubOwner;
  open(): Promise<PassportAccount>;
  confirm(publicKey: string, readerPublicKey: string): Promise<boolean>;
  storage: Storage;
  options?: FlowOptions;
  trace(kind: string, details: Record<string, unknown>): void;
}) {
  const { primary, owner, storage } = input;
  if (
    owner.context.account !== primary.address ||
    owner.context.networkId !== primary.networkId ||
    owner.context.bindingId !== primary.bindingId
  )
    throw new Error('Authenticated owner context mismatch.');
  const key = `passport-demo:owner-enrollment:v1:${primary.networkId}:${primary.bindingId}:${primary.address}:${owner.publicKey}`;
  const raw = storage.getItem(key);
  let previous:
    | {
        state: string;
        attemptId: string;
        publicKey: string;
        readerPublicKey: string;
        txHash?: string;
        rotationTxHash?: string;
        commitmentHex?: string;
      }
    | undefined;
  if (raw) {
    try {
      previous = JSON.parse(raw);
    } catch {
      throw new Error('The owner enrollment record is corrupt; inspect Audit before retrying.');
    }
    if (
      !previous ||
      !['pending', 'verified'].includes(previous.state) ||
      typeof previous.attemptId !== 'string' ||
      previous.publicKey !== owner.publicKey ||
      previous.readerPublicKey !== owner.readerPublicKey
    )
      throw new Error('The owner enrollment record is corrupt; inspect Audit before retrying.');
    previous = {
      state: previous.state,
      attemptId: previous.attemptId,
      publicKey: previous.publicKey,
      readerPublicKey: previous.readerPublicKey,
      ...(typeof previous.txHash === 'string' && { txHash: previous.txHash }),
      ...(typeof previous.rotationTxHash === 'string' && {
        rotationTxHash: previous.rotationTxHash,
      }),
      ...(typeof previous.commitmentHex === 'string' && { commitmentHex: previous.commitmentHex }),
    };
  }
  const verify = async () => {
    owner.check();
    const account = await input.open();
    owner.check();
    if (
      account.address !== primary.address ||
      account.networkId !== primary.networkId ||
      account.bindingId !== primary.bindingId ||
      account.scheme !== 'jubjub-schnorr'
    )
      throw new Error('The authenticated owner opened a different account or binding.');
    return account;
  };
  try {
    const account = await verify();
    if (previous?.state === 'pending') {
      storage.setItem(key, JSON.stringify({ ...previous, state: 'verified' }));
      input.trace('owner.enrollment.reconciled', {
        attemptId: previous.attemptId,
        accountAddress: primary.address,
        publicKey: owner.publicKey,
      });
    }
    return account;
  } catch (error) {
    if ((error as { code?: string })?.code !== 'NotAuthorised') throw error;
  }
  owner.check();
  if (primary.scheme !== 'p256-webauthn' || !primary.addDevice)
    throw new Error('The deterministic JubJub key is not an enrolled owner of this account.');
  if (previous) {
    if (previous.state !== 'verified')
      throw new Error(
        'An earlier owner enrollment needs reconciliation. Do not submit a replacement enrollment.',
      );
  }
  if (!(await input.confirm(owner.publicKey, owner.readerPublicKey)))
    throw new Error('Owner enrollment declined before submission.');
  owner.check();
  const attemptId = crypto.randomUUID();
  const record = {
    state: 'pending',
    attemptId,
    publicKey: owner.publicKey,
    readerPublicKey: owner.readerPublicKey,
  };
  storage.setItem(key, JSON.stringify(record));
  input.trace('owner.enrollment.prepared', {
    attemptId,
    accountAddress: primary.address,
    publicKey: owner.publicKey,
  });
  const result = await primary.addDevice(
    { devicePublicKey: owner.publicKey, readerPublicKey: owner.readerPublicKey },
    input.options,
  );
  storage.setItem(
    key,
    JSON.stringify({
      ...record,
      txHash: result.txHash,
      ...(result.rotationTxHash && { rotationTxHash: result.rotationTxHash }),
      commitmentHex: result.commitmentHex,
    }),
  );
  // A confirmation alone does not authenticate this browser: verify its live entry and inbox.
  input.trace('owner.enrollment.confirmed', {
    attemptId,
    txHash: result.txHash,
    ...(result.rotationTxHash && { rotationTxHash: result.rotationTxHash }),
    commitmentHex: result.commitmentHex,
  });
  const account = await verify();
  storage.setItem(
    key,
    JSON.stringify({
      ...record,
      state: 'verified',
      txHash: result.txHash,
      ...(result.rotationTxHash && { rotationTxHash: result.rotationTxHash }),
      commitmentHex: result.commitmentHex,
    }),
  );
  return account;
}

/** Keep existing account identity; select the authenticated owner at each checked method use. */
export function routeAuthenticatedAccount(
  primary: PassportAccount,
  selected: () => PassportAccount | undefined,
  check: () => void,
): PassportAccount {
  return new Proxy(primary, {
    get(target, property) {
      // These methods read public ledger data only. They need no owner material and
      // remain available to reconcile an already submitted effect after local lock.
      if (['state', 'deviceRoster', 'grantRoster'].includes(String(property))) {
        const read = Reflect.get(target, property);
        return typeof read === 'function' ? read.bind(target) : read;
      }
      const current = selected() ?? target;
      const value = Reflect.get(current, property);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        check();
        const current = selected() ?? target;
        const operation = Reflect.get(current, property);
        if (typeof operation !== 'function')
          throw new Error('This owner cannot perform the requested operation.');
        return Reflect.apply(operation, current, args);
      };
    },
  });
}
