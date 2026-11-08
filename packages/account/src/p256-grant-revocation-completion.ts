/** Fresh owner assertion, live admission, single dispatch and observed settlement. */
import type {
  PassportGrantRevokeAllResult,
  PassportGrantRevokeResult,
  PassportTxResult,
} from '@input-output-hk/mn-passport-protocol';
import { fromHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { grantRosterFingerprint } from './grant-roster.js';
import { p256 } from './p256-device.js';
import { readP256Grant, readP256GrantRoster } from './p256-grant-revocation-plan.js';
import { sameGrantKey } from './p256-grant-revocation-types.js';
import type {
  AllGrantRevocation,
  GrantRevocationOperation,
  SignedGrantRevocation,
  SignedSingleGrantRevocation,
  SingleGrantRevocation,
} from './p256-grant-revocation-types.js';
import type { AccLedgerView, Authorisation, P256Authorisation } from './ports/index.js';

export async function selectGrantRevocationOwner(
  operation: GrantRevocationOperation,
  view: AccLedgerView,
  mismatch: string,
): Promise<bigint> {
  const { host, record, flow } = operation;
  const counter = await host.findCounter(flow, record, view);
  if (counter === undefined) throw host.notHeld(record);
  const selected = await host.authoriser.devicePublicKey();
  if (selected.x !== record.publicKey.x || selected.y !== record.publicKey.y)
    throw new PassportConnectorError('NotAuthorised', mismatch);
  return counter;
}

function checkedSignature(
  operation: GrantRevocationOperation,
  signed: Authorisation,
  counter: bigint,
): P256Authorisation {
  const { record } = operation;
  if (
    signed.scheme !== 'p256-webauthn' ||
    signed.useCounter !== counter ||
    signed.pk.x !== record.publicKey.x ||
    signed.pk.y !== record.publicKey.y
  )
    throw new PassportConnectorError('NotAuthorised', 'The signature names another device.');
  return signed;
}

export async function signSingleGrantRevocation(
  operation: GrantRevocationOperation,
  prepared: SingleGrantRevocation,
  counter: bigint,
): Promise<SignedSingleGrantRevocation> {
  const { host, record, flow } = operation;
  const { pure, grantId, view } = prepared;
  const id = fromHex(grantId);
  const signed = await flow.step('passkey.sign', () => {
    // This optional method is deliberately resolved after the step's start observer.
    const challenge = pure.challenge_revoke_grant_with_p256;
    if (!challenge) throw new TypeError('pure.challenge_revoke_grant_with_p256 is not a function');
    return host.authoriser.authorise({
      account: record.address,
      circuit: 'revoke_grant_with_p256',
      args: [id],
      witnessValues: [],
      authNonce: view.authNonce,
      useCounter: counter,
      challenge: challenge.call(
        pure,
        { bytes: fromHex(record.address) },
        p256(record.publicKey),
        id,
        view.authNonce,
      ),
      credentialId: record.credentialId,
    });
  });
  return { counter, signed: checkedSignature(operation, signed, counter), id };
}

export async function signAllGrantRevocation(
  operation: GrantRevocationOperation,
  prepared: AllGrantRevocation,
  counter: bigint,
): Promise<SignedGrantRevocation> {
  const { host, record, flow } = operation;
  const { view } = prepared;
  const pure = (await host.binding()).pureCircuits;
  if (!pure.challenge_revoke_all_grants_with_p256)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'The binding lacks P-256 grant challenges.',
    );
  const challenge = pure.challenge_revoke_all_grants_with_p256(
    { bytes: fromHex(record.address) },
    p256(record.publicKey),
    view.authNonce,
  );
  const signed = await flow.step('passkey.sign', () =>
    host.authoriser.authorise({
      account: record.address,
      circuit: 'revoke_all_grants_with_p256',
      args: [],
      witnessValues: [],
      authNonce: view.authNonce,
      useCounter: counter,
      challenge,
      credentialId: record.credentialId,
    }),
  );
  return { counter, signed: checkedSignature(operation, signed, counter) };
}

export async function recheckSingleGrantRevocation(
  operation: GrantRevocationOperation,
  prepared: SingleGrantRevocation,
) {
  const { host, record, flow } = operation;
  const { grantId, grant, view, rotated } = prepared;
  const latest = await flow.step('grant.roster', () => readP256Grant(operation, grantId));
  const current = await host.readView(flow, record);
  if (
    !latest?.active ||
    latest.read !== grant.read ||
    latest.authNonce !== view.authNonce ||
    current.authNonce !== view.authNonce ||
    current.deviceEpoch !== view.deviceEpoch ||
    (rotated && (!current.encKey || !sameGrantKey(current.encKey, rotated.encKey)))
  )
    throw new PassportConnectorError(
      'GrantRosterUnsettled',
      'The grant changed before submission.',
    );
}

export async function recheckAllGrantRevocation(
  operation: GrantRevocationOperation,
  prepared: AllGrantRevocation,
) {
  const { host, record, flow } = operation;
  const { roster, baseline, view, rotated } = prepared;
  const latest = await flow.step('grant.roster', () => readP256GrantRoster(operation));
  const current = await host.readView(flow, record);
  if (
    latest.authNonce !== view.authNonce ||
    current.authNonce !== view.authNonce ||
    (rotated && (!current.encKey || !sameGrantKey(current.encKey, rotated.encKey))) ||
    latest.generation !== roster.generation ||
    grantRosterFingerprint(latest) !== baseline
  )
    throw new PassportConnectorError('GrantRosterUnsettled', 'The grant roster changed.');
}

function proof(operation: GrantRevocationOperation, approval: SignedGrantRevocation) {
  const { record } = operation;
  const { counter, signed } = approval;
  return {
    pk: p256(record.publicKey),
    policy: record.policy,
    authenticator_data: signed.authenticatorData,
    sig: signed.sig,
    use_counter: counter,
  };
}

export async function submitSingleGrantRevocation(
  operation: GrantRevocationOperation,
  approval: SignedSingleGrantRevocation,
): Promise<PassportTxResult> {
  const { host, record, flow } = operation;
  flow.checkpoint();
  return (await host.chain()).call({
    address: record.address,
    circuit: 'revoke_grant_with_p256',
    args: [approval.id, proof(operation, approval)],
    ...flow.ports,
  });
}

export async function submitAllGrantRevocation(
  operation: GrantRevocationOperation,
  approval: SignedGrantRevocation,
): Promise<PassportTxResult> {
  const { host, record, flow } = operation;
  flow.checkpoint();
  return (await host.chain()).call({
    address: record.address,
    circuit: 'revoke_all_grants_with_p256',
    args: [proof(operation, approval)],
    ...flow.ports,
  });
}

export async function settleSingleGrantRevocation(
  operation: GrantRevocationOperation,
  prepared: SingleGrantRevocation,
  approval: SignedSingleGrantRevocation,
  tx: PassportTxResult,
): Promise<PassportGrantRevokeResult> {
  const { host, flow } = operation;
  const { grantId, view, rotation } = prepared;
  for (let attempt = 0; attempt < 30; attempt++) {
    flow.checkpoint();
    const settled = await flow.step('grant.roster', () => readP256Grant(operation, grantId));
    if (settled && !settled.active && settled.authNonce > view.authNonce)
      return {
        ...tx,
        grantId,
        status: 'revoked',
        nextUseCounter: approval.counter + 1n,
        ...(rotation && { rotation }),
      };
    if (attempt < 29) await host.sleep(1000);
  }
  throw new PassportConnectorError(
    'GrantRosterUnsettled',
    'The submitted grant revocation did not settle.',
  );
}

export async function settleAllGrantRevocation(
  operation: GrantRevocationOperation,
  prepared: AllGrantRevocation,
  approval: SignedGrantRevocation,
  tx: PassportTxResult,
): Promise<PassportGrantRevokeAllResult> {
  const { host, flow } = operation;
  const { roster, view, rotation } = prepared;
  const generation = (roster.generation + 1n) & ((1n << 32n) - 1n);
  await flow.step('grant.roster', async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      flow.checkpoint();
      const settled = await readP256GrantRoster(operation);
      grantRosterFingerprint(settled);
      if (
        settled.authNonce > view.authNonce &&
        settled.generation === generation &&
        settled.entries.length === 0
      )
        return;
      if (attempt < 29) await host.sleep(1000);
    }
    throw new PassportConnectorError(
      'GrantRosterUnsettled',
      'The submitted revoke-all did not clear the live ACC grant map.',
    );
  });
  return {
    ...tx,
    status: 'cleared',
    generation,
    nextUseCounter: approval.counter + 1n,
    ...(rotation && { rotation }),
  };
}
