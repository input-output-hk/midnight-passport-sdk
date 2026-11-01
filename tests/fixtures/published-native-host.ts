// Compiled in a fresh external app against the actual public host and RC packages.
// Synthetic local credentials; no signer page or real-provider claim.
import {
  m,
  createLaceWallet,
  type GrantScopeInput,
  type PassportSliceState,
} from '@laceio/sdk/experimental';
import {
  createPassportAccounts,
  createGrantBookkeepingRecovery,
} from '@input-output-hk/mn-passport-account';
import type {
  AccountHint,
  AccountRecord,
  PassportPorts,
} from '@input-output-hk/mn-passport-account/ports';
import {
  Contract,
  ledger,
  pureCircuits,
} from '@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1';
import { resolveBinding } from '@input-output-hk/mn-passport-contract';
import {
  recipeJubjubAuthoriser,
  recipeDeviceKeyring,
  openGrantView,
} from '@input-output-hk/mn-passport-keys';
import {
  createMidnightChain,
  createMidnightGrantSource,
  createMidnightHoldingSource,
  createGraphqlHoldingIndexer,
} from '@input-output-hk/mn-passport-adapter-midnight-js';
import { jubjubGrantInbox } from './jubjub-grant-scope.js';

const NETWORK = {
  networkId: 'undeployed',
  nodeUrl: 'http://127.0.0.1:19954',
  indexerUrl: 'http://127.0.0.1:18098/api/v4/graphql',
  indexerWsUrl: 'ws://127.0.0.1:18098/api/v4/graphql/ws',
  artefactUrl: 'http://127.0.0.1:18798/v1/zk/acc-s3r1.1',
};
const SEED = '0'.repeat(63) + '1'; // The dedicated standalone chain's public genesis seed only.
const proofServerUrl = 'http://127.0.0.1:16310';
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const refuse = async (): Promise<never> => {
  throw Error('This SDK read port must never submit, prove, sponsor or deploy');
};
const hex = (value: Uint8Array) =>
  Array.from(value, (b) => b.toString(16).padStart(2, '0')).join('');
const requireTrue: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw Error(message);
};

export interface HostedNativeContext {
  address: string;
  publicKey: { x: bigint; y: bigint };
  sponsor: { balanceAndSign(bytes: Uint8Array): Promise<Uint8Array> };
  prover: Parameters<typeof m.createPassportAccountModule>[0]['prover'];
  reconnect(): Promise<void>;
  holdings(): Promise<void>;
}
export interface NativeHostIO {
  qualifyHosted?(context: HostedNativeContext): Promise<string[]>;
  owner: m.PasskeySessionKeySource;
  grantee: m.PasskeySessionKeySource;
  credentialId: Uint8Array;
  records: m.AccountRecordStore;
  readRecord(): Promise<m.PassportAccountRecord | undefined>;
  retainBalanced(bytes: Uint8Array, count: number): Promise<void>;
  checkpoint(stage: string, data?: Record<string, string | number | boolean>): void;
}

export async function runNativeHost(io: NativeHostIO) {
  const pin = resolveBinding('acc-s3r1.1');
  const sdkNetwork = { ...NETWORK, bindingId: 'acc-s3r1.1', manifestSha256: pin.manifestSha256 };
  const binding = { Contract, ledger, pureCircuits };
  const cases: string[] = [];
  const proofs: { keyLocation: string; bytes: number }[] = [];
  let sponsorships = 0;
  const baseProver = m.createHttpProver(proofServerUrl, { artefactUrl: NETWORK.artefactUrl });
  const prover: Parameters<typeof m.createPassportAccountModule>[0]['prover'] = {
    ...baseProver,
    prove: async (...args) => {
      const result = await baseProver.prove(...args);
      proofs.push({ keyLocation: args[1], bytes: result.length });
      io.checkpoint('circuit-proved', { keyLocation: args[1], bytes: result.length });
      return result;
    },
  };
  const feeWallet = m.createDevSponsor({ ...NETWORK, seedHex: SEED, proofServerUrl });
  const sponsor = {
    balanceAndSign: async (tx: Uint8Array) => {
      const result = await feeWallet.balanceAndSign(tx);
      sponsorships++;
      // Persist before the public host can submit; a missing account record never proves no send.
      await io.retainBalanced(result, sponsorships);
      io.checkpoint('fee-balanced', { count: sponsorships });
      return result;
    },
  };
  const viewing = m.createPasskeyEncryptionKey(io.owner);
  const authoriser = m.createPasskeyAuthoriser({ keySource: io.owner });
  const sdkOwner = recipeJubjubAuthoriser(io.owner, pureCircuits);
  const [hostPoint, sdkPoint] = await Promise.all([
    authoriser.devicePublicKey(),
    sdkOwner.devicePublicKey(),
  ]);
  requireTrue(
    hostPoint.x === sdkPoint.x && hostPoint.y === sdkPoint.y,
    'Host and RC6 derive different signing identities',
  );
  const [hostReader, sdkReader] = await Promise.all([
    viewing.readerPublicKey('undeployed'),
    recipeDeviceKeyring(io.owner).readerPublicKey('undeployed'),
  ]);
  requireTrue(
    hex(hostReader) === hex(sdkReader),
    'Host and RC6 derive different reader identities',
  );
  io.checkpoint('key-origin-derivation-matched');

  const passport = m.createPassportAccountModule({
    authoriser,
    encryptionKey: viewing,
    sponsor,
    prover,
    network: NETWORK,
    rpId: 'localhost',
    accountRecordStore: io.records,
  });
  const wallet = await createLaceWallet({
    modules: [m.storageInMemory, m.featureDev, passport] as const,
    environment: 'test',
    config: {},
  });
  const state = (): PassportSliceState => {
    const current = wallet.getState().passport;
    requireTrue(current, 'Passport state is absent from the public host module');
    return current;
  };
  const action = async (
    name: string,
    dispatch: () => void,
    check: (s: PassportSliceState) => void,
  ) => {
    requireTrue(['idle', 'ready'].includes(state().flow), 'A host flow was already running');
    let accepted = false;
    let previous: PassportSliceState['flow'] | undefined;
    // Public dispatch schedules action processing; subscribe first so a fast flow cannot
    // hide its ceremony between timer polls. Never redispatch a dropped/uncertain action.
    const subscription = wallet.stateObservables.passport.selectFlow$.subscribe((flow) => {
      if (flow === 'ceremony') accepted = true;
      if (accepted && flow !== previous) {
        previous = flow;
        io.checkpoint('host-flow', { action: name, flow });
      }
    });
    try {
      const acceptanceDeadline = Date.now() + 10000;
      const deadline = Date.now() + 25 * 60_000;
      dispatch();
      for (;;) {
        const current = state();
        if (!accepted) {
          requireTrue(
            Date.now() < acceptanceDeadline,
            'The public host module did not accept the action; do not redispatch',
          );
          await pause(20);
          continue;
        }
        if (current.flow === 'error')
          throw Error(
            'Host action failed: ' +
              name +
              ' ' +
              current.flowError?.code +
              ' ' +
              current.flowError?.message,
          );
        if (current.flow === 'ready') {
          check(current);
          cases.push(name);
          return;
        }
        requireTrue(
          Date.now() < deadline,
          'The host action deadline expired; preserve the pending fixture',
        );
        await pause(100);
      }
    } finally {
      subscription.unsubscribe();
    }
  };
  const credential = io.owner.credentialRef();
  requireTrue(
    credential?.rpId === 'localhost',
    'A retained synthetic localhost credential is required',
  );
  let deposit: m.DevDeposit | undefined;
  try {
    io.checkpoint('sponsor-sync-start');
    await feeWallet.ready();
    io.checkpoint('sponsor-sync-ready');
    await action(
      'public module creates and activates ACC',
      () => wallet.dispatch('passport.createAccount', { lockAccount: true }),
      (s) => {
        requireTrue(
          s.account?.status === 'ready' && /^[a-f0-9]{64}$/.test(s.account.address),
          'Created ACC is not ready',
        );
        requireTrue(
          s.devices.length === 1 && s.devices[0]?.isLocal,
          'Creation did not leave exactly one owner',
        );
      },
    );
    const address = state().account!.address;
    io.checkpoint('account-created', { address });
    const record = await io.readRecord();
    requireTrue(
      record?.address === address && record.deployment === undefined,
      'Creation did not persist a completed record',
    );
    const firstEncKey = state().encKey;
    requireTrue(
      firstEncKey && /^[a-f0-9]{64}$/.test(firstEncKey),
      'Created ACC encryption key is absent',
    );
    // Release the genesis fee wallet before the separate deposit facade can start it.
    await feeWallet.stop();
    deposit = m.createDevDeposit({ seedHex: SEED, network: NETWORK, prover, proofServerUrl });
    const funded = await deposit.depositShielded({ address, amount: 7n });
    requireTrue(
      /^00[a-f0-9]{64}$/.test(funded.txId),
      'The deposit returned no ledger-v9 intent identifier',
    );
    const depositResponse = await fetch(NETWORK.indexerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query:
          'query($offset:TransactionOffset!){transactions(offset:$offset){hash ... on RegularTransaction{identifiers transactionResult{status}}}}',
        variables: { offset: { identifier: funded.txId } },
      }),
      signal: AbortSignal.timeout(15000),
    });
    requireTrue(depositResponse.ok, 'The deposit identifier lookup failed');
    const depositBody = await depositResponse.json();
    requireTrue(
      !depositBody.errors && Array.isArray(depositBody.data?.transactions),
      'The deposit identifier lookup is malformed',
    );
    const matching = depositBody.data.transactions.filter((row: { identifiers?: string[] }) =>
      row.identifiers?.includes(funded.txId),
    );
    requireTrue(
      matching.length === 1 &&
        /^[a-f0-9]{64}$/.test(matching[0]?.hash) &&
        matching[0]?.transactionResult?.status === 'SUCCESS',
      'Deposit did not resolve to one successful canonical transaction',
    );
    const depositTxHash: string = matching[0].hash;
    io.checkpoint('shielded-deposit-confirmed', {
      txId: funded.txId,
      txHash: depositTxHash,
      amount: '7',
    });
    await deposit.stop();
    deposit = undefined;
    cases.push('public development deposit funds shielded NIGHT');
    await action(
      'public module reads chain-confirmed funded holdings',
      () => wallet.dispatch('passport.readShieldedHoldings'),
      (s) => {
        requireTrue(
          s.shieldedHoldings.length === 1 && s.shieldedHoldings[0]?.value === '7',
          'Host holdings do not reflect the exact funded coin',
        );
      },
    );
    const grantee = recipeJubjubAuthoriser(io.grantee, pureCircuits);
    const granteePublicKey = await grantee.devicePublicKeyHex();
    const readPublicKey = hex(await recipeDeviceKeyring(io.grantee).readerPublicKey('undeployed'));
    const scope: GrantScopeInput = {
      grantee: { scheme: 'jubjub-schnorr', publicKey: granteePublicKey },
      operations: ['withdraw-shielded'],
      color: '00'.repeat(32) as GrantScopeInput['color'],
      recipient: { kind: 'any' },
      maxCoinValue: '7',
      perCallCap: '7',
      cap: '7',
      expiresAt: null,
      read: true,
      rpId: 'localhost',
      readPublicKey,
    };
    await action(
      'public module issues and seals a bounded read grant',
      () => wallet.dispatch('passport.issueGrant', scope),
      (s) => {
        requireTrue(
          s.grants.length === 1 && s.grants[0]?.active && s.grants[0]?.scope.read,
          'The read grant is not live',
        );
        requireTrue(
          s.unsealedGrantIds.length === 0 &&
            s.revocationPendingGrantIds.length === 0 &&
            s.droppedDevices.length === 0,
          'Grant issuance left unresolved deliveries',
        );
        requireTrue(s.encKey !== firstEncKey, 'Read grant issuance did not rotate the viewing key');
      },
    );
    const grant = state().grants[0]!;
    const grantId = grant.id;
    requireTrue(
      grant.opening?.view?.readPublicKey === readPublicKey &&
        grant.opening.view.seal?.length === 188,
      'The grantee did not receive a sealed viewing capability',
    );
    const decode = (value: string) =>
      Uint8Array.from(value.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
    const grantSeal = decode(grant.opening.view.seal);
    const readSecret = await io.grantee.deriveSecret({
      domain: 'lace-passport:reader:v1',
      context: 'undeployed',
      length: 32,
    });
    try {
      const secret = await openGrantView(readSecret, {
        account: address,
        grantId,
        seal: grantSeal,
        expectedEncKey: decode(state().encKey!),
      });
      requireTrue(secret?.length === 32, 'RC6 grantee cannot open the host read capability');
      secret.fill(0);
    } finally {
      readSecret.fill(0);
    }
    cases.push('RC6 grantee opens the public-host sealed viewing capability');
    await action(
      'public module preserves holdings through grant rotation',
      () => wallet.dispatch('passport.readShieldedHoldings'),
      (s) => {
        requireTrue(
          s.shieldedHoldings.length === 1 && s.shieldedHoldings[0]?.value === '7',
          'Grant rotation lost or duplicated the funded holding',
        );
      },
    );

    // The SDK consumes the actual public host key source and chain, not a private source alias.
    // Read-only adapters refuse all transaction work; native proofs above belong to the host.
    const sdkAuthoriser = sdkOwner;
    const chain = createMidnightChain({
      network: sdkNetwork,
      binding,
      prover: { proveTx: refuse },
      sponsor: { balanceAndSign: refuse, supportsShieldedOffers: false },
      sponsorKeys: { coinPublicKey: '00'.repeat(32), encryptionPublicKey: '00'.repeat(32) },
      submitter: { submit: refuse },
    });
    const grants = createMidnightGrantSource({
      network: sdkNetwork,
      binding,
      openings: { readReadPublicKey: async () => undefined },
    });
    const indexer = createGraphqlHoldingIndexer({
      networkId: 'undeployed',
      url: NETWORK.indexerUrl,
      wsUrl: NETWORK.indexerWsUrl,
    });
    const directory = new Map<string, AccountHint>();
    let sdkRecord: AccountRecord | undefined;
    const checkedViewing = { ...viewing, ...jubjubGrantInbox(viewing) };
    const ownPoint = await sdkAuthoriser.devicePublicKey();
    const ports: PassportPorts = {
      network: sdkNetwork,
      binding,
      authoriser: sdkAuthoriser,
      encryptionKey: { publicKey: refuse },
      viewingKey: checkedViewing,
      chain,
      deployer: { deploy: refuse },
      directory: {
        get: async () => directory.get('owner'),
        put: async (_network, hint) => {
          directory.set('owner', hint);
        },
      },
      credentials: {
        create: refuse,
        identify: async () => ({
          credentialId: io.credentialId,
          owns: (point) => point.x === ownPoint.x && point.y === ownPoint.y,
        }),
      },
      records: {
        read: async () => sdkRecord,
        write: async (record) => {
          sdkRecord = record;
        },
        exists: async () => sdkRecord !== undefined,
      },
      holdings: createMidnightHoldingSource(indexer),
      readGrants: grants,
      grantRoster: grants,
      grantCommitments: grants,
    };
    const api = createPassportAccounts(ports);
    requireTrue(api.openAccountAt, 'SDK known-address opening is absent');
    const foreignViewing = m.createPasskeyEncryptionKey(io.grantee);
    let foreignRefused = false;
    const foreign = createPassportAccounts({
      ...ports,
      authoriser: grantee,
      viewingKey: foreignViewing,
    });
    requireTrue(foreign.openAccountAt, 'Foreign-reader probe has no address-opening API');
    try {
      await foreign.openAccountAt(address);
    } catch (error) {
      foreignRefused =
        !!error && typeof error === 'object' && 'code' in error && error.code === 'NotAuthorised';
    }
    requireTrue(
      foreignRefused && directory.size === 0 && sdkRecord === undefined,
      'An unrelated local key origin was accepted or changed owner metadata',
    );
    cases.push('unrelated key origin cannot reopen the populated public-host account');
    const opened = await api.openAccountAt(address);
    requireTrue(
      opened.address === address && opened.scheme === 'jubjub-schnorr',
      'SDK opened a different identity',
    );
    const openedState = await opened.state();
    requireTrue(
      openedState.entryCount === 1 && openedState.booted,
      'SDK did not recognise the live owner entry',
    );
    cases.push('RC6 SDK known-address open authenticates public-host account and envelopes');
    requireTrue(opened.readShieldedHoldings, 'RC6 sealed holdings API is absent');
    const held = await opened.readShieldedHoldings();
    requireTrue(
      held.length === 1 && held[0]?.coin.value === 7n,
      'SDK chain-verified holdings differ from the public host',
    );
    requireTrue(opened.grantRoster, 'SDK live grant roster is absent');
    const roster = await opened.grantRoster();
    requireTrue(
      roster.entries.length === 1 && roster.entries[0]?.id === grantId && roster.entries[0]?.active,
      'SDK did not recognise the host read grant',
    );
    cases.push('RC6 SDK reads the same qualified holding and live grant');
    const recovery = createGrantBookkeepingRecovery({
      networkId: 'undeployed',
      origin: 'localhost',
      chain,
      viewingKey: checkedViewing,
      commitments: grants,
      pure: pureCircuits,
    });
    const recovered = await io.owner.withSession(() => recovery.recover(address, grantId));
    requireTrue(
      recovered.grantId === grantId &&
        recovered.readPublicKey === readPublicKey &&
        recovered.granteePublicKey === granteePublicKey,
      'SDK original-reader bookkeeping differs from host grant',
    );
    requireTrue(
      !('granteeScheme' in recovered),
      'Host-only grant scheme leaked through the checked inbox adapter',
    );
    cases.push('RC6 original reader recovers host-published grant bookkeeping');
    await action(
      'public module reconnects by sign-in after SDK reads',
      () => wallet.dispatch('passport.signIn'),
      (s) => {
        requireTrue(
          s.account?.address === address && s.grants[0]?.id === grantId,
          'Sign-in did not recover the same host account and grant',
        );
      },
    );
    await action(
      'public module revokes read grant and reseals owner holdings',
      () => wallet.dispatch('passport.revokeGrant', { grantId }),
      (s) => {
        requireTrue(
          s.grants.some((g) => g.id === grantId && !g.active),
          'Grant revocation did not settle',
        );
        requireTrue(
          s.unsealedGrantIds.length === 0 && s.revocationPendingGrantIds.length === 0,
          'Revocation left unresolved grants',
        );
      },
    );
    const finalHeld = await opened.readShieldedHoldings();
    requireTrue(
      finalHeld.length === 1 && finalHeld[0]?.coin.value === 7n,
      'SDK did not retain the holding after host revocation',
    );
    const finalRoster = await opened.grantRoster();
    requireTrue(
      finalRoster.entries.some((g) => g.id === grantId && !g.active),
      'SDK did not observe the revoked tombstone',
    );
    let refused = false;
    try {
      await io.owner.withSession(() => recovery.recover(address, grantId));
    } catch (error) {
      refused =
        !!error && typeof error === 'object' && 'code' in error && error.code === 'GrantRevoked';
    }
    requireTrue(refused, 'Inactive host grant bookkeeping was not refused by the SDK');
    cases.push('RC6 SDK observes revocation without losing or duplicating the holding');
    const staleReadSecret = await io.grantee.deriveSecret({
      domain: 'lace-passport:reader:v1',
      context: 'undeployed',
      length: 32,
    });
    try {
      const stale = await openGrantView(staleReadSecret, {
        account: address,
        grantId,
        seal: grantSeal,
        expectedEncKey: decode(state().encKey!),
      });
      if (stale) {
        stale.fill(0);
        throw Error('A revoked read seal still opens the fresh account secret');
      }
    } finally {
      staleReadSecret.fill(0);
    }
    cases.push('revoked historical read seal does not open the fresh viewing key');
    if (io.qualifyHosted) {
      cases.push(
        ...(await io.qualifyHosted({
          address,
          publicKey: hostPoint,
          sponsor,
          prover,
          reconnect: () =>
            action(
              'public module reconnects after hosted SDK enrollment',
              () => wallet.dispatch('passport.signIn'),
              (s) => {
                requireTrue(
                  s.account?.address === address && s.devices.length === 2,
                  'Reconnected host did not discover both authorities',
                );
              },
            ),
          holdings: async () => {
            const current = await opened.readShieldedHoldings!();
            requireTrue(
              current.length === 1 && current[0]?.coin.value === 7n,
              'Hosted enrollment changed the funded holding',
            );
          },
        })),
      );
    }
    const actions = await indexer.enumerateContractActions(address);
    const txHashes = [...new Set(actions.map((a) => a.txHash))];
    requireTrue(
      txHashes.includes(depositTxHash),
      'The confirmed deposit is missing from ACC history',
    );
    for (const circuit of [
      'activate_initial_device_with_jubjub',
      'append_inbox_with_jubjub',
      'deposit_shielded',
      'rotate_enc_key_with_jubjub',
      'issue_grant_with_jubjub',
      'revoke_grant_with_jubjub',
    ])
      requireTrue(
        proofs.some(
          (p) =>
            p.keyLocation.split('?')[0]?.endsWith('/' + circuit) ||
            p.keyLocation === 'keys/' + circuit,
        ),
        'Required circuit was not proved: ' + circuit,
      );
    requireTrue(sponsorships > 0, 'No sponsored transaction ran');
    return {
      kind: 'published-host-native-orchestration',
      cases,
      testsPassed: cases.length,
      address,
      grantId,
      depositTxId: funded.txId,
      depositTxHash,
      confirmedContractActions: txHashes,
      proofs,
      sponsorships,
      holding: { value: '7', color: '00'.repeat(32) },
      syntheticCredentials: true,
      keyOriginDerivationMatched: true,
      nativeProof: true,
      hostPublicModule: true,
      sdkReadOnly: !io.qualifyHosted,
      hostSignerHandlers: !!io.qualifyHosted,
      signerPage: false,
      realProvider: false,
      fullCompatibility: false,
    };
  } finally {
    await deposit?.stop();
    await feeWallet.stop();
  }
}
