import type { PassportNameService } from '@input-output-hk/mn-passport-account/names';
import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import { fetchCheckedV1Config, remoteV1Prover } from '@input-output-hk/mn-passport-adapter-service';
import { ARTEFACT_URL, BINDING_ID, MANIFEST_SHA256, SERVICE_URL } from '../connector.js';
import { assertExactNamedNight } from '../consent.js';
import type { DemoActionHost } from '../app-model.js';
import { tracedFetch, traceOperation } from '../operation-trace.js';
import { byId } from '../ui-dom.js';
import type { DevWallet } from '../wallet/contracts.js';
import { createMidnamesIndexer, createMidnamesLedgerReads } from './ledger-reader.js';
import { createConnectedNightSend } from './night-send-host.js';
import {
  openBrowserNightSendJournal,
  type BrowserNightSendRecord,
  type BrowserNightSendScope,
} from './night-send-journal.js';
import { NightDepositInterrupted, type NightSendIntent } from './night-send.js';
import {
  localNightEndpoint,
  namedNightStatus,
  newNamedNightRequest,
} from './night-send-page-state.js';
import { registryProfile } from './registry-pins.js';

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

function selectedScope(account: PassportAccount | undefined): BrowserNightSendScope | undefined {
  if (
    account?.networkId !== 'undeployed' ||
    account.bindingId !== BINDING_ID ||
    account.scheme !== 'jubjub-schnorr' ||
    !/^[a-f0-9]{64}$/.test(account.address) ||
    !(account.credentialId instanceof Uint8Array) ||
    account.credentialId.length !== 32
  )
    return undefined;
  return {
    networkId: 'undeployed',
    source: account.address,
    credentialId: hex(account.credentialId),
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

function reviewText(intent: NightSendIntent, balance: bigint): string {
  return `Send NIGHT to a Passport name?\n\nName: ${intent.name}\nNetwork: ${intent.networkId}\nRegistry: ${intent.providerId.slice('midnames:'.length)}\nSource Passport ACC: ${intent.source}\nRecipient Passport ACC: ${intent.target}\nDevice wallet bridge: ${intent.bridge}\nAmount: ${intent.amount} NIGHT smallest units\nFresh source balance: ${balance} NIGHT smallest units\nOperations: ${intent.operations.join(' → ')}\nRequest: ${intent.requestId}\n\nThe ACC signs withdrawal to the bridge. This app checks the named destination and deposits that exact output into the recipient ACC. The two legs can finish at different times.`;
}

async function connectedPageSend(
  host: DemoActionHost,
  account: PassportAccount,
  wallet: DevWallet,
  resolver: PassportNameService,
  scope: BrowserNightSendScope,
  checkScope: () => void,
) {
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
    !localNightEndpoint(config.indexerUri, 'http') ||
    !localNightEndpoint(config.indexerWsUri, 'ws') ||
    !localNightEndpoint(config.nodeUri, 'ws')
  )
    throw new Error('Named NIGHT payment requires the owned local demo chain endpoints.');
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
  );
  return createConnectedNightSend({
    account,
    scope,
    wallet,
    names: resolver,
    isSupportedRecipient: reader.isSupportedAccount,
    readSourceBalance: async (address) => {
      checkScope();
      const balances = await host.refreshAccountBalances(address);
      checkScope();
      return balances && /^\d+$/.test(balances.night) ? BigInt(balances.night) : undefined;
    },
    async review(intent, balance) {
      host.stage('review');
      if (!window.confirm(reviewText(intent, balance))) {
        traceOperation('namedNight.cancelled', { requestId: intent.requestId });
        return false;
      }
      checkScope();
      host.ownerReview.stageNamedNightWithdrawalReview(account, intent, balance.toString());
      return true;
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
  });
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
    const connected = await connectedPageSend(host, account, wallet, resolver, scope, checkScope);
    try {
      const result = await connected.send(request);
      host.stage('reconcile');
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
          ? 'Both original NIGHT payment legs finalized. The named recipient ACC can now be refreshed.'
          : 'The original NIGHT payment remains pending. Keep its IDs and resume only those legs.',
      );
    } catch (error) {
      if (error instanceof NightDepositInterrupted)
        traceOperation('namedNight.pending', {
          requestId: request.requestId,
          withdrawal: error.withdrawal.hash,
        });
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
