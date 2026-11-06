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
  if (state.grantUnsettled) {
    const { SubmittedGrantSpendError } = await import('@input-output-hk/mn-passport-account');
    throw new SubmittedGrantSpendError(state.txHash);
  }
  return {
    txHash: state.txHash,
    grantId: handoff.grantId,
    spentTotal: BigInt(state.grant.spent),
    grantNonce: 1n,
  };
}

// Real session signature/holder guards and generated pure circuits; synthetic chain state only.
export async function spendDemoSessionGrant(
  opening: import('../../src/grant-handoff.ts').GrantHandoff,
  key: import('@input-output-hk/mn-passport-account/ports').Authoriser,
  amount: string,
  spentPrev: string,
  signal: AbortSignal,
) {
  const { spendUnshieldedWithGrant } = await import('@input-output-hk/mn-passport-account');
  const { pureCircuits: pure } =
    await import('@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1');
  const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));
  const read = async () => {
    const response = await fetch('/__demo-fixture', {
      method: 'POST',
      body: JSON.stringify({ action: 'state' }),
    });
    const state = await response.json();
    return {
      active: state.grant.active,
      issuedAt: 1n,
      nonce: BigInt(state.nonce),
      spentCommit: pure.derive_grant_spent_commit(
        bytes(opening.scopeSalt),
        BigInt(state.grant.spent),
      ),
      objectCommit: pure.derive_grant_object_commit(
        bytes(opening.scopeSalt),
        bytes(opening.color),
        1n,
        bytes(opening.recipient),
        BigInt(opening.maxCoinValue),
      ),
      withdrawUnshielded: true,
      perCallCap: BigInt(state.grant.scope.perCallCap),
      cap: BigInt(state.grant.scope.cap),
      expiresAt: BigInt(state.grant.scope.expiresAt ?? 0),
    };
  };
  return spendUnshieldedWithGrant(
    { ...opening, amount, spentPrev },
    {
      pure,
      grantee: key,
      source: { readGrantSpendContext: read },
      chain: {
        readAccount: async () => undefined,
        call: async (request) =>
          (await import('../../src/value-call.ts')).demoSessionValueCall(
            'http://localhost:8787',
            request,
          ),
      },
      review: async () => !signal.aborted,
    },
    { signal },
  );
}
