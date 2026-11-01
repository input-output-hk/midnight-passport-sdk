// Loaded only inside a checked external consumer. No handler/request reply is mocked.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRemotePasskeySigner, createRemotePassportSeams } from '@laceio/sdk/experimental';
import { createSignerWindowPair, SIGNER_DAPP_ORIGIN, SIGNER_URL } from './signer-windows.mjs';
const { of, defer } = createRequire(import.meta.resolve('@laceio/sdk/experimental'))('rxjs');
const digest = (value) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_, v) =>
        typeof v === 'bigint'
          ? `${v}n`
          : v instanceof Uint8Array
            ? { bytes: Buffer.from(v).toString('hex') }
            : v,
      ) ?? 'undefined',
    )
    .digest('hex');

export async function createPublicSignerHarness({
  source,
  owner,
  root,
  forbiddenSecrets = [],
  timers,
  sessionTimeoutMs = 300000,
}) {
  const windows = createSignerWindowPair();
  const requests = [],
    approvals = [],
    origins = [];
  let decision = 'approve',
    allowed = true,
    expired = 0,
    revision = 0;
  const collections = new Map();
  if (root) mkdirSync(join(root, 'signer-storage-history'), { mode: 0o700 });
  const persist = () => {
    if (!root) return;
    const record = JSON.stringify([...collections].map(([name, map]) => [name, [...map]])) + '\n';
    writeFileSync(
      join(root, 'signer-storage-history', String(++revision).padStart(4, '0') + '.json'),
      record,
      { flag: 'wx', mode: 0o600 },
    );
    writeFileSync(join(root, 'signer-storage.private.next'), record, { flag: 'wx', mode: 0o600 });
    renameSync(
      join(root, 'signer-storage.private.next'),
      join(root, 'signer-storage.private.json'),
    );
  };
  const createKeyValueStorage = ({ collectionId }) => {
    let values = collections.get(collectionId);
    if (!values) {
      values = new Map();
      collections.set(collectionId, values);
    }
    return {
      getValues: (keys) =>
        defer(() => {
          const found = keys.map((key) => values.get(key));
          return found.includes(undefined) ? of() : of(structuredClone(found));
        }),
      setValue: (key, value) =>
        defer(() => {
          if (value === undefined) values.delete(key);
          else values.set(key, structuredClone(value));
          persist();
          return of(undefined);
        }),
    };
  };
  const handlers = source.createPassportSignerHandlers({
    keySource: owner,
    createKeyValueStorage,
    sessionTimeoutMs,
    onSessionExpired: () => expired++,
    ...(timers ? { timers } : {}),
  });
  const raw = createRemotePasskeySigner({ signerUrl: SIGNER_URL, host: windows.dappHost });
  const scan = (value) => {
    const text =
      JSON.stringify(value, (_, v) =>
        typeof v === 'bigint'
          ? `${v}n`
          : v instanceof Uint8Array
            ? Buffer.from(v).toString('hex')
            : v,
      ) ?? '';
    for (const secret of forbiddenSecrets) {
      assert.equal(
        text.toLowerCase().includes(secret.toLowerCase()),
        false,
        'PRF secret crossed the signer protocol',
      );
      const array = JSON.stringify([...Buffer.from(secret, 'hex')]);
      assert.equal(text.includes(array), false, 'PRF bytes crossed the signer protocol');
    }
  };
  const client = {
    ...raw,
    request: async (kind, payload) => {
      scan(payload);
      const record = { kind, payloadSha256: digest(payload) };
      requests.push(record);
      try {
        const result = await raw.request(kind, payload);
        scan(result);
        Object.assign(record, { outcome: 'completed', resultSha256: digest(result) });
        return result;
      } catch (error) {
        Object.assign(record, {
          outcome: 'failed',
          code: typeof error?.code === 'string' ? error.code : error?.name,
        });
        throw error;
      }
    },
  };
  raw.open();
  const stop = source.serveSignerRequests({
    handlers,
    host: windows.signerHost,
    rpId: 'localhost',
    assertOriginAllowed: (kind, origin) => {
      origins.push({ kind, origin });
      assert.equal(origin, SIGNER_DAPP_ORIGIN);
      if (!allowed) throw Object.assign(Error('Origin denied'), { code: 'origin-denied' });
    },
    onRequest: async (request, origin) => {
      approvals.push(
        structuredClone({ kind: request.kind, flow: request.payload?.flow, origin, decision }),
      );
      return decision;
    },
  });
  await raw.connect();
  const seams = createRemotePassportSeams(client);
  const stats = () => ({
    requests: structuredClone(requests),
    approvals: structuredClone(approvals),
    origins: structuredClone(origins),
    expired,
    storageRevisions: revision,
    listenerCounts: windows.listenerCounts(),
  });
  return {
    seams,
    client,
    windows,
    stats,
    setDecision: (value) => {
      assert.ok(['approve', 'reject'].includes(value));
      decision = value;
    },
    setOriginAllowed: (value) => {
      allowed = value;
    },
    readRecord: () =>
      source
        .toAccountRecords(
          source.createAccountRecordStore(createKeyValueStorage, () => owner.recordKey()),
        )
        .read(),
    storageSnapshot: () => structuredClone([...collections].map(([name, map]) => [name, [...map]])),
    async close() {
      try {
        await handlers['flow-close'](
          { outcome: 'failed', code: 'qualification-stop' },
          SIGNER_DAPP_ORIGIN,
        );
      } catch {}
      raw.close();
      stop();
      assert.deepEqual(windows.listenerCounts(), { dapp: 0, signer: 0 });
    },
  };
}
