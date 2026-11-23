import type { PassportNameService } from '@input-output-hk/mn-passport-account/names';
import type { NetworkConfig, Prover } from '@input-output-hk/mn-passport-account/ports';
import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import { pinnedVerifierRoster } from '@input-output-hk/mn-passport-contract';
import {
  assertNightDepositPreflight,
  proveUnboundNightDeposit,
  type MidnightBinding,
} from '@input-output-hk/mn-passport-adapter-midnight-js';
import { exactNightBridgeOutput } from './night-bridge-output.js';
import { localNightBinding } from './local-binding.js';
import { validNightCredentialBytes } from './night-send-credential.js';
import { readFinalizedNightLeg } from './night-finality.js';
import {
  sendNightByName,
  type NightSendIntent,
  type NightSendLeg,
  type NightSendRequest,
  type NightUnresolvedObservation,
} from './night-send.js';
import { createNightOwnerWithdrawal } from './night-send-owner.js';
import {
  openBrowserNightSendJournal,
  type BrowserNightSendScope,
  type BrowserNightSendRecord,
} from './night-send-journal.js';
import type { DevWallet } from '../wallet/contracts.js';

interface ConnectedNightSendOptions {
  readonly account: PassportAccount;
  readonly scope: BrowserNightSendScope;
  readonly wallet: DevWallet;
  readonly names: PassportNameService;
  readonly isSupportedRecipient: (address: string, networkId: string) => Promise<boolean>;
  readonly readSourceBalance: (address: string) => Promise<bigint | undefined>;
  readonly review: (intent: NightSendIntent, balance: bigint) => Promise<boolean>;
  /** Fresh approval to finish only the saved deposit at its original ACC after the name moves. */
  readonly reviewOriginalDeposit?: (
    original: NightSendIntent,
    current: NightSendIntent,
    withdrawal: NightSendLeg,
  ) => Promise<boolean>;
  readonly reviewUnresolvedOriginalDeposit?: (
    original: NightSendIntent,
    observation: NightUnresolvedObservation,
    withdrawal: NightSendLeg,
  ) => Promise<boolean>;
  /** Check that the selected account, credential and wallet still match this host. */
  readonly checkScope: () => void;
  /** Check the exact named route after the actual owner credential ceremony. */
  readonly checkApproved: (intent: NightSendIntent) => void;
  /** Progress presentation only; never authorizes or retries a payment leg. */
  readonly onDeposit?: () => void;
  readonly network: NetworkConfig;
  readonly binding: MidnightBinding;
  readonly prover: Prover;
  /** Opt in only after the exact local candidate build and registry profile are checked. */
  readonly provisionalLocal?: boolean;
}

interface ConnectedNightSendDeps {
  readonly journal: typeof openBrowserNightSendJournal;
  readonly finalized: typeof readFinalizedNightLeg;
  readonly prove: typeof proveUnboundNightDeposit;
}

const live: ConnectedNightSendDeps = {
  journal: openBrowserNightSendJournal,
  finalized: readFinalizedNightLeg,
  prove: proveUnboundNightDeposit,
};
const ADDRESS = /^[a-f0-9]{64}$/;
const FENCE_PREFLIGHT_ERROR =
  'The selected chain cannot fence a finalized withdrawal before submission.';
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

function matchingCandidateJournalScope(
  scope: BrowserNightSendScope,
  network: NetworkConfig,
): boolean {
  if (network.bindingId === 'acc-s3r1.1-zkir036')
    return scope.bindingId === network.bindingId && scope.manifestSha256 === network.manifestSha256;
  return scope.bindingId === undefined && scope.manifestSha256 === undefined;
}

function checkedSelection(options: ConnectedNightSendOptions) {
  const { account, wallet } = options;
  const scope = Object.freeze({ ...options.scope });
  const network = Object.freeze({ ...options.network });
  if (
    network.networkId !== 'undeployed' ||
    !localNightBinding(network.bindingId, network.manifestSha256, options.provisionalLocal) ||
    scope.networkId !== network.networkId ||
    scope.source !== account.address ||
    !matchingCandidateJournalScope(scope, network) ||
    !validNightCredentialBytes(account.credentialId) ||
    hex(account.credentialId) !== scope.credentialId ||
    account.networkId !== network.networkId ||
    account.bindingId !== network.bindingId ||
    account.scheme !== 'jubjub-schnorr' ||
    !ADDRESS.test(network.manifestSha256) ||
    !network.indexerUrl ||
    !network.indexerWsUrl ||
    !network.nodeUrl ||
    !network.artefactUrl ||
    typeof options.binding.Contract !== 'function' ||
    typeof options.binding.ledger !== 'function' ||
    typeof options.prover.proveTx !== 'function' ||
    options.names.provider.mode !== 'external' ||
    !/^midnames:[a-f0-9]{64}$/.test(options.names.provider.id) ||
    options.names.provider.namespace !== 'night'
  )
    throw new Error('The selected ACC, name service, or device wallet cannot send NIGHT by name.');
  const recipientVerifierRoster = pinnedVerifierRoster(network.bindingId);
  if (network.bindingId === 'acc-s3r1.1-zkir036')
    // Structural preflight only. The resolved recipient and real wallet keys are
    // checked again by the adapter after withdrawal finality, before proving.
    assertNightDepositPreflight({
      network,
      binding: options.binding,
      target: '0'.repeat(64),
      amount: 1n,
      walletKeys: { coinPublicKey: 'preflight', encryptionPublicKey: 'preflight' },
      prover: options.prover,
      recipientVerifierRoster,
      provisionalLocal: !!options.provisionalLocal,
    });
  const bridge = wallet.nightBridge;
  if (!bridge)
    throw new Error('The selected ACC, name service, or device wallet cannot send NIGHT by name.');
  return { scope, network, bridge, recipientVerifierRoster };
}

function checkedRecoveryReview(options: ConnectedNightSendOptions, checkSelected: () => void) {
  const review = options.reviewOriginalDeposit;
  if (!review) return undefined;
  return async (original: NightSendIntent, current: NightSendIntent, withdrawal: NightSendLeg) => {
    checkSelected();
    const approved = await review(original, current, withdrawal);
    checkSelected();
    return approved;
  };
}

function checkedUnresolvedReview(options: ConnectedNightSendOptions, checkSelected: () => void) {
  const review = options.reviewUnresolvedOriginalDeposit;
  if (!review) return undefined;
  return async (
    original: NightSendIntent,
    observation: NightUnresolvedObservation,
    withdrawal: NightSendLeg,
  ) => {
    checkSelected();
    const approved = await review(original, observation, withdrawal);
    checkSelected();
    return approved;
  };
}

function checkedRecoveryCallbacks(options: ConnectedNightSendOptions, checkSelected: () => void) {
  const reviewOriginalDeposit = checkedRecoveryReview(options, checkSelected);
  const reviewUnresolvedOriginalDeposit = checkedUnresolvedReview(options, checkSelected);
  return {
    ...(reviewOriginalDeposit && { reviewOriginalDeposit }),
    ...(reviewUnresolvedOriginalDeposit && { reviewUnresolvedOriginalDeposit }),
  };
}

/** Compose the owner and device-held wallet without giving the resolver signing authority. */
export async function createConnectedNightSend(
  options: ConnectedNightSendOptions,
  factory: IDBFactory = indexedDB,
  deps: ConnectedNightSendDeps = live,
) {
  const { account, wallet } = options;
  const { scope, network, bridge, recipientVerifierRoster } = checkedSelection(options);
  const checkSelected = () => {
    options.checkScope();
    if (
      account.address !== scope.source ||
      account.networkId !== network.networkId ||
      account.bindingId !== network.bindingId ||
      account.scheme !== 'jubjub-schnorr' ||
      !validNightCredentialBytes(account.credentialId) ||
      hex(account.credentialId) !== scope.credentialId
    )
      throw new Error('The selected NIGHT owner changed. Reopen the original payment.');
  };
  checkSelected();
  const connected = await wallet.descriptor.connect(network.networkId);
  const configuration = await connected.getConfiguration();
  if (
    configuration.networkId !== network.networkId ||
    configuration.indexerUri !== network.indexerUrl ||
    configuration.indexerWsUri !== network.indexerWsUrl ||
    configuration.substrateNodeUri !== network.nodeUrl
  )
    throw new Error('The device wallet and named-send chain configuration differ.');
  const rawBridge = await bridge.getAddress();
  if (!ADDRESS.test(rawBridge)) throw new Error('The device-held NIGHT bridge is invalid.');
  const finalized = async (original: NightSendLeg) =>
    deps.finalized(network.indexerUrl, network.nodeUrl, original);
  const ownerWithdrawal = createNightOwnerWithdrawal(
    account,
    (intent) => {
      checkSelected();
      options.checkApproved(intent);
      checkSelected();
    },
    { manifestSha256: network.manifestSha256, provisionalLocal: !!options.provisionalLocal },
  );
  return {
    async send(request: NightSendRequest) {
      checkSelected();
      if (request.bridge !== rawBridge || (await bridge.getAddress()) !== rawBridge)
        throw new Error('The reviewed NIGHT bridge differs from this wallet.');
      const journal = await deps.journal(factory, scope);
      try {
        const result = await sendNightByName(request, {
          names: options.names,
          journal,
          isSupportedRecipient: options.isSupportedRecipient,
          readSourceBalance: options.readSourceBalance,
          async review(intent, balance) {
            checkSelected();
            const approved = await options.review(intent, balance);
            checkSelected();
            return approved;
          },
          ...checkedRecoveryCallbacks(options, checkSelected),
          async submitWithdrawal(intent, beforeSubmit) {
            checkSelected();
            await ownerWithdrawal(intent, async (submission) => {
              checkSelected();
              await beforeSubmit(submission);
              checkSelected();
            });
          },
          finalized: async (original) => !!(await finalized(original)),
          async prepareDeposit(intent, withdrawal) {
            checkSelected();
            options.onDeposit?.();
            const observed = await finalized(withdrawal);
            if (!observed) throw new Error('The original NIGHT withdrawal is not final.');
            const output = exactNightBridgeOutput(intent, withdrawal, observed.transaction);
            if (!(await bridge.hasOutput(output)))
              throw new Error('The device wallet has not observed the original NIGHT output.');
            checkSelected();
            const keys = await wallet.descriptor.connect(network.networkId);
            const addresses = await keys.getShieldedAddresses();
            const proven = await deps.prove({
              network,
              binding: options.binding,
              target: intent.target,
              amount: BigInt(intent.amount),
              walletKeys: {
                coinPublicKey: addresses.shieldedCoinPublicKey,
                encryptionPublicKey: addresses.shieldedEncryptionPublicKey,
              },
              prover: options.prover,
              recipientVerifierRoster,
              provisionalLocal: !!options.provisionalLocal,
            });
            checkSelected();
            const original = await bridge.prepareDeposit({
              scope,
              target: intent.target,
              output,
              proven,
            });
            return {
              original,
              async dispatch() {
                checkSelected();
                await bridge.submitDeposit(original);
              },
            };
          },
        });
        if (result.phase === 'completed' && result.deposit) {
          const retained = await journal.readIntent();
          if (!retained) throw new Error('The original NIGHT payment intent is missing.');
          await journal.archiveCompleted(
            retained,
            result.withdrawal,
            result.deposit,
            async (original) => !!(await finalized(original)),
          );
        }
        return result;
      } catch (error) {
        // The account core rejects this specific unsupported chain before credential use.
        // Keep its exact request in history; all later failures retain the active fence.
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'BindingUnsupported' &&
          error.message === FENCE_PREFLIGHT_ERROR
        ) {
          const intent = await journal.readIntent();
          if (intent?.requestId === request.requestId) await journal.retireUnsupportedFence(intent);
        }
        throw error;
      } finally {
        journal.close();
      }
    },
    async readActive(): Promise<BrowserNightSendRecord | undefined> {
      checkSelected();
      const journal = await deps.journal(factory, scope);
      try {
        return await journal.readActive();
      } finally {
        journal.close();
      }
    },
  };
}
