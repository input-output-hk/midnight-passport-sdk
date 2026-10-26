import { PassportConnectorError } from './errors.js';
import { verifyGrantBookkeepingCommitment } from './grant-opening-check.js';
import { mutationLedger, sameMutationLedger } from './mutation-ledger.js';
import { mutationDigest } from './mutation-codec.js';
import type { GrantScopePure } from './grant-scope.js';
import type {
  AccountViewingKey,
  Chain,
  GrantBookkeeping,
  GrantCommitmentSource,
  GrantRecordPart,
} from './ports/index.js';

export interface GrantBookkeepingRecoveryPorts {
  readonly networkId: string;
  /** Trusted relying-party identifier from the host configuration, not an inbox field. */
  readonly origin: string;
  readonly chain: Pick<Chain, 'readAccount'>;
  readonly viewingKey: Pick<AccountViewingKey, 'openInbox'>;
  readonly commitments: GrantCommitmentSource;
  readonly pure: Pick<GrantScopePure, 'derive_grant_id_with_jubjub' | 'derive_grant_object_commit'>;
}
const refuse = (message: string): never => {
  throw new PassportConnectorError('GrantBookkeepingUnsettled', message);
};

/** Recover only the published bookkeeping this selected reader can decrypt and authenticate.
 * Does not recover the private grantee signing key, full issue scope or unpublished records.
 * Call inside the host's approved key session; the result is protected capability material,
 * never a progress event or a public audit record.
 */
export function createGrantBookkeepingRecovery(ports: GrantBookkeepingRecoveryPorts) {
  const recover = async (account: string, grantId: string): Promise<GrantBookkeeping> => {
    if (!/^[0-9a-f]{64}$/.test(account) || !/^[0-9a-f]{64}$/.test(grantId) || !ports.origin)
      return refuse('Recovery requires the original ACC, grant ID and trusted origin.');
    const before = mutationLedger(
      await ports.chain.readAccount(account, { includeInbox: true, includeDevices: true }),
    );
    let opened;
    try {
      opened = await ports.viewingKey.openInbox(
        ports.networkId,
        { account, encKey: before.encKey, envelopes: before.inboxEntries },
        before.inboxEntries,
      );
    } catch {
      return refuse(
        'The selected key origin cannot open this ACC. Restore the original authorised reader; do not create replacement keys.',
      );
    }
    const parts = new Map<string, GrantRecordPart>();
    for (const entry of opened) {
      if (
        entry?.kind !== 'grant' ||
        entry.record.grantId !== grantId ||
        entry.record.part === 'view'
      )
        continue;
      const previous = parts.get(entry.record.part);
      if (previous && mutationDigest(previous) !== mutationDigest(entry.record))
        return refuse(
          'Conflicting published bookkeeping for this grant; select an authenticated backup through the host.',
        );
      parts.set(entry.record.part, entry.record);
    }
    const grant = parts.get('grant'),
      object = parts.get('object');
    if (grant?.part !== 'grant' || object?.part !== 'object')
      return refuse(
        'Published opening parts are absent for this reader. Restore the original reader or encrypted publication journal; another enrolled device alone cannot reconstruct this opening.',
      );
    const { part: _part, ...fields } = grant;
    const result: GrantBookkeeping = { ...fields, object: object.object };
    const live = await ports.commitments.readGrantCommitment(account, grantId);
    const after = mutationLedger(
      await ports.chain.readAccount(account, { includeInbox: true, includeDevices: true }),
    );
    if (!sameMutationLedger(before, after) || live?.authNonce !== before.authNonce)
      return refuse('The ACC changed during bookkeeping recovery; no opening was accepted.');
    verifyGrantBookkeepingCommitment(account, ports.origin, result, live, ports.pure);
    return result;
  };
  return {
    recover,
    async readReadPublicKey(account: string, grantId: string): Promise<string | undefined> {
      return (await recover(account, grantId)).readPublicKey;
    },
  };
}
