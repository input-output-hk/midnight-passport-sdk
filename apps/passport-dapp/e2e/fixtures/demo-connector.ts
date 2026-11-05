// Loaded ONLY by the journey runner's private Vite plugin. Never imported by the demo.
// Actual UI, mock credential API and ceremony hooks; deliberately synthetic account/chain.
import { webauthnPasskey } from '@input-output-hk/mn-passport-adapter-webauthn';
import type { FlowOptions, GrantScopeInput } from '@input-output-hk/mn-passport-protocol';
import { beforeDemoCeremony } from '../../src/consent.ts';

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
async function sign(): Promise<void> {
  await unlock();
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
const tx = (s: State) => ({ txHash: s.txHash, nextUseCounter: BigInt(s.nonce) });
const account = (credentialId: Uint8Array) => ({
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
    await unlock();
    await call('holdings');
    return [
      { inboxIndex: 2, coin: { color: new Uint8Array(32), value: 2n, nonce: new Uint8Array(32) } },
    ];
  },
  async rotateViewingKey() {
    await sign();
    const s = await call('rotate');
    return { ...tx(s), droppedDeviceEntries: [], unsealedGrantIds: [], sealedReadGrants: [] };
  },
  async addDevice(_reader: unknown) {
    await sign();
    const s = await call('enroll');
    return { ...tx(s), commitmentHex: '20'.repeat(32) };
  },
  async removeDevice(target: string) {
    await sign();
    const s = await call('remove', { target });
    return { ...tx(s), rotationTxHash: '30'.repeat(32) };
  },
  async issueGrant(scope: GrantScopeInput) {
    await sign();
    const s = await call('issue', { scope });
    return {
      ...tx(s),
      grantId: s.grant!.id,
      slot: 0,
      scopeDigest: '40'.repeat(32),
      status: 'active' as const,
    };
  },
  async recoverPendingGrants() {
    await unlock();
    await call('recover');
    return { published: [], unsettledGrantIds: [] };
  },
  async revokeGrant(grantId: string) {
    await sign();
    const s = await call('revoke', { grantId });
    return { ...tx(s), grantId, status: 'revoked' as const };
  },
  async withdrawUnshielded(request: { amount: string }, _options?: FlowOptions) {
    await sign();
    return tx(await call('withdraw', { amount: request.amount }));
  },
});
const api = {
  async createAccount(options: { retireAuthority: boolean }) {
    if (options.retireAuthority !== true)
      throw new Error('Fixture expects the explicitly acknowledged demo policy');
    const ref = await passkey.credentials.create({ name: 'journey owner' });
    await unlock();
    await call('create');
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
  await unlock();
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
  };
}
export function installShim(): void {
  Object.assign(window, {
    midnight: { passport: { apiVersion: '1.0.0', connect: async () => api } },
  });
}
