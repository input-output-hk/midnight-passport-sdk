// Loaded ONLY by the journey runner's private Vite plugin. Never imported by the demo.
// Actual UI, mock credential API and ceremony hooks; deliberately synthetic account/chain.
import { webauthnPasskey } from '@input-output-hk/mn-passport-adapter-webauthn';
import type { FlowOptions, GrantScopeInput } from '@input-output-hk/mn-passport-protocol';
import { beforeDemoCeremony } from '../../src/consent.ts';
import type { AuthenticatedJubjubOwner } from '@input-output-hk/mn-passport-keys';
import { routineKeys, checkRoutineReview } from '../../src/routine-access.ts';

export const SERVICE_URL = 'http://localhost:8787';
export const MANIFEST_SHA256 = '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f';
export const NETWORK_ID = 'undeployed';
export const RP_ID = 'localhost';
export const ORIGIN = 'http://localhost:5173';
export const BINDING_ID = 'acc-s3r1.1';
export const ARM =
  new URL(location.href).searchParams.get('fixtureArm') === 'jubjub' ? 'jubjub' : 'p256';
const ADDRESS = 'a1'.repeat(32);
interface State {
  ownerPublicKey?: string;
  nonce: number;
  epoch: number;
  entries: string[];
  txHash: string;
  grant?: { id: string; active: boolean; scope: GrantScopeInput; spent: number };
}
async function call(action: string, data: Record<string, unknown> = {}): Promise<State> {
  const response = await fetch('/__demo-fixture', {
    method: 'POST',
    body: JSON.stringify({ action, ...data }),
  });
  const reply = await response.json();
  if (!response.ok)
    throw Object.assign(new Error('Synthetic fixture refusal'), { code: reply.code });
  return reply as State;
}
const passkey = webauthnPasskey({
  rpId: RP_ID,
  origin: ORIGIN,
  beforeCeremony: beforeDemoCeremony,
});
const unlock = () =>
  passkey.prf.withSession(async () => {
    (await passkey.prf.deviceSecret()).fill(0);
  });
async function p256Signature(): Promise<void> {
  if (ARM === 'p256') {
    await beforeDemoCeremony({ purpose: 'sign', rpId: RP_ID, attempt: 1 });
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: RP_ID,
        userVerification: 'required',
      },
    });
  }
}
async function sign(): Promise<void> {
  await unlock();
  await p256Signature();
}
const tx = (s: State) => ({ txHash: s.txHash, nextUseCounter: BigInt(s.nonce) });
const account = (credentialId: Uint8Array, owner?: AuthenticatedJubjubOwner) => {
  const signAccount = owner
    ? async () => {
        owner.check();
        await owner.authoriser.devicePublicKey();
      }
    : sign;
  const unlockAccount = owner
    ? async () => {
        owner.check();
      }
    : unlock;
  return {
    scheme: owner
      ? ('jubjub-schnorr' as const)
      : ARM === 'p256'
        ? ('p256-webauthn' as const)
        : ('jubjub-schnorr' as const),
    address: ADDRESS,
    networkId: NETWORK_ID,
    bindingId: BINDING_ID,
    credentialId,
    async state() {
      const s = await call('state');
      return {
        specVersion: 1,
        booted: true,
        authNonce: BigInt(s.nonce),
        deviceEpoch: BigInt(s.epoch),
        entryCount: s.entries.length,
      };
    },
    async deviceRoster() {
      const s = await call('state');
      return { authNonce: BigInt(s.nonce), deviceEpoch: BigInt(s.epoch), commitments: s.entries };
    },
    async grantRoster() {
      const s = await call('state');
      return {
        authNonce: BigInt(s.nonce),
        generation: BigInt(s.nonce),
        entries: s.grant ? [{ id: s.grant.id, active: s.grant.active, read: false }] : [],
      };
    },
    async readShieldedHoldings() {
      checkRoutineReview();
      if (
        !routineKeys.matches({
          address: ADDRESS,
          networkId: NETWORK_ID,
          bindingId: BINDING_ID,
          credentialId,
        })
      )
        await unlockAccount();
      await call('holdings');
      return [
        {
          inboxIndex: 2,
          coin: {
            color: new Uint8Array(32),
            value: BigInt(
              (window as unknown as { __ownerReadValue?: number }).__ownerReadValue ?? 2,
            ),
            nonce: new Uint8Array(32),
          },
        },
      ];
    },
    async rotateViewingKey(options: FlowOptions = {}) {
      await signAccount();
      const s = await call('rotate');
      const event = {
        id: `rotation-${s.txHash}`,
        flowId: 'synthetic-rotation',
        step: 'sponsor.submit' as const,
        at: Date.now(),
        clock: 'client' as const,
      };
      options.onEvent?.({ ...event, phase: 'start' });
      options.onEvent?.({
        ...event,
        phase: 'end',
        detail: {
          txId: s.txHash,
          circuit:
            owner || ARM === 'jubjub' ? 'rotate_enc_key_with_jubjub' : 'rotate_enc_key_with_p256',
        },
      });
      if ((window as unknown as { __partialOwnerRotation?: boolean }).__partialOwnerRotation) {
        await call('rotation-tail');
        await signAccount(); // A new inbox append must refuse after lease loss.
      }
      return { ...tx(s), droppedDeviceEntries: [], unsealedGrantIds: [], sealedReadGrants: [] };
    },
    async addDevice(_reader: { devicePublicKey: string }) {
      const currentOwner = routineKeys.ownerSession({
        address: ADDRESS,
        networkId: NETWORK_ID,
        bindingId: BINDING_ID,
        credentialId,
      });
      if (!owner && currentOwner?.publicKey === _reader.devicePublicKey) {
        await signAccount();
        const s = await call('enroll-owner', { publicKey: currentOwner.publicKey });
        return { ...tx(s), commitmentHex: currentOwner.publicKey };
      }
      await signAccount();
      const s = await call('enroll');
      return { ...tx(s), commitmentHex: '20'.repeat(32) };
    },
    async removeDevice(target: string) {
      await signAccount();
      const s = await call('remove', { target });
      return { ...tx(s), rotationTxHash: '30'.repeat(32) };
    },
    async issueGrant(scope: GrantScopeInput) {
      await signAccount();
      let grantId: string | undefined;
      if (scope.expiresAt !== null) {
        const { pureCircuits: pure } =
          await import('@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1');
        const { grantOriginHash, granteePoint } =
          await import('@input-output-hk/mn-passport-account');
        const bytes = Uint8Array.from(ADDRESS.match(/../g)!, (b) => parseInt(b, 16));
        grantId = Array.from(
          pure.derive_grant_id_with_jubjub(
            { bytes },
            granteePoint(scope.grantee.publicKey),
            grantOriginHash(RP_ID),
            0n,
          ),
          (b) => b.toString(16).padStart(2, '0'),
        ).join('');
      }
      const s = await call('issue', { scope, ...(grantId && { grantId }) });
      return {
        ...tx(s),
        grantId: s.grant!.id,
        slot: 0,
        scopeDigest: '40'.repeat(32),
        status: 'active' as const,
      };
    },
    async recoverPendingGrants() {
      await unlockAccount();
      await call('recover');
      return { published: [], unsettledGrantIds: [] };
    },
    async revokeGrant(grantId: string) {
      await signAccount();
      const s = await call('revoke', { grantId });
      return { ...tx(s), grantId, status: 'revoked' as const };
    },
    async withdrawUnshielded(request: { amount: string }, _options?: FlowOptions) {
      await signAccount();
      return tx(await call('withdraw', { amount: request.amount }));
    },
  };
};
const api = {
  async createAccount(options: { retireAuthority: boolean }) {
    if (options.retireAuthority !== true)
      throw new Error('Fixture expects the explicitly acknowledged demo policy');
    const ref = await passkey.credentials.create({ name: 'journey owner' });
    await unlock();
    await call('create');
    if (ARM === 'p256') {
      // Synthetic setup publications exercise separate post-deployment consent boundaries.
      await p256Signature();
      await call('publish-envelope');
      await p256Signature();
      await call('publish-registration');
    }
    return account(ref.credentialId);
  },
  async openAccount() {
    const ref = await passkey.credentials.identify();
    await unlock();
    await call('open');
    return account(ref.credentialId);
  },
  async openAccountAt(address: string) {
    if (address !== ADDRESS) throw new Error('Unknown fixture ACC');
    return api.openAccount();
  },
};
export async function exportDemoGrantOpening() {
  checkRoutineReview();
  if (!routineKeys.snapshot().ownerVerified) await unlock();
  const s = await call('state');
  const scope = s.grant!.scope;
  return {
    kind: 'mn-passport-unshielded-grant-v1',
    networkId: NETWORK_ID,
    bindingId: BINDING_ID,
    account: ADDRESS,
    grantId: s.grant!.id,
    granteePublicKey: scope.grantee.publicKey,
    origin: RP_ID,
    slot: 0,
    scopeSalt: '50'.repeat(32),
    color: scope.color,
    recipient: scope.recipient.kind === 'any' ? '' : scope.recipient.value,
    maxCoinValue: scope.maxCoinValue,
    perCallCap: scope.perCallCap,
    cap: scope.cap,
    ...(scope.expiresAt !== null && { expiresAt: scope.expiresAt }),
  };
}
export async function connect(_network: string, owner: AuthenticatedJubjubOwner) {
  return {
    ...api,
    openAccountAt: async (address: string) => {
      owner.check();
      const s = await call('state');
      if (address !== ADDRESS || (ARM === 'p256' && s.ownerPublicKey !== owner.publicKey))
        throw Object.assign(new Error('Synthetic owner is not enrolled'), {
          code: 'NotAuthorised',
        });
      return account(owner.context.credentialId, owner);
    },
  };
}
export function installShim(): void {
  Object.assign(window, {
    midnight: { passport: { apiVersion: '1.0.0', connect: async () => api } },
  });
}
