import { createAgentGrantSpendJournal } from '@input-output-hk/mn-passport-account';
import { createMidnightGrantSource } from '@input-output-hk/mn-passport-adapter-midnight-js';
import { ledger } from '@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1';
import { fileMutationByteStore } from '@input-output-hk/mn-passport-service';
import { createHostTransactionFinality } from '@input-output-hk/mn-passport-service/finality';
import { protocolVersionToLedger } from '@midnight-ntwrk/midnight-js-protocol';
import { Transaction } from '@midnightntwrk/ledger-v9';
import type { FundingConfig } from './config.ts';
import { deployedAddresses } from './deployments.ts';
import { sessionWithdrawalRecoveryRoute } from './session-withdrawal-recovery.ts';

export const sessionSpendJournal = (config: FundingConfig) =>
  createAgentGrantSpendJournal(fileMutationByteStore(`${config.reservationsFile}.session-spends`));

export function sessionWithdrawalRecovery(
  config: FundingConfig,
  authorize: (header: string | undefined) => boolean,
) {
  if (
    config.networkId !== 'undeployed' ||
    config.bindingId !== 'acc-s3r1.1' ||
    !['127.0.0.1', 'localhost', '::1'].includes(config.host)
  )
    return undefined;
  const network = {
    networkId: config.networkId,
    bindingId: config.bindingId,
    manifestSha256: config.manifestSha256,
    indexerUrl: config.indexerUri,
    indexerWsUrl: config.indexerWsUri,
    nodeUrl: config.nodeUri,
  };
  return sessionWithdrawalRecoveryRoute({
    authorize,
    eligible: (address) => deployedAddresses(config.deploymentsFile, config.networkId).has(address),
    receipts: sessionSpendJournal(config),
    grants: createMidnightGrantSource({
      network,
      binding: { ledger },
      openings: { readReadPublicKey: async () => undefined },
    }),
    finality: createHostTransactionFinality({
      ...network,
      ledger: { Transaction },
      versionOfRecord(record) {
        const version = (record as { protocolVersion?: unknown }).protocolVersion;
        return typeof version === 'number' ? protocolVersionToLedger(version, 'read') : '';
      },
    }),
  });
}
