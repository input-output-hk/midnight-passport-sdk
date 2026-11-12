import { ledger, pureCircuits } from '@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1';
import type { DirectoryStore } from '@input-output-hk/mn-passport-service';
import type { ReferenceHostRuntime } from './reference-runtime.ts';
import type { LiveP256GrantOwner } from './browser-grant-sessions.ts';

const hexCoordinate = /^(0|[1-9a-f][0-9a-f]{0,63})$/;

export function createBrowserGrantOwnerReader(
  directory: DirectoryStore,
  runtime: Pick<ReferenceHostRuntime, 'ledger' | 'providers' | 'allowedAccount'>,
) {
  return async function readOwner({
    account,
    credentialId,
  }: {
    account: string;
    credentialId: string;
  }): Promise<LiveP256GrantOwner | undefined> {
    if (!runtime.allowedAccount(account)) return undefined;
    const hint = await directory.read('undeployed', credentialId);
    if (
      !hint ||
      hint.credentialId !== credentialId ||
      hint.address !== account ||
      hint.scheme !== 'p256-webauthn' ||
      hint.status !== 'active' ||
      !hint.policy ||
      !hexCoordinate.test(hint.publicKey.x) ||
      !hexCoordinate.test(hint.publicKey.y) ||
      !/^[0-9a-f]{42}$/.test(hint.policy.origin) ||
      !/^[0-9a-f]{64}$/.test(hint.policy.rp_id_hash)
    )
      return undefined;
    const snapshot = await runtime.providers.publicDataProvider.queryContractState(account);
    if (!snapshot) return undefined;
    const state = ledger(runtime.ledger.ContractState.deserialize(snapshot.serialize()).data);
    if (!state.booted || state.spec_version !== 3n) return undefined;
    const publicKey = {
      x: BigInt('0x' + hint.publicKey.x),
      y: BigInt('0x' + hint.publicKey.y),
      identity: false as const,
    };
    const policy = {
      origin: Buffer.from(hint.policy.origin, 'hex'),
      rp_id_hash: Buffer.from(hint.policy.rp_id_hash, 'hex'),
    };
    for (let counter = 0n; counter < 64n; counter++) {
      const entry = pureCircuits.derive_device_entry_with_p256(
        { bytes: Buffer.from(account, 'hex') },
        publicKey,
        policy,
        state.device_epoch,
        counter,
      );
      if (state.devices.member(entry))
        return { publicKey, policy, deviceEpoch: state.device_epoch };
    }
    return undefined;
  };
}
