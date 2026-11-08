// Injected time and synthetic failures protect intentionally asymmetric readiness boundaries.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readinessFixture, readinessHost } from './fixtures/overnight-p256-readiness-fixture.mjs';
import { startFlow } from '../packages/account/dist/flow.js';
import { recordDeployedHint } from '../packages/account/dist/p256-activation.js';
import { observeSealedAccount } from '../packages/account/dist/p256-sealed-reader.js';

for (const missing of ['account', 'boot', 'nonce']) {
  test(`raw sealed observation retains 30 reads and 30 sleeps for unchanged ${missing}`, async () => {
    const f = readinessFixture();
    await f.create();
    const record = f.hint();
    const view = await f.chain.readAccount(record.address, { includeInbox: true });
    assert.ok(view);
    const host = { ...readinessHost(f) };
    let reads = 0;
    host.chain = async () => ({
      call: async () => {
        throw new Error('observation cannot submit');
      },
      async readAccount(address, options) {
        assert.equal(address, record.address);
        assert.deepEqual(options, { includeInbox: true });
        reads++;
        return missing === 'account' ? undefined : { ...view, booted: false };
      },
    });
    const events = f.events.length;
    await assert.rejects(
      observeSealedAccount(host, record, (candidate) =>
        missing === 'boot' ? candidate.booted : candidate.authNonce > view.authNonce,
      ),
      {
        code: 'InternalError',
        message: 'The sealed ACC call did not appear on chain.',
      },
    );
    assert.equal(reads, 30);
    assert.deepEqual(host.sleeps, Array(30).fill(1000));
    assert.equal(f.events.length, events, 'raw polling adds no Flow steps or checkpoints');
  });
}

test('the thirtieth raw observation can succeed, with only 29 sleeps', async () => {
  const f = readinessFixture();
  await f.create();
  const record = f.hint();
  const view = await f.chain.readAccount(record.address, { includeInbox: true });
  assert.ok(view);
  const host = { ...readinessHost(f) };
  let reads = 0;
  host.chain = async () => ({
    call: async () => {
      throw new Error('no send');
    },
    readAccount: async () => (++reads === 30 ? view : undefined),
  });
  assert.equal(await observeSealedAccount(host, record, () => true), view);
  assert.equal(reads, 30);
  assert.equal(host.sleeps.length, 29);
});

for (const failures of [3, 4]) {
  test(`deployed persistence makes four total attempts despite abort (${failures} failures)`, async () => {
    const f = readinessFixture();
    f.fault.boundary = 'activate:before';
    await assert.rejects(f.create(), { code: f.unknown.code, message: f.unknown.message });
    const record = f.hint();
    const host = { ...readinessHost(f) };
    let puts = 0;
    const cause = new Error('original unavailable registry');
    host.directory = {
      get: async () => record,
      async put(network, hint) {
        puts++;
        assert.equal(network, host.networkId);
        assert.equal(hint, record);
        if (puts <= failures) throw cause;
      },
    };
    f.controller.abort('deployed but caller closed');
    const flow = startFlow(f.options, f.fake.random);
    const before = f.events.length;
    if (failures === 3) await recordDeployedHint(host, flow, record, 3);
    else
      await assert.rejects(recordDeployedHint(host, flow, record, 3), (error) => {
        assert.ok(error instanceof Error && 'code' in error);
        // Flow.step retains the existing abort taxonomy while preserving the original cause chain.
        assert.equal(error.code, 'Aborted');
        return true;
      });
    assert.equal(puts, 4);
    assert.deepEqual(host.sleeps, [200, 400, 800]);
    assert.deepEqual(
      f.events.slice(before).map((event) => [event.step, event.phase]),
      [
        ['directory.write', 'start'],
        ['directory.write', failures === 3 ? 'end' : 'error'],
      ],
    );
  });
}

test('exhausted deployed persistence keeps the address and original failure cause', async () => {
  const f = readinessFixture();
  f.fault.boundary = 'activate:before';
  await assert.rejects(f.create(), { code: f.unknown.code, message: f.unknown.message });
  const record = f.hint();
  const host = { ...readinessHost(f) };
  const cause = new Error('registry missing');
  host.directory = {
    get: async () => record,
    put: async () => {
      throw cause;
    },
  };
  await assert.rejects(
    recordDeployedHint(host, startFlow({}, f.fake.random), record, 3),
    (error) => {
      assert.ok(error instanceof Error && 'code' in error);
      assert.equal(error.code, 'InternalError');
      assert.equal(
        error.message,
        `The account at ${record.address} is deployed, but the registry did not record it after 4 attempts: registry missing`,
      );
      assert.equal(error.cause, cause);
      return true;
    },
  );
});

test('abort after acknowledged deploy still records original salt before refusing activation', async () => {
  const f = readinessFixture();
  f.fault.abortDeploy = true;
  await assert.rejects(f.create(), { code: 'Aborted' });
  assert.equal(f.fake.ledger.size, 1);
  assert.equal(f.hint().status, 'deployed');
  assert.equal(f.hint().salt?.length, 32);
  assert.equal(f.hint().keyEntries?.length, 2);
  assert.deepEqual(f.calls, []);
  assert.equal(f.trace.filter((entry) => entry === 'directory:deployed').length, 1);
});

test('raw final local write retains its acknowledgement after abort without a new checkpoint', async () => {
  const f = readinessFixture();
  const original = f.ports.records;
  assert.ok(original);
  Object.assign(f.ports, {
    records: {
      ...original,
      async write(/** @type {Parameters<typeof original.write>[0]} */ record) {
        await original.write(record);
        f.controller.abort('record acknowledged');
      },
    },
  });
  const account = await f.create();
  assert.equal(f.controller.signal.aborted, true);
  assert.equal(account.address, f.hint().address);
  assert.equal((await original.read())?.address, account.address);
  assert.equal(
    f.events.some((event) => String(event.step) === 'record.write'),
    false,
  );
});
