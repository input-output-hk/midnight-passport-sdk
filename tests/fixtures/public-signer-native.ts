// Adds a real SDK mutation through public signer handlers to the historical native baseline.
import { runNativeHost as baseline, type NativeHostIO } from './native-baseline.js';
import { m, type PassportAuthoriser } from '@laceio/sdk/experimental';
import { addJubjubAuthorisingDevice } from '@input-output-hk/mn-passport-account';
import type { AccountRecord } from '@input-output-hk/mn-passport-account/ports';
import {
  hostedJubjubAuthoriser,
  type HostedJubjubConversions,
} from '@input-output-hk/mn-passport-adapter-browser/hosted-jubjub';
import { createMidnightChain } from '@input-output-hk/mn-passport-adapter-midnight-js';
import {
  Contract,
  ledger,
  pureCircuits,
} from '@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1';
import { resolveBinding } from '@input-output-hk/mn-passport-contract';
interface SignerNativeIO extends NativeHostIO {
  remote: {
    authoriser: PassportAuthoriser;
    setDecision(value: 'approve' | 'reject'): void;
    requestCount(): number;
  };
  conversions: HostedJubjubConversions<
    Parameters<PassportAuthoriser['deviceCommitment']>[0],
    Parameters<PassportAuthoriser['deviceCommitment']>[1],
    Parameters<PassportAuthoriser['deviceCommitment']>[2],
    Exclude<Parameters<NonNullable<PassportAuthoriser['withKeySession']>>[1], undefined>
  >;
  proveTx(
    bytes: Uint8Array,
    prover: Parameters<typeof m.createPassportAccountModule>[0]['prover'],
  ): Promise<{ tx: Uint8Array; provenance: 'remote' }>;
  submit(bytes: Uint8Array): Promise<string>;
  sponsorKeys: { coinPublicKey: string; encryptionPublicKey: string };
}
export async function runNativeHost(io: SignerNativeIO) {
  const result = await baseline({
    ...io,
    qualifyHosted: async (ctx) => {
      const authoriser = hostedJubjubAuthoriser(io.remote.authoriser, io.conversions);
      const point = await authoriser.withKeySession(() => authoriser.devicePublicKey(), {
        kind: 'sign-in',
      });
      if (point.x !== ctx.publicKey.x || point.y !== ctx.publicKey.y)
        throw Error('Authenticated remote key differs from native owner');
      const network = {
        networkId: 'undeployed',
        nodeUrl: 'http://127.0.0.1:19954',
        indexerUrl: 'http://127.0.0.1:18098/api/v4/graphql',
        indexerWsUrl: 'ws://127.0.0.1:18098/api/v4/graphql/ws',
        artefactUrl: 'http://127.0.0.1:18798/v1/zk/acc-s3r1.1',
        bindingId: 'acc-s3r1.1',
        manifestSha256: resolveBinding('acc-s3r1.1').manifestSha256,
      };
      let submits = 0;
      const chain = createMidnightChain({
        network,
        binding: { Contract, ledger, pureCircuits },
        prover: { proveTx: (bytes) => io.proveTx(bytes, ctx.prover) },
        sponsor: { ...ctx.sponsor, supportsShieldedOffers: false },
        sponsorKeys: io.sponsorKeys,
        submitter: {
          submit: async (bytes) => {
            submits++;
            return io.submit(bytes);
          },
        },
      });
      let record: AccountRecord = {
        address: ctx.address,
        bindingId: 'acc-s3r1.1',
        scheme: 'jubjub-schnorr',
        credentialId: io.credentialId,
        localUseCounter: 0n,
      };
      const joiningPublicKey = await m
        .createPasskeyAuthoriser({ keySource: io.grantee })
        .devicePublicKey();
      const hint = {
        address: ctx.address,
        scheme: 'jubjub-schnorr' as const,
        status: 'active' as const,
        publicKey: point,
        credentialId: io.credentialId,
      };
      const ports = {
        bindingId: 'acc-s3r1.1' as const,
        pure: pureCircuits,
        chain,
        authoriser,
        records: {
          read: async () => record,
          write: async (v: AccountRecord) => {
            record = v;
          },
          exists: async () => true,
        },
      };
      const before = await chain.readAccount(ctx.address, {
        includeDevices: true,
        includeInbox: true,
      });
      if (!before || before.entryCount !== 1)
        throw Error('Expected exactly one authority before enrollment');
      io.remote.setDecision('reject');
      let denied = false;
      try {
        await addJubjubAuthorisingDevice({ hint, joiningPublicKey }, ports);
      } catch (error) {
        denied =
          !!error && typeof error === 'object' && 'code' in error && error.code === 'UserCancelled';
      }
      io.remote.setDecision('approve');
      if (!denied || submits !== 0) throw Error('Denied hosted enrollment reached submission');
      const unchanged = await chain.readAccount(ctx.address, {
        includeDevices: true,
        includeInbox: true,
      });
      if (unchanged?.authNonce !== before.authNonce || unchanged?.entryCount !== 1)
        throw Error('Denied enrollment changed canonical state');
      const added = await addJubjubAuthorisingDevice({ hint, joiningPublicKey }, ports);
      if (Number(submits) !== 1 || record.localUseCounter !== added.nextUseCounter)
        throw Error('Hosted enrollment did not submit exactly once and advance its record');
      const after = await chain.readAccount(ctx.address, {
        includeDevices: true,
        includeInbox: true,
      });
      if (
        after?.entryCount !== 2 ||
        after.authNonce <= before.authNonce ||
        !after.hasEntry(Buffer.from(added.commitmentHex, 'hex'))
      )
        throw Error('Canonical authority roster did not advance');
      if (
        JSON.stringify(before.inboxEntries, (_, v) =>
          v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v,
        ) !==
        JSON.stringify(after.inboxEntries, (_, v) =>
          v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v,
        )
      )
        throw Error('Authorising-only enrollment unexpectedly delivered an inbox secret');
      await ctx.reconnect(); // Adds its own distinct baseline case.
      await ctx.holdings();
      const start = io.remote.requestCount();
      for (const kind of [
        'rotate-encryption-key',
        'withdraw-shielded',
        'withdraw-unshielded',
      ] as const) {
        let refused = false;
        try {
          authoriser.withKeySession(async () => {}, { kind, account: ctx.address });
        } catch {
          refused = true;
        }
        if (!refused) throw Error('Unsupported hosted consent was admitted');
      }
      if (io.remote.requestCount() !== start) throw Error('Unsupported consent reached transport');
      io.checkpoint('hosted-sdk-add-device-confirmed', {
        address: ctx.address,
        commitment: added.commitmentHex,
        nextUseCounter: added.nextUseCounter.toString(),
        submits,
      });
      return [
        'real public handlers authenticate the native owner',
        'denied hosted SDK enrollment leaves canonical state unchanged',
        'RC6 add-device proves sponsors and submits once through real handlers',
        'hosted enrollment retains the exact funded holding',
        'unsupported hosted SDK flows remain refused before transport',
      ];
    },
  });
  return {
    ...result,
    kind: 'published-hosted-signer-native',
    authorisingOnly: true,
    readerDelivery: false,
  };
}
