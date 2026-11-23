import type { PassportNameService } from '@input-output-hk/mn-passport-account/names';
import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import { fetchCheckedV1Config, remoteV1Prover } from '@input-output-hk/mn-passport-adapter-service';
import { resolveBinding } from '@input-output-hk/mn-passport-contract';
import type { NetworkConfig } from '@input-output-hk/mn-passport-account/ports';
import { ARTEFACT_URL, BINDING_ID, MANIFEST_SHA256, SERVICE_URL } from '../connector.js';
import { assertExactNamedNight } from '../consent.js';
import type { DemoActionHost } from '../app-model.js';
import { tracedFetch, traceOperation } from '../operation-trace.js';
import { byId } from '../ui-dom.js';
import type { DevWallet } from '../wallet/contracts.js';
import { createMidnamesIndexer, createMidnamesLedgerReads } from './ledger-reader.js';
import { localCandidateAccount } from './candidate-account.js';
import { createConnectedNightSend } from './night-send-host.js';
import { localNightBinding } from './local-binding.js';
import { validNightCredentialBytes } from './night-send-credential.js';
import {
  openBrowserNightSendJournal,
  type BrowserNightSendRecord,
  type BrowserNightSendScope,
} from './night-send-journal.js';
import {
  NightDepositInterrupted,
  type NightSendIntent,
  type NightSendLeg,
  type NightSendRequest,
  type NightUnresolvedObservation,
} from './night-send.js';
import {
  namedNightStatus,
  newNamedNightRequest,
  requiresNewNightLegFee,
  sameLocalNightIndexer,
  localNightService,
} from './night-send-page-state.js';
import { registryProfile } from './registry-pins.js';

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

function selectedScope(account: PassportAccount | undefined): BrowserNightSendScope | undefined {
  const candidate = localCandidateAccount(
    BINDING_ID,
    MANIFEST_SHA256,
    import.meta.env.VITE_MIDNAMES_REGISTRY_PROFILE,
  );
  if (
    account?.networkId !== 'undeployed' ||
    account.bindingId !== BINDING_ID ||
    !localNightBinding(account.bindingId, MANIFEST_SHA256, !!candidate) ||
    account.scheme !== 'jubjub-schnorr' ||
    !/^[a-f0-9]{64}$/.test(account.address) ||
    !validNightCredentialBytes(account.credentialId)
  )
    return undefined;
  return {
    networkId: 'undeployed',
    source: account.address,
    credentialId: hex(account.credentialId),
    ...(candidate && { bindingId: BINDING_ID, manifestSha256: MANIFEST_SHA256 }),
  };
}

async function readActive(
  scope: BrowserNightSendScope,
): Promise<BrowserNightSendRecord | undefined> {
  const journal = await openBrowserNightSendJournal(indexedDB, scope);
  try {
    return await journal.readActive();
  } finally {
    journal.close();
  }
}

function reviewText(intent: NightSendIntent, balance: bigint, candidate: boolean): string {
  return `Send NIGHT to a Passport name?\n\nName: ${intent.name}\nNetwork: ${intent.networkId}\nSource binding: ${BINDING_ID}${candidate ? ` (local candidate ${MANIFEST_SHA256})` : ''}\nRecipient binding: ${intent.recipientBindingId ?? BINDING_ID}\nRegistry: ${intent.providerId.slice('midnames:'.length)}\nSource Passport ACC: ${intent.source}\nRecipient Passport ACC: ${intent.target}\nDevice wallet bridge: ${intent.bridge}\nAmount: ${intent.amount} NIGHT smallest units\nFresh source balance: ${balance} NIGHT smallest units\nOperations: ${intent.operations.join(' → ')}\nRequest: ${intent.requestId}\n\nThe ACC signs withdrawal to the bridge. This app checks the named destination and deposits that exact output into the recipient ACC. The two legs can finish at different times.`;
}

function originalDepositReviewText(
  original: NightSendIntent,
  current: NightSendIntent,
  withdrawal: NightSendLeg,
): string {
  return `The name changed after your NIGHT withdrawal.\n\nName: ${original.name}\nNetwork: ${original.networkId}\nRegistry: ${original.providerId.slice('midnames:'.length)}\nOriginally reviewed Passport ACC: ${original.target}\nOriginal binding: ${original.recipientBindingId ?? BINDING_ID}\nCurrent named Passport ACC: ${current.target}\nCurrent binding: ${current.recipientBindingId ?? BINDING_ID}\nAmount: ${original.amount} NIGHT smallest units\nSaved withdrawal: ${withdrawal.hash}\nOperation now: deposit_unshielded into the originally reviewed ACC\nRequest: ${original.requestId}\n\nContinue the original deposit into ${original.target}? This uses only the saved withdrawal output. It does not withdraw again or redirect the payment to the new named ACC. Declining leaves the original withdrawal and its output pending for inspection.`;
}

function unresolvedDepositReviewText(
  original: NightSendIntent,
  observation: NightUnresolvedObservation,
  withdrawal: NightSendLeg,
): string {
  const status = {
    Absent: 'The name service reports no current record.',
    InvalidRecord: 'The name service returned an invalid or non-contract record.',
    Expired: 'The name record is expired.',
    Unavailable: 'The current name or target binding could not be verified.',
    UnsupportedTarget: 'The current name target is not a supported recipient ACC.',
  }[observation.reason];
  return `Finish the saved NIGHT withdrawal at its original ACC?\n\nName: ${original.name}\nNetwork: ${original.networkId}\nRegistry: ${original.providerId.slice('midnames:'.length)}\nCurrent name status: ${status}${observation.currentTarget ? `\nCurrent reported target: ${observation.currentTarget}` : ''}\nOriginally reviewed Passport ACC: ${original.target}\nOriginal binding: ${original.recipientBindingId ?? BINDING_ID}\nAmount: ${original.amount} NIGHT smallest units\nSaved withdrawal: ${withdrawal.hash}\nOperation now: deposit_unshielded into the originally reviewed ACC\nRequest: ${original.requestId}\n\nThis is direct recovery of the saved output, not a new named payment. The current name does not authorize this destination. The original ACC binding and saved output will be checked again before submission. No second withdrawal or redirect will occur. Declining keeps the original pending.`;
}

async function checkedOldRecipientPageRoute(network: NetworkConfig, candidate: boolean) {
  const service = import.meta.env.VITE_MIDNAMES_NIGHT_RECIPIENT_SERVICE_URL;
  const enabled = import.meta.env.VITE_MIDNAMES_NIGHT_MIXED_RECIPIENT === '1';
  if (service && (!candidate || !enabled || !localNightService(service)))
    throw new Error('The old recipient proof service requires an exact local candidate origin.');
  if (candidate && enabled && !service)
    throw new Error('Configure the old recipient proof service before a mixed named payment.');
  if (!service) return undefined;
  const pin = resolveBinding('acc-s3r1.1');
  const config = await fetchCheckedV1Config(
    service,
    {
      networkId: network.networkId,
      bindingId: 'acc-s3r1.1',
      manifestSha256: pin.manifestSha256,
      artefactUrl: `${service.replace(/\/+$/, '')}/v1/zk/acc-s3r1.1`,
    },
    { fetch: tracedFetch },
  );
  if (
    config.indexerUri !== network.indexerUrl ||
    config.indexerWsUri !== network.indexerWsUrl ||
    config.nodeUri !== network.nodeUrl
  )
    throw new Error('The old recipient proof service must use the source chain.');
  return {
    network: {
      networkId: network.networkId,
      bindingId: 'acc-s3r1.1',
      manifestSha256: pin.manifestSha256,
      indexerUrl: config.indexerUri,
      indexerWsUrl: config.indexerWsUri,
      nodeUrl: config.nodeUri,
      artefactUrl: config.zkBaseUrl,
    },
    prover: remoteV1Prover(service, { fetch: tracedFetch }),
  };
}

async function connectedPageSend(
  host: DemoActionHost,
  account: PassportAccount,
  wallet: DevWallet,
  resolver: PassportNameService,
  scope: BrowserNightSendScope,
  checkScope: () => void,
  active: BrowserNightSendRecord | undefined,
) {
  const candidate = localCandidateAccount(
    BINDING_ID,
    MANIFEST_SHA256,
    import.meta.env.VITE_MIDNAMES_REGISTRY_PROFILE,
  );
  if (candidate && !localNightService(SERVICE_URL))
    throw new Error('The candidate NIGHT proof service must use an exact local origin.');
  const config = await fetchCheckedV1Config(
    SERVICE_URL,
    {
      networkId: scope.networkId,
      bindingId: BINDING_ID,
      manifestSha256: MANIFEST_SHA256,
      artefactUrl: ARTEFACT_URL,
    },
    { fetch: tracedFetch },
  );
  if (
    !sameLocalNightIndexer(
      config,
      import.meta.env.VITE_MIDNAMES_INDEXER_URL,
      import.meta.env.VITE_MIDNAMES_INDEXER_WS_URL,
    )
  )
    throw new Error('Named NIGHT payment requires one matching local Midnames and ACC indexer.');
  checkScope();
  const network = {
    networkId: scope.networkId,
    bindingId: BINDING_ID,
    manifestSha256: MANIFEST_SHA256,
    indexerUrl: config.indexerUri,
    indexerWsUrl: config.indexerWsUri,
    nodeUrl: config.nodeUri,
    artefactUrl: config.zkBaseUrl,
  };
  const { accModule } = await import('../acc-module.js');
  const reader = createMidnamesLedgerReads(
    createMidnamesIndexer(scope.networkId, network.indexerUrl, network.indexerWsUrl),
    scope.networkId,
    BINDING_ID,
    registryProfile(import.meta.env.VITE_MIDNAMES_REGISTRY_PROFILE, scope.networkId),
    candidate,
    undefined,
    undefined,
    candidate && import.meta.env.VITE_MIDNAMES_NIGHT_MIXED_RECIPIENT === '1'
      ? 'acc-s3r1.1'
      : undefined,
  );
  const oldRecipient = await checkedOldRecipientPageRoute(network, !!candidate);
  if (requiresNewNightLegFee(active)) {
    const feeWallet = await wallet.descriptor.connect(scope.networkId);
    const dust = await feeWallet.getDustBalance();
    checkScope();
    if (dust.balance <= 0n)
      throw new Error(
        'Fund the built-in wallet and wait for its DUST balance before sending NIGHT.',
      );
  }
  return createConnectedNightSend({
    account,
    scope,
    wallet,
    names: resolver,
    isSupportedRecipient: async (address, networkId) =>
      (await reader.readSupportedAccountBinding(address, networkId)) ?? false,
    readSourceBalance: async (address) => {
      checkScope();
      const balance = await reader.readSupportedNightBalance(address, scope.networkId);
      checkScope();
      return balance;
    },
    async review(intent, balance) {
      host.stage('review');
      if (!window.confirm(reviewText(intent, balance, !!candidate))) {
        traceOperation('namedNight.cancelled', { requestId: intent.requestId });
        return false;
      }
      checkScope();
      host.ownerReview.stageNamedNightWithdrawalReview(
        account,
        intent,
        balance.toString(),
        candidate ? { manifestSha256: MANIFEST_SHA256, provisionalLocal: true } : undefined,
      );
      return true;
    },
    async reviewOriginalDeposit(original, current, withdrawal) {
      host.stage('review');
      const approved = window.confirm(originalDepositReviewText(original, current, withdrawal));
      checkScope();
      traceOperation(
        approved ? 'namedNight.originalDepositApproved' : 'namedNight.originalDepositDeclined',
        {
          requestId: original.requestId,
          withdrawal: withdrawal.hash,
        },
      );
      return approved;
    },
    async reviewUnresolvedOriginalDeposit(original, observation, withdrawal) {
      host.stage('review');
      const approved = window.confirm(
        unresolvedDepositReviewText(original, observation, withdrawal),
      );
      checkScope();
      traceOperation(
        approved ? 'namedNight.originalRepairApproved' : 'namedNight.originalRepairDeclined',
        { requestId: original.requestId, withdrawal: withdrawal.hash, reason: observation.reason },
      );
      return approved;
    },
    checkScope,
    checkApproved(intent) {
      host.stage('withdraw');
      assertExactNamedNight(intent);
    },
    onDeposit: () => host.stage('deposit'),
    network,
    binding: accModule,
    prover: remoteV1Prover(SERVICE_URL, { fetch: tracedFetch }),
    ...(oldRecipient && {
      oldRecipient: {
        ...oldRecipient,
        binding: accModule,
      },
    }),
    provisionalLocal: !!candidate,
  });
}

type ConnectedNightResult = Awaited<
  ReturnType<Awaited<ReturnType<typeof connectedPageSend>>['send']>
>;

async function settleSubmittedDeposit(
  initial: ConnectedNightResult,
  request: NightSendRequest,
  connected: Awaited<ReturnType<typeof connectedPageSend>>,
  checkScope: () => void,
) {
  if (initial.phase !== 'deposit-pending') return initial;
  const withdrawalHash = initial.withdrawal.hash;
  const depositHash = initial.deposit.hash;
  const deadline = Date.now() + 10 * 60_000;
  let result: ConnectedNightResult = initial;
  while (Date.now() < deadline && result.phase === 'deposit-pending') {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 5_000));
    checkScope();
    const retained = await connected.readActive();
    if (
      retained?.intent.requestId !== request.requestId ||
      retained.withdrawal?.hash !== withdrawalHash ||
      retained.deposit?.hash !== depositHash
    )
      throw new Error('The saved NIGHT payment changed while awaiting finality.');
    result = await connected.send(request);
    if (result.withdrawal.hash !== withdrawalHash || result.deposit?.hash !== depositHash)
      throw new Error('The reconciled NIGHT payment differs from its original IDs.');
  }
  return result;
}

/** Reference-page action; the journal, wallet and owner remain separate authorities. */
export function createNamedNightPage(
  host: DemoActionHost,
  names: () => PassportNameService | undefined,
) {
  const recipient = byId<HTMLInputElement>('named-night-recipient');
  const amount = byId<HTMLInputElement>('named-night-amount');
  const button = byId<HTMLButtonElement>('sendNamedNight');
  const status = byId('named-night-status');
  const panel = byId('account-named-night');
  const inspect = async () => {
    const account = host.state.account;
    const scope = selectedScope(account);
    if (!scope) {
      panel.dataset.blocked = 'true';
      status.textContent = 'Open a supported JubJub Passport ACC to inspect its original payment.';
      return;
    }
    const active = await readActive(scope);
    if (host.state.account !== account) return;
    panel.dataset.blocked = String(!!active && !active.withdrawal);
    status.textContent = namedNightStatus(active);
    button.textContent = active ? 'Resume original NIGHT payment' : 'Review named NIGHT payment';
    if (active) {
      recipient.value = active.intent.name;
      amount.value = active.intent.amount;
    }
    return active;
  };
  const send = async () => {
    const account = host.state.account;
    const wallet = host.state.devWallet;
    const resolver = names();
    const scope = selectedScope(account);
    if (!account || !scope || !resolver || !wallet?.nightBridge)
      throw new Error(
        'Open a JubJub Passport ACC, configure local Midnames, and connect the built-in wallet first.',
      );
    if (host.state.receiptStorageFailed)
      throw new Error(
        'Inspect Audit and restore transaction receipt storage before sending value.',
      );
    const checkScope = () => {
      if (
        host.state.account !== account ||
        host.state.devWallet !== wallet ||
        host.state.receiptStorageFailed
      )
        throw new Error(
          'The selected account, wallet or receipt store changed. Reopen the original payment.',
        );
    };
    host.stage('resolve');
    const active = await readActive(scope);
    checkScope();
    if (active && !active.withdrawal)
      throw new Error(
        'The original owner attempt has no transaction ID. Inspect it before another payment.',
      );
    if (
      active &&
      !window.confirm(`${namedNightStatus(active)}\n\nCheck only these original legs now?`)
    )
      return;
    const bridge = await wallet.nightBridge.getAddress();
    checkScope();
    const request =
      active?.intent ??
      newNamedNightRequest({
        requestId: crypto.randomUUID(),
        name: recipient.value,
        amount: amount.value,
        networkId: account.networkId,
        source: account.address,
        bridge,
      });
    const connected = await connectedPageSend(
      host,
      account,
      wallet,
      resolver,
      scope,
      checkScope,
      active,
    );
    try {
      const submitted = await connected.send(request);
      host.stage('reconcile');
      if (submitted.phase === 'deposit-pending')
        host.status('Both original NIGHT payment IDs are saved. Checking their finality.');
      const result = await settleSubmittedDeposit(submitted, request, connected, checkScope);
      host.record('namedNightPayment', {
        requestId: request.requestId,
        phase: result.phase,
        withdrawal: result.withdrawal.hash,
        ...(result.deposit && { deposit: result.deposit.hash }),
      });
      traceOperation('namedNight.phase', {
        requestId: request.requestId,
        phase: result.phase,
        withdrawal: result.withdrawal.hash,
        ...(result.deposit && { deposit: result.deposit.hash }),
      });
      if (result.phase !== 'completed')
        traceOperation('namedNight.pending', { requestId: request.requestId });
      await inspect();
      host.status(
        result.phase === 'completed'
          ? 'Both original NIGHT payment legs finalized. Refresh the originally reviewed recipient ACC to check its balance.'
          : 'The original NIGHT payment remains pending. Keep its IDs and resume only those legs.',
      );
    } catch (error) {
      if (error instanceof NightDepositInterrupted) {
        traceOperation('namedNight.pending', {
          requestId: request.requestId,
          withdrawal: error.withdrawal.hash,
        });
      }
      try {
        const retained = await readActive(scope);
        if (retained && !retained.withdrawal)
          traceOperation('namedNight.pending', { requestId: retained.intent.requestId });
        await inspect();
      } catch {
        status.textContent =
          'The original NIGHT payment journal needs inspection. Do not start another payment.';
      }
      throw error;
    }
  };
  return { inspect, send };
}
