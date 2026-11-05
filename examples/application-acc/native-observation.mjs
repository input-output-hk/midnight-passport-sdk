import assert from 'node:assert/strict';

const HEX = /^[0-9a-f]{64}$/;

/** Explicitly recover this fixture's post-payment observation boundary. This is not a
 * generic job retry API: original finality and live state must be checked separately
 * before a new merchant/grant/payment intent can be created.
 * @param {{events:any[],parent:any,walletCleanup:any[],source:string}} input
 */
export function merchantContinuation(input) {
  const { events, parent, walletCleanup, source } = input;
  assert.match(source, /^[0-9a-f]{40}$/);
  assert.equal(parent.outcome, 'failed');
  assert.equal(parent.interrupted, false);
  assert.equal(parent.source.commit, source);
  assert.equal(parent.source.dirty, false);
  assert.deepEqual(parent.end, parent.source);
  assert.equal(parent.cleanup.length, 3);
  assert.ok(parent.cleanup.every((/** @type {any} */ c) => c.stopped === true));
  assert.equal(walletCleanup.length, 2);
  assert.ok(walletCleanup.every((c) => c.stopped === true));
  assert.equal(events.at(-1)?.stage, 'failed');
  assert.equal(events.at(-1)?.phase, 'confirmation');
  assert.ok(!events.some((e) => e.stage === 'merchant-credit-confirmed'));
  const one = (/** @type {string} */ stage) => {
    const rows = events.filter((e) => e.stage === stage);
    assert.equal(rows.length, 1, `Ambiguous original ${stage}`);
    return rows[0];
  };
  const account = one('account-deployed');
  const merchants = one('merchants-deployed');
  assert.equal(account.verifiedOperations, 52);
  assert.equal(account.maintenanceRetired, true);
  assert.match(account.accountAddress, HEX);
  assert.equal(merchants.accountAddress, account.accountAddress);
  for (const key of ['merchant', 'wrongMerchant', 'recipient']) assert.match(merchants[key], HEX);
  assert.notEqual(merchants.merchant, merchants.wrongMerchant);
  const retained = events.filter((e) => e.stage === 'submission-retained-before-send');
  const returned = events.filter((e) => e.stage === 'node-submit-returned');
  assert.equal(retained.length, 16);
  assert.equal(returned.length, 16);
  assert.equal(new Set(retained.map((e) => e.hash)).size, 16);
  for (let i = 0; i < retained.length; i++) {
    assert.equal(retained[i].ordinal, i + 1);
    assert.equal(returned[i].ordinal, i + 1);
    assert.match(retained[i].hash, HEX);
    assert.equal(retained[i].hash, retained[i].bytesSha256);
    assert.equal(returned[i].hash, retained[i].hash);
    assert.match(returned[i].id, /^00[0-9a-f]{64}$/);
  }
  return Object.freeze({
    account: account.accountAddress,
    originalMerchant: merchants.merchant,
    originalWrongMerchant: merchants.wrongMerchant,
    originalRecipient: merchants.recipient,
    transactions: returned.map(({ hash, id }) => ({ hash, id })),
    // Activation followed by exactly one owner-authorised grant issue.
    ownerCounter: 1n,
    expectedBalance: 8n,
  });
}

/** Reconnect only an observer, after independently confirming the original payment.
 * No sender/dispatch port exists here. A timeout never repeats a payment.
 * @template T
 * @param {{wait:()=>Promise<T>,confirm:()=>Promise<unknown>,reconnect:()=>Promise<void>,event:()=>void}} ports
 */
export async function confirmedCredit(ports) {
  try {
    return { state: await ports.wait(), reconnected: false };
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error;
    await ports.confirm();
    ports.event();
    await ports.reconnect();
    return { state: await ports.wait(), reconnected: true };
  }
}
