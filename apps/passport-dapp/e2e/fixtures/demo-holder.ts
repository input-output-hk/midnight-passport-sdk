// Actual handoff parser/credential API and UI review, with a synthetic grant/chain driver.
import { webauthnPasskey } from '@input-output-hk/mn-passport-adapter-webauthn';
import { beforeDemoCeremony } from '../../src/consent.ts';
import { parseGrantHandoff } from '../../src/grant-handoff.ts';
export async function spendDemoGrant(
  text: string,
  network: string,
  amount: string,
  _spent: string,
  review: (fields: {
    account: string;
    grantId: string;
    color: string;
    amount: string;
    recipient: string;
    remainingCap: string;
  }) => Promise<boolean>,
) {
  const handoff = parseGrantHandoff(text, network);
  const keys = webauthnPasskey({
    rpId: 'localhost',
    origin: 'http://localhost:5173',
    beforeCeremony: beforeDemoCeremony,
  });
  await keys.credentials.identify();
  await keys.prf.withSession(async () => {
    (await keys.prf.deviceSecret()).fill(0);
  });
  if (!(await review({ ...handoff, amount, remainingCap: handoff.cap })))
    throw new Error('Spend declined');
  const response = await fetch('/__demo-fixture', {
    method: 'POST',
    body: JSON.stringify({ action: 'spend', amount }),
  });
  if (!response.ok) throw new Error('Synthetic grant refused');
  const state = await response.json();
  return {
    txHash: state.txHash,
    grantId: handoff.grantId,
    spentTotal: BigInt(state.grant.spent),
    grantNonce: 1n,
  };
}
