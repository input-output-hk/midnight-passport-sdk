import { readDeviceRoster } from './account-methods.js';
import { ARM, BINDING_ID, ORIGIN, RP_ID } from './connector.js';
import { knownAccAddress } from './flows.js';

import { parseDeviceHandoff, prepareDeviceHandoff } from './device-handoff.js';
import { traceOperation } from './operation-trace.js';

import { beforeDemoCeremony } from './consent.js';

import type { DemoActionHost } from './app-model.js';

export class DeviceActions {
  constructor(private readonly host: DemoActionHost) {}
  prepareJoiner = async () => {
    const address = knownAccAddress(this.host.ui.knownAddress());
    this.host.stage('passkey');
    const handoff = await prepareDeviceHandoff(address, this.host.network, ARM, {
      bindingId: BINDING_ID,
      rpId: RP_ID,
      origin: ORIGIN,
      beforeCeremony: beforeDemoCeremony,
    });
    this.host.ui.showHandoff(handoff);
    this.host.record('joiningDevicePublicHandoff', {
      accountAddress: address,
      scheme: handoff.scheme,
      fingerprint: handoff.fingerprint,
      readerPublicKey: handoff.readerPublicKey,
      devicePublicKey: handoff.devicePublicKey,
    });
    this.host.status(
      'Public handoff ready. Copy the JSON to the owner browser and compare its fingerprint.',
    );
  };
  roster = async () => {
    const current = this.host.state.account;
    const readRoster = current?.deviceRoster;
    if (!current || !readRoster) throw new Error('Open an ACC before reading its device roster.');
    const roster = await readRoster();
    this.host.ui.showRoster(current.address, roster);
    this.host.record('deviceRoster', {
      accountAddress: current.address,
      epoch: roster.deviceEpoch.toString(),
      authNonce: roster.authNonce.toString(),
      commitments: roster.commitments,
    });
    this.host.status(
      `Read ${roster.commitments.length} live ACC device entries at epoch ${roster.deviceEpoch}.`,
    );
  };
  enrollDevice = async () => {
    const current = this.host.state.account;
    const readRoster = current?.deviceRoster;
    const addDevice = current?.addDevice;
    if (!current || !readRoster || !addDevice)
      throw new Error('Open a sealed ACC before enrolling a device.');
    this.host.stage('review');
    const { handoff, reader } = await parseDeviceHandoff(this.host.ui.handoffJson(), {
      accountAddress: current.address,
      networkId: this.host.network,
      arm: ARM,
      bindingId: BINDING_ID,
      rpId: RP_ID,
      origin: ORIGIN,
    });
    const [before, state] = await Promise.all([readRoster(), current.state()]);
    if (before.deviceEpoch !== state.deviceEpoch || before.authNonce !== state.authNonce)
      throw new Error(
        'The ACC roster changed while preparing enrollment. Refresh and review again.',
      );
    this.host.ui.showRoster(current.address, before);
    const approved = window.confirm(
      `Enroll a second ${ARM === 'p256' ? 'P-256' : 'JubJub'} device for ACC ${current.address}?\n\n` +
        `Network: ${this.host.network}\nEpoch: ${before.deviceEpoch}\nLive entries: ${before.commitments.length}\n` +
        `Joiner fingerprint: ${handoff.fingerprint}\n\n` +
        'Compare the fingerprint with the joining browser before consenting.',
    );
    if (!approved) {
      traceOperation('account.device.enrollmentCancelled', { accountAddress: current.address });
      throw new Error('Device enrollment was cancelled before signing.');
    }
    this.host.stage('submit');
    const enrolled = await addDevice(reader, { onEvent: this.host.onEvent });
    const refreshed = await this.host.refreshAfterReceipt(
      { action: 'enrollDevice', accountAddress: current.address, txHash: enrolled.txHash },
      () => Promise.all([readRoster(), current.state()]),
    );
    if (!refreshed) return;
    const [after, nextState] = refreshed;
    if (!after.commitments.includes(enrolled.commitmentHex))
      throw new Error('The joining device entry is absent from the confirmed ACC roster.');
    this.host.ui.showAccount({
      address: current.address,
      networkId: current.networkId,
      bindingId: current.bindingId,
      state: nextState,
      lastTx: enrolled,
    });
    this.host.ui.showRoster(current.address, after);
    this.host.record('deviceEnrolled', {
      accountAddress: current.address,
      fingerprint: handoff.fingerprint,
      commitment: enrolled.commitmentHex,
      txHash: enrolled.txHash,
      deviceEpoch: after.deviceEpoch.toString(),
      liveEntries: after.commitments.length,
    });
    traceOperation('account.device.enrolled', {
      accountAddress: current.address,
      fingerprint: handoff.fingerprint,
      commitment: enrolled.commitmentHex,
      txHash: enrolled.txHash,
    });
    this.host.status(
      'Joining device confirmed in the ACC roster. Open by ACC address on that browser.',
    );
  };
  removeDevice = async () => {
    const current = this.host.state.account;
    if (!current?.deviceRoster || !current.removeDevice)
      throw new Error('Open a sealed Passport account before removing a device.');
    const target = this.host.ui.removalCommitment();
    if (!/^[0-9a-f]{64}$/.test(target))
      throw new Error('Enter one full lowercase commitment from the live device roster.');
    this.host.stage('review');
    const [before, state] = await Promise.all([current.deviceRoster(), current.state()]);
    if (before.authNonce !== state.authNonce || before.deviceEpoch !== state.deviceEpoch)
      throw new Error('The device roster changed. Refresh and review it again.');
    this.host.ui.showRoster(current.address, before);
    if (before.commitments.length < 2) throw new Error('The ACC has no second device to remove.');
    if (!before.commitments.includes(target))
      throw new Error('That commitment is absent from the live ACC device roster.');
    const approved = window.confirm(
      `Remove this device entry from Passport ACC?\n\nNetwork: ${this.host.network}\nACC: ${current.address}\n` +
        `Device commitment: ${target}\nDevice epoch: ${before.deviceEpoch}\n` +
        `Live entries: ${before.commitments.length}\n\n` +
        'The SDK rotates the viewing and roster keys and removes this one entry. This does not guarantee full revocation of a compromised key: another entry may still authorise calls. Previously learned data stays known. Confirm the full commitment against the live roster.',
    );
    if (!approved) {
      this.host.status('Device removal cancelled before signing.');
      traceOperation('account.device.removalCancelled', {
        accountAddress: current.address,
        target,
      });
      return;
    }
    this.host.stage('submit');
    this.host.status(
      'Rotating sealed keys and removing the selected device; this takes multiple transactions…',
    );
    const removed = await current.removeDevice(target, { onEvent: this.host.onEvent });
    const refreshed = await this.host.refreshAfterReceipt(
      {
        action: 'removeDevice',
        accountAddress: current.address,
        txHash: removed.txHash,
        txIds: [removed.rotationTxHash, removed.txHash],
      },
      () => Promise.all([readDeviceRoster(current), current.state()]),
    );
    if (!refreshed) return;
    const [after, nextState] = refreshed;
    if (
      after.commitments.includes(target) ||
      after.commitments.length !== before.commitments.length - 1
    )
      throw new Error('The selected device was not removed from the confirmed ACC roster.');
    this.host.ui.showAccount({
      address: current.address,
      networkId: current.networkId,
      bindingId: current.bindingId,
      state: nextState,
      lastTx: removed,
    });
    this.host.ui.showRoster(current.address, after);
    const result = {
      accountAddress: current.address,
      removedCommitment: target,
      removalScope: 'entry',
      rotationTxHash: removed.rotationTxHash,
      removalTxHash: removed.txHash,
      deviceEpoch: after.deviceEpoch.toString(),
      liveEntries: after.commitments.length,
    };
    this.host.record('deviceRemoved', result);
    traceOperation('account.device.removed', result);
    this.host.status(
      'The selected entry is absent from the live ACC roster. This confirms entry removal, not complete compromised-key revocation.',
    );
  };
  rotate = async () => {
    const current = this.host.state.account;
    if (
      !current?.rotateViewingKey ||
      !current.deviceRoster ||
      !current.grantRoster ||
      !current.readShieldedHoldings
    )
      throw new Error('Open a sealed Passport account with complete chain-backed sources first.');
    this.host.stage('review');
    const [before, devices, grants, holdings] = await Promise.all([
      current.state(),
      current.deviceRoster(),
      current.grantRoster(),
      current.readShieldedHoldings({ onEvent: this.host.onEvent }),
    ]);
    if (before.authNonce !== devices.authNonce || before.authNonce !== grants.authNonce)
      throw new Error('The ACC changed while its readers were reviewed. Refresh and try again.');
    const activeReadGrants = grants.entries.filter((entry) => entry.active && entry.read).length;
    const approved = window.confirm(
      `Rotate this Passport ACC's viewing secret?\n\nNetwork: ${this.host.network}\nACC: ${current.address}\n` +
        `Live devices: ${devices.commitments.length}\nShielded holdings: ${holdings.length}\n` +
        `Active read grants: ${activeReadGrants}\n\n` +
        'Every live device, holding and read grantee must receive a fresh seal. The SDK refuses an incomplete roster before changing the ACC.',
    );
    if (!approved) {
      this.host.status('Viewing-key rotation cancelled before signing.');
      traceOperation('account.viewingKey.rotationCancelled', { accountAddress: current.address });
      return;
    }
    this.host.stage('submit');
    this.host.status(
      'Sealing a new viewing secret to verified readers, then signing and confirming rotation…',
    );
    const rotated = await current.rotateViewingKey({ onEvent: this.host.onEvent });
    const after = await this.host.refreshAfterReceipt(
      { action: 'rotate', accountAddress: current.address, txHash: rotated.txHash },
      () => current.state(),
    );
    if (!after) return;
    if (rotated.droppedDeviceEntries.length || rotated.unsealedGrantIds.length)
      throw new Error('Rotation reported an incomplete reader delivery; inspect the event log.');
    if (after.authNonce <= before.authNonce)
      throw new Error('The ACC did not confirm a newer authorisation nonce.');
    this.host.ui.showAccount({
      address: current.address,
      networkId: current.networkId,
      bindingId: current.bindingId,
      state: after,
      lastTx: rotated,
    });
    const result = {
      accountAddress: current.address,
      txHash: rotated.txHash,
      authNonceBefore: before.authNonce.toString(),
      authNonceAfter: after.authNonce.toString(),
      deviceCount: devices.commitments.length,
      holdingCount: holdings.length,
      activeReadGrants,
      sealedReadGrants: rotated.sealedReadGrants.map(({ grantId }) => grantId),
    };
    this.host.record('viewingKeyRotated', result);
    traceOperation('account.viewingKey.rotated', result);
    this.host.status('The ACC confirmed its new sealed viewing secret.');
  };
}
