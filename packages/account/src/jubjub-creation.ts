import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import type { Flow } from './flow.js';
import type { InboxLedgerView } from './inbox-view.js';
import type { JubjubHint } from './jubjub-rotation-types.js';
import type { JubjubPureCircuits, PassportPorts } from './ports/index.js';
import { PassportConnectorError } from './errors.js';

/** One registration followed by one PRF scope through confirmed activation and sealed publications. */
export async function createJubjubAccount(
  userName: string,
  retireAuthority: boolean,
  controls: {
    ports: PassportPorts;
    flow: Flow;
    fresh(length: number): Uint8Array;
    sleep(ms: number): Promise<void>;
    pure(): Promise<JubjubPureCircuits>;
    awaitDeployed(record: JubjubHint): Promise<InboxLedgerView>;
    finish(flow: Flow, record: JubjubHint, view: InboxLedgerView): Promise<PassportAccount>;
  },
) {
  const { ports, flow } = controls;
  const { authoriser, credentials, viewingKey, directory } = ports;
  if (typeof retireAuthority !== 'boolean')
    throw new PassportConnectorError('InternalError', 'retireAuthority must be a boolean.');
  const withSession = authoriser.withKeySession?.bind(authoriser);
  const publicKeyHex = authoriser.devicePublicKeyHex?.bind(authoriser);
  if (!withSession || !publicKeyHex || !viewingKey || !directory)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'JubJub creation requires sealed key and session ports.',
    );
  const { credentialId } = await flow.step('passkey.create', () =>
    credentials.create({ name: userName }),
  );
  return withSession(
    async () => {
      const pk = await authoriser.devicePublicKey();
      const devicePublicKey = await publicKeyHex();
      const keys = await flow.step('passkey.prf', () =>
        viewingKey.createKeys(ports.network.networkId, { devicePublicKey }),
      );
      const salt = controls.fresh(32);
      const pure = await controls.pure();
      const boot = pure.derive_boot_commitment_with_jubjub(salt, pk);
      const { address } = await flow.step('deploy', () =>
        ports.deployer.deploy({
          boot,
          encKey: keys.encKey,
          firstArm: 'jubjub',
          retireAuthority,
          ...flow.ports,
        }),
      );
      const record: JubjubHint = {
        address,
        scheme: 'jubjub-schnorr',
        credentialId,
        publicKey: pk,
        salt,
        keyEntries: [...keys.envelopes, ...keys.registrations],
        status: 'deployed',
      };
      await flow.step(
        'directory.write',
        async () => {
          for (let attempt = 0; ; attempt++) {
            try {
              return await directory.put(ports.network.networkId, record);
            } catch (error) {
              if (attempt >= 2) throw error;
              await controls.sleep(200 * 2 ** attempt);
            }
          }
        },
        'always',
      );
      const view = await controls.awaitDeployed(record);
      const ready = await controls.finish(flow, record, view);
      await ports.onAccountCreated?.(ready);
      return ready;
    },
    { kind: 'create-account', lockAccount: retireAuthority },
  );
}
