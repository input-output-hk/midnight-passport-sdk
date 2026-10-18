import {
  spendUnshieldedWithGrant,
  checkUnshieldedGrant,
  type UnshieldedGrantCallPure,
  type UnshieldedGrantSpendResult,
} from '@input-output-hk/mn-passport-account';
import { createMidnightGrantSource } from '@input-output-hk/mn-passport-adapter-midnight-js';
import { fetchCheckedV1Config } from '@input-output-hk/mn-passport-adapter-service';
import { webauthnPasskey } from '@input-output-hk/mn-passport-adapter-webauthn';
import {
  recipeJubjubAuthoriser,
  type JubjubDeviceCircuits,
} from '@input-output-hk/mn-passport-keys';
import { accModule } from './acc-module.js';
import { demoValueCall } from './value-call.js';
import { parseGrantHandoff } from './grant-handoff.js';
import { BINDING_ID, MANIFEST_SHA256, ORIGIN, RP_ID, SERVICE_URL } from './connector.js';
import { tracedFetch } from './operation-trace.js';

/** A holder never opens the owner ACC; its own passkey signs the scoped grant challenge. */
export async function spendDemoGrant(
  text: string,
  networkId: string,
  amount: string,
  spentPrev: string,
  review: (fields: {
    account: string;
    grantId: string;
    color: string;
    amount: string;
    recipient: string;
    remainingCap: string;
  }) => Promise<boolean>,
  credentials?: CredentialsContainer,
): Promise<UnshieldedGrantSpendResult> {
  const handoff = parseGrantHandoff(text, networkId);
  if (!/^[1-9][0-9]*$/.test(amount) || !/^(0|[1-9][0-9]*)$/.test(spentPrev))
    throw new Error('Enter canonical positive amount and prior spent total.');
  const config = await fetchCheckedV1Config(
    SERVICE_URL,
    {
      networkId,
      bindingId: BINDING_ID,
      manifestSha256: MANIFEST_SHA256,
      artefactUrl: `${SERVICE_URL}/v1/zk/${BINDING_ID}`,
    },
    { fetch: tracedFetch },
  );
  const source = createMidnightGrantSource({
    network: {
      networkId,
      bindingId: BINDING_ID,
      indexerUrl: config.indexerUri,
      indexerWsUrl: config.indexerWsUri,
    },
    binding: accModule,
    openings: { readReadPublicKey: async () => undefined },
  });
  const pure = accModule.pureCircuits;
  const capabilities = pure as unknown as Record<string, unknown>;
  if (
    typeof pure.compute_public_point_with_jubjub !== 'function' ||
    typeof pure.derive_device_entry_with_jubjub !== 'function' ||
    typeof capabilities.derive_grant_spent_commit !== 'function' ||
    typeof capabilities.challenge_withdraw_unshielded_with_grant_jubjub !== 'function' ||
    typeof capabilities.derive_grant_id_with_jubjub !== 'function' ||
    typeof capabilities.derive_grant_object_commit !== 'function'
  )
    throw new Error('The pinned ACC binding lacks the grant-holder circuits.');
  const intent = {
    account: handoff.account,
    grantId: handoff.grantId,
    granteePublicKey: handoff.granteePublicKey,
    origin: handoff.origin,
    slot: handoff.slot,
    scopeSalt: handoff.scopeSalt,
    color: handoff.color,
    amount,
    recipient: handoff.recipient,
    maxCoinValue: handoff.maxCoinValue,
    spentPrev,
  };
  checkUnshieldedGrant(
    intent,
    await source.readGrantSpendContext(handoff.account, handoff.grantId),
    pure as unknown as UnshieldedGrantCallPure,
    Math.floor(Date.now() / 1000),
  );
  const passkey = webauthnPasskey({
    rpId: RP_ID,
    origin: ORIGIN,
    ...(credentials && { credentials }),
  });
  await passkey.credentials.identify();
  const grantee = recipeJubjubAuthoriser(passkey.prf, pure as JubjubDeviceCircuits);
  return spendUnshieldedWithGrant(intent, {
    pure: pure as unknown as UnshieldedGrantCallPure,
    source,
    chain: {
      call: (request) => demoValueCall(SERVICE_URL, request),
      readAccount: async () => {
        throw new Error('Holder account reads are not exposed by this demo route.');
      },
    },
    grantee,
    review,
  });
}
