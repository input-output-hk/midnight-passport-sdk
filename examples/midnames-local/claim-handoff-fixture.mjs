import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareSponsoredClaim } from '../../apps/passport-dapp/src/midnames/claim-sponsorship.ts';
import { saveIsolationReceipt } from '../../scripts/qualification/native-isolation-files.mjs';

/** Prove in the owner environment. Pass only proved bytes to the sponsor adapter. */
export async function qualifyClaimHandoff({
  output,
  registryAddress,
  accountAddress,
  regProviders,
  contracts,
  ledger,
  compiled,
  registry,
  rootId,
  owner,
  parentDomain,
  target,
  noDefault,
  price,
  fields,
  privateStateId,
  step,
}) {
  const claimant = new Uint8Array(randomBytes(32));
  const tag = Buffer.alloc(32);
  tag.write('midnight.domains');
  const label = 'charlie';
  const nameKey = new Uint8Array(32).fill(255);
  nameKey.set(new TextEncoder().encode(label));
  const { owner_address: registryPayee, payment_config: payment } = parentDomain;
  assert.ok(payment.buy_enabled);
  assert.ok(payment.coin_color.every((byte) => byte === 0));
  const quote = {
    networkId: 'undeployed',
    registryAddress,
    accountAddress,
    name: label + '.night',
    ownerCommitment: createHash('sha256').update(tag).update(claimant).digest('hex'),
    registryPayee: Buffer.from(registryPayee.bytes).toString('hex'),
    night: payment.cost_long,
  };
  let bytes;
  try {
    step('prove-claim-in-owner-environment');
    const {
      private: { unprovenTx },
    } = await contracts.createUnprovenCallTx(regProviders, {
      compiledContract: compiled(claimant),
      contractAddress: registryAddress,
      circuitId: 'create_domain',
      privateStateId,
      args: [
        owner,
        nameKey,
        BigInt(label.length),
        rootId,
        target,
        registry.AddressType.ContractAddr,
        noDefault,
        price,
        fields,
      ],
    });
    const proven = await regProviders.proofProvider.proveTx({ version: 'v9', tx: unprovenTx });
    assert.equal(proven.version, 'v9');
    bytes = proven.tx.serialize();
  } finally {
    claimant.fill(0);
  }

  step('balance-owner-proof-with-sponsor');
  const prepared = await prepareSponsoredClaim(quote, bytes, async (proved) => {
    const tx = ledger.Transaction.deserialize('signature', 'proof', 'pre-binding', proved);
    const balanced = await regProviders.walletProvider.balanceTx({ version: 'v9', tx });
    assert.equal(balanced.version, 'v9');
    return balanced.tx.serialize();
  });
  const final = ledger.Transaction.deserialize('signature', 'proof', 'binding', prepared.bytes);
  const dustSpends = [...(final.intents?.values() ?? [])].reduce(
    (sum, intent) => sum + (intent.dustActions?.spends.length ?? 0),
    0,
  );
  writeFileSync(join(output, 'claim-sponsored.private.bin'), prepared.bytes, {
    mode: 0o600,
    flag: 'wx',
  });
  saveIsolationReceipt(join(output, 'claim-handoff.json'), {
    receipt: prepared.receipt,
    quotedNight: String(quote.night),
    dustSpends,
    dispatches: 0,
  });
  return { claimPrepared: true, dustSpends, claimDispatches: 0 };
}
