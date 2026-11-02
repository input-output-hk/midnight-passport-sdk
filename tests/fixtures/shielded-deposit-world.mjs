// Synthetic restart world: real randomized sealing/encrypted disk journal, fake sender/finality.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { encryptedShieldedDepositJournal, sealInboxCoin } from '../../packages/keys/dist/index.js';
import { fileMutationByteStore } from '../../packages/service/dist/index.js';
import { fromHex, toHex } from '../../packages/account/dist/index.js';
export const depositRequest = {
  account: 'ab'.repeat(32),
  requestId: '12345678-1234-1234-1234-123456789abc',
  color: new Uint8Array(32).fill(2),
  nonce: new Uint8Array(32).fill(3),
  amount: 27n,
};
export const depositPins = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77'.repeat(32),
};
/** @param {string} root @param {string} [mode] */
export function depositWorld(root, mode = 'normal') {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const source = {
    deviceSecret: async () => {
      throw Error('No device signing key required by deposit journal');
    },
    withSession: async (/** @type {()=>Promise<any>} */ action) => action(),
    deriveSecret: async (/** @type {{domain:string,context:string}} */ p) =>
      sha256(utf8ToBytes('public-synthetic-deposit-test-only:' + p.domain + ':' + p.context)),
  };
  const journal = encryptedShieldedDepositJournal(
    depositPins,
    source,
    fileMutationByteStore(join(root, 'journal')),
  );
  const ledgerPath = join(root, 'ledger.json'),
    senderPath = join(root, 'sender.json');
  const readLedger = () => JSON.parse(readFileSync(ledgerPath, 'utf8'));
  /** @param {unknown} value */ const writeLedger = (value) =>
    writeFileSync(ledgerPath, JSON.stringify(value), { mode: 0o600 });
  if (!existsSync(ledgerPath))
    writeLedger({
      encKey: toHex(x25519.getPublicKey(new Uint8Array(32).fill(9))),
      entries: ['11'.repeat(192), '22'.repeat(192)],
    });
  let clock = 0,
    reads = 0,
    seals = 0,
    sends = 0,
    reconciles = 0,
    confirmations = 0;
  let visible = true,
    finalized = true;
  const instrumentedJournal = {
    read: journal.read,
    compareAndSwap: async (
      /** @type {string} */ id,
      /** @type {number|undefined} */ previous,
      /** @type {import('../../packages/account/dist/index.js').ShieldedDepositDocument} */ next,
    ) => {
      if (mode === 'submitted-write-exit' && next.phase === 'submitted') process.exit(75);
      const accepted = await journal.compareAndSwap(id, previous, next);
      if (accepted && mode === 'prepared-exit' && next.phase === 'prepared') process.exit(74);
      if (accepted && mode === 'confirmed-reply-exit' && next.phase === 'confirmed')
        process.exit(76);
      return accepted;
    },
  };
  /** @type {import('../../packages/account/dist/index.js').RecoverableShieldedDepositPorts} */
  const ports = {
    chain: {
      readAccount: async () => {
        reads++;
        const l = readLedger();
        return {
          specVersion: 3,
          booted: true,
          authNonce: 0n,
          deviceEpoch: 0n,
          entryCount: 1,
          hasEntry: () => true,
          encKey: fromHex(l.encKey),
          inboxEntries: l.entries.map(fromHex),
        };
      },
    },
    sealCoin: async (key, coin) => {
      seals++;
      return sealInboxCoin(key, coin);
    },
    sender: {
      depositShielded: async (call) => {
        sends++;
        const request = {
          requestId: call.requestId,
          account: call.account,
          coin: {
            nonce: toHex(call.coin.nonce),
            color: toHex(call.coin.color),
            value: call.coin.value.toString(),
          },
          entry: toHex(call.entry),
          intentSha256: call.intentSha256,
        };
        if (existsSync(senderPath)) {
          const prior = JSON.parse(readFileSync(senderPath, 'utf8'));
          assert.deepEqual(prior.request, request);
          return { txId: prior.txId };
        }
        const saved = { request, txId: 'tx-original', effects: 1 };
        writeFileSync(senderPath, JSON.stringify(saved), { flag: 'wx', mode: 0o600 });
        if (visible) {
          const l = readLedger();
          l.entries.push(request.entry);
          writeLedger(l);
        }
        if (mode === 'send-exit') process.exit(73);
        return { txId: saved.txId };
      },
    },
    recovery: {
      pins: depositPins,
      journal: instrumentedJournal,
      reconcileSender: async (intent, digest) => {
        reconciles++;
        if (!existsSync(senderPath)) return { kind: 'unknown' };
        const saved = JSON.parse(readFileSync(senderPath, 'utf8'));
        assert.equal(saved.request.entry, intent.entry);
        assert.equal(saved.request.intentSha256, digest);
        return { kind: 'submitted', intentSha256: digest, txId: saved.txId };
      },
      confirmTransaction: async ({ intent, intentSha256, txId, inboxIndex }) => {
        confirmations++;
        if (!finalized || !existsSync(senderPath)) return false;
        const saved = JSON.parse(readFileSync(senderPath, 'utf8'));
        return (
          saved.request.intentSha256 === intentSha256 &&
          saved.txId === txId &&
          saved.request.entry === intent.entry &&
          readLedger().entries[inboxIndex] === intent.entry
        );
      },
    },
    pollMs: 1,
    confirmationMs: 2,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  };
  return {
    ports,
    journal,
    readLedger,
    writeLedger,
    source,
    stats: () => ({
      reads,
      seals,
      sends,
      reconciles,
      confirmations,
      effects: existsSync(senderPath) ? JSON.parse(readFileSync(senderPath, 'utf8')).effects : 0,
    }),
    visible: (/** @type {boolean} */ value) => {
      visible = value;
    },
    finalized: (/** @type {boolean} */ value) => {
      finalized = value;
    },
  };
}
