import { readGrantRoster } from './account-methods.js';
import { BINDING_ID, ORIGIN, RP_ID, exportDemoGrantOpening } from './connector.js';
import { knownAccAddress } from './flows.js';

import { fixedUnshieldedGrant } from './grant-input.js';
import { prepareGranteePasskey } from './grantee-passkey.js';
import { spendDemoGrant } from './grant-holder-demo.js';
import { parseGrantHandoff } from './grant-handoff.js';
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { Buffer } from 'buffer';

import { traceOperation } from './operation-trace.js';

import { beforeDemoCeremony, assertExactGrantExport } from './consent.js';

import { checkRoutineReview } from './routine-access.js';

import type { DemoActionHost } from './app-model.js';

export class GrantActions {
  constructor(private readonly host: DemoActionHost) {}
  grantRoster = async () => {
    const current = this.host.state.account;
    if (!current?.grantRoster) throw new Error('Open an ACC with a live grant source first.');
    const roster = await current.grantRoster();
    this.host.ui.showGrantRoster(current.address, roster);
    const publicRoster = {
      accountAddress: current.address,
      authNonce: roster.authNonce.toString(),
      generation: roster.generation.toString(),
      entries: roster.entries,
    };
    this.host.record('grantRoster', publicRoster);
    traceOperation('account.grants.roster', publicRoster);
    this.host.status(
      `Read ${roster.entries.filter((entry) => entry.active).length} active grants from the ACC.`,
    );
  };
  prepareGrantee = async () => {
    const target = knownAccAddress(this.host.ui.knownAddress());
    this.host.stage('passkey');
    this.host.status(
      'Creating a separate grant-holder passkey and deriving its public JubJub key…',
    );
    const publicKey = await prepareGranteePasskey({
      rpId: RP_ID,
      origin: ORIGIN,
      beforeCeremony: beforeDemoCeremony,
    });
    this.host.ui.showGranteePublicKey(publicKey);
    this.host.record('granteePublicKey', { accountAddress: target, publicKey });
    traceOperation('grant.holder.prepared', { accountAddress: target, publicKey });
    this.host.status(
      'Public grantee key ready. Copy it to the ACC owner browser for the scoped grant.',
    );
  };
  issueGrant = async () => {
    const current = this.host.state.account;
    if (!current?.issueGrant || !current.grantRoster)
      throw new Error('Open a supported Passport account before issuing a grant.');
    const input = this.host.ui.grantInput();
    const scope = fixedUnshieldedGrant(this.host.network, input);
    this.host.stage('review');
    const before = await current.grantRoster();
    this.host.ui.showGrantRoster(current.address, before);
    const approved = window.confirm(
      `Issue a scoped ACC withdrawal grant?\n\nACC: ${current.address}\nNetwork: ${this.host.network}\n` +
        `Grantee JubJub key: ${scope.grantee.publicKey}\nAsset color: ${scope.color}\n` +
        `Fixed recipient: ${input.recipient}\nPer-call cap: ${scope.perCallCap}\n` +
        `Total cap: ${scope.cap}\nExpiry: none\n\nThe grant can move ACC funds to this recipient until revoked.`,
    );
    if (!approved) {
      this.host.status('Grant issue cancelled before signing.');
      traceOperation('grant.issue.cancelled', { accountAddress: current.address });
      return;
    }
    this.host.stage('submit');
    const result = await current.issueGrant(scope, { onEvent: this.host.onEvent });
    const after = await this.host.refreshAfterReceipt(
      {
        action: 'issueGrant',
        accountAddress: current.address,
        txHash: result.txHash,
        grantId: result.grantId,
      },
      () => readGrantRoster(current),
    );
    if (!after) return;
    if (!after.entries.some((entry) => entry.id === result.grantId && entry.active))
      throw new Error('The issued grant is not active in the live roster.');
    this.host.ui.showGrantRoster(current.address, after);
    const publicResult = {
      accountAddress: current.address,
      grantId: result.grantId,
      slot: result.slot,
      scopeDigest: result.scopeDigest,
      txHash: result.txHash,
      generation: after.generation.toString(),
      granteePublicKey: scope.grantee.publicKey,
      color: scope.color,
      recipient: scope.recipient,
      perCallCap: scope.perCallCap,
      cap: scope.cap,
    };
    this.host.record('grantIssued', publicResult);
    traceOperation('account.grants.issued', publicResult);
    this.host.status(`Grant ${result.grantId.slice(0, 12)}… is active for the fixed recipient.`);
  };
  exportGrant = async () => {
    const current = this.host.state.account;
    if (!current?.grantRoster) throw new Error('Open the owner ACC before exporting a grant.');
    const grantId = this.host.ui.exportGrantId();
    if (!/^[0-9a-f]{64}$/.test(grantId)) throw new Error('Enter a valid grant ID.');
    this.host.stage('review');
    const roster = await current.grantRoster();
    if (!roster.entries.some((entry) => entry.id === grantId && entry.active))
      throw new Error('The grant is not active in the live ACC.');
    this.host.ownerReview.stageGrantExportReview(current, grantId);
    this.host.stage('export');
    const handoff = await exportDemoGrantOpening(current.address, grantId);
    checkRoutineReview();
    assertExactGrantExport(handoff.account, handoff.grantId);
    if (handoff.networkId !== this.host.network || handoff.bindingId !== BINDING_ID)
      throw new Error('The exported grant belongs to another network or binding.');
    this.host.ui.showGrantHandoff(handoff);
    this.host.record('grantOpeningExported', { accountAddress: current.address, grantId });
    traceOperation('account.grants.openingExported', { accountAddress: current.address, grantId });
    this.host.status('Opening ready. Transfer its JSON directly to the named grantee browser.');
  };
  spendGrant = async () => {
    const input = this.host.ui.grantSpendInput();
    const handoff = parseGrantHandoff(input.handoff, this.host.network);
    this.host.stage('read');
    this.host.status('Checking the live ACC grant and selected grantee passkey…');
    const result = await spendDemoGrant(
      input.handoff,
      this.host.network,
      input.amount,
      input.spentPrev,
      async (fields) => {
        this.host.stage('review');
        const address = MidnightBech32m.encode(
          this.host.network,
          new UnshieldedAddress(Buffer.from(fields.recipient, 'hex')),
        ).asString();
        const approved = window.confirm(
          `Spend this scoped grant?\n\nACC: ${fields.account}\nGrant: ${fields.grantId}\n` +
            `Asset color: ${fields.color}\nAmount: ${fields.amount} smallest units\n` +
            `Remaining cap: ${fields.remainingCap}\nFixed recipient: ${address}\n\n` +
            'Approve this exact transfer before signing and submission.',
        );
        if (approved) this.host.stage('submit');
        else
          traceOperation('grant.spend.cancelled', {
            accountAddress: fields.account,
            grantId: fields.grantId,
          });
        return approved;
      },
    );
    this.host.ui.showGrantSpentTotal(result.spentTotal);
    const publicResult = {
      accountAddress: handoff.account,
      grantId: result.grantId,
      color: handoff.color,
      amount: input.amount,
      recipient: handoff.recipient,
      spentTotal: result.spentTotal.toString(),
      grantNonce: result.grantNonce.toString(),
      txHash: result.txHash,
    };
    this.host.record('grantSpent', publicResult);
    traceOperation('grant.holder.spent', publicResult);
    this.host.status(`Grant spend ${result.txHash.slice(0, 12)}… confirmed on the ACC.`);
  };
  revokeGrant = async () => {
    const current = this.host.state.account;
    if (!current?.revokeGrant || !current.grantRoster)
      throw new Error('Open a supported Passport account before revoking a grant.');
    const grantId = this.host.ui.revokeGrantId();
    if (!/^[0-9a-f]{64}$/.test(grantId)) throw new Error('Enter a valid grant ID.');
    this.host.stage('review');
    const before = await current.grantRoster();
    if (!before.entries.some((entry) => entry.id === grantId && entry.active))
      throw new Error('This grant is not active in the live ACC.');
    this.host.ui.showGrantRoster(current.address, before);
    const approved = window.confirm(
      `Revoke this ACC grant?\n\nACC: ${current.address}\nNetwork: ${this.host.network}\n` +
        `Grant ID: ${grantId}\nGeneration: ${before.generation}\n\nConfirm before signing.`,
    );
    if (!approved) {
      this.host.status('Grant revocation cancelled before signing.');
      traceOperation('grant.revoke.cancelled', { accountAddress: current.address, grantId });
      return;
    }
    this.host.stage('submit');
    const result = await current.revokeGrant(grantId, { onEvent: this.host.onEvent });
    const after = await this.host.refreshAfterReceipt(
      { action: 'revokeGrant', accountAddress: current.address, txHash: result.txHash, grantId },
      () => readGrantRoster(current),
    );
    if (!after) return;
    if (!after.entries.some((entry) => entry.id === grantId && !entry.active))
      throw new Error('The grant revocation did not appear in the live roster.');
    this.host.ui.showGrantRoster(current.address, after);
    this.host.ui.clearGrantHandoff();
    const publicResult = {
      accountAddress: current.address,
      grantId,
      txHash: result.txHash,
      status: result.status,
      generation: after.generation.toString(),
    };
    this.host.record('grantRevoked', publicResult);
    traceOperation('account.grants.revoked', publicResult);
    this.host.status(`Grant ${grantId.slice(0, 12)}… is revoked on chain.`);
  };
  recoverGrants = async () => {
    const current = this.host.state.account;
    if (!current?.recoverPendingGrants || !current.grantRoster)
      throw new Error('Open a supported Passport account before recovering grants.');
    this.host.stage('recover');
    this.host.status('Checking staged openings against the live ACC and resuming publication…');
    const result = await current.recoverPendingGrants({ onEvent: this.host.onEvent });
    const roster = await this.host.refreshAfterReceipt(
      {
        action: 'recoverGrants',
        accountAddress: current.address,
        txIds: result.published.flatMap((grant) => grant.appendTxHashes),
      },
      () => readGrantRoster(current),
    );
    if (!roster) return;
    this.host.ui.showGrantRoster(current.address, roster);
    const publicResult = {
      accountAddress: current.address,
      published: result.published.map((grant) => ({
        grantId: grant.grantId,
        status: grant.status,
        appendTxHashes: grant.appendTxHashes,
        nextUseCounter: grant.nextUseCounter.toString(),
      })),
      unsettledGrantIds: result.unsettledGrantIds,
      generation: roster.generation.toString(),
    };
    this.host.record('grantRecovery', publicResult);
    traceOperation('account.grants.recovered', publicResult);
    this.host.status(
      `Published ${result.published.length} pending grants; ${result.unsettledGrantIds.length} remain unsettled.`,
    );
  };
}
