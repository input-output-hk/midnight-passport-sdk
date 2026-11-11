import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  claimReceipt,
  claimReceiptLimit,
  type ClaimReceipt,
} from '../../apps/passport-dapp/src/midnames/claim-receipt.ts';
import { createOnce } from './create-once.mts';

const maxTransaction = 1024 * 1024;
const maxRecord = 2 * maxTransaction + claimReceiptLimit;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sameReceipt = (a: ClaimReceipt, b: ClaimReceipt) => JSON.stringify(a) === JSON.stringify(b);

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function readRecord(path: string, limit: number): unknown {
  let file: number;
  try {
    file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw error;
  }
  try {
    const stat = fstatSync(file);
    if (
      !stat.isFile() ||
      (stat.mode & 0o077) !== 0 ||
      stat.uid !== process.getuid?.() ||
      stat.size <= 0 ||
      stat.size > limit
    )
      throw new Error('Invalid claim journal file.');
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } finally {
    closeSync(file);
  }
}

function checkBytes(bytes: Uint8Array, receipt: ClaimReceipt): void {
  if (
    !bytes.length ||
    bytes.length > maxTransaction ||
    sha256(bytes) !== receipt.transaction.sha256
  )
    throw new Error('Claim journal transaction differs from its receipt.');
}

function loadPrepared(path: string) {
  const row = readRecord(path, maxRecord);
  if (!row || typeof row !== 'object' || !('receipt' in row) || !('bytes' in row))
    throw new Error('No original prepared claim to dispatch.');
  const receipt = claimReceipt(row.receipt);
  const hex = row.bytes;
  if (
    typeof hex !== 'string' ||
    hex.length > 2 * maxTransaction ||
    hex.length % 2 !== 0 ||
    !/^[0-9a-f]+$/.test(hex)
  )
    throw new Error('Invalid prepared claim bytes.');
  const bytes = Buffer.from(hex, 'hex');
  checkBytes(bytes, receipt);
  return { bytes, receipt };
}

export interface ClaimDispatchPorts {
  /** Read-only check of live policy, exact Ledger identifiers, and fee admission before fencing. */
  authorize(bytes: Uint8Array, receipt: ClaimReceipt): Promise<void>;
  submit(bytes: Uint8Array): Promise<void>;
}

/** A private directory holds one original standalone claim and its one-shot dispatch fence. */
export function openClaimDispatch(directory: string) {
  const stat = lstatSync(directory);
  if (
    !isAbsolute(directory) ||
    realpathSync(directory) !== directory ||
    !stat.isDirectory() ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid?.()
  )
    throw new Error('Claim journal requires a private owned directory.');
  const preparedPath = join(directory, 'claim-prepared.private.json');
  const fencePath = join(directory, 'claim-dispatch-fence.json');

  function fenced(receipt: ClaimReceipt): boolean {
    const value = readRecord(fencePath, claimReceiptLimit);
    if (value === undefined) return false;
    if (!sameReceipt(claimReceipt(value), receipt))
      throw new Error('Claim dispatch fence differs from the original receipt.');
    return true;
  }

  return {
    retain(bytes: Uint8Array, original: ClaimReceipt): void {
      const receipt = claimReceipt(original);
      checkBytes(bytes, receipt);
      const copy = Buffer.from(bytes);
      createOnce(preparedPath, JSON.stringify({ bytes: copy.toString('hex'), receipt }));
    },

    /** Receipt acknowledgement and current sponsor admission precede the irreversible fence. */
    async dispatch(acknowledged: ClaimReceipt, ports: ClaimDispatchPorts) {
      const expected = claimReceipt(acknowledged);
      const { bytes, receipt } = loadPrepared(preparedPath);
      if (!sameReceipt(expected, receipt)) throw new Error('Claim acknowledgement differs.');
      const pending = { status: 'pending' as const, receipt };
      if (fenced(receipt)) return pending;

      await ports.authorize(new Uint8Array(bytes), claimReceipt(receipt));
      try {
        createOnce(fencePath, JSON.stringify(receipt));
      } catch (error) {
        if (hasCode(error, 'EEXIST') && fenced(receipt)) return pending;
        throw error;
      }
      // After the fence, only reads can establish the outcome of this original.
      try {
        await ports.submit(new Uint8Array(bytes));
      } catch {
        return pending;
      }
      return pending;
    },
  };
}
