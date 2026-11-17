import type { NightBridgeOutput } from '../midnames/night-bridge-output.js';
import type { NightSendLeg } from '../midnames/night-send.js';
import type { DeviceNightDepositRequest } from './night-deposit.js';

/** The service's `/config` members the wallet needs. */
export interface DevWalletConfig {
  networkId: string;
  indexerUri: string;
  indexerWsUri: string;
  nodeUri: string;
  proofServerUri: string;
}

/** The DApp Connector API's `APIError` shape: `type`, `code` and `reason`. */
export type DevWalletErrorCode = 'InternalError' | 'InvalidRequest' | 'Rejected' | 'Disconnected';
export interface DevWalletApiError extends Error {
  type: 'DAppConnectorAPIError';
  code: DevWalletErrorCode;
  reason: string;
}
export interface DevWalletConnectedApi {
  getConfiguration(): Promise<{
    indexerUri: string;
    indexerWsUri: string;
    substrateNodeUri: string;
    networkId: string;
  }>;
  getConnectionStatus(): Promise<{ status: 'connected'; networkId: string }>;
  getShieldedAddresses(): Promise<{
    shieldedAddress: string;
    shieldedCoinPublicKey: string;
    shieldedEncryptionPublicKey: string;
  }>;
  getUnshieldedAddress(): Promise<{ unshieldedAddress: string }>;
  getDustAddress(): Promise<{ dustAddress: string }>;
  getUnshieldedBalances(): Promise<Record<string, bigint>>;
  getDustBalance(): Promise<{ balance: bigint; cap: bigint }>;
}

export interface DevWalletDescriptor {
  name: string;
  apiVersion: '4.1.0';
  rdns: string;
  connect(networkId: string): Promise<DevWalletConnectedApi>;
}

export interface DevWallet {
  descriptor: DevWalletDescriptor;
  /** Internal device-held NIGHT output observation; never part of the public DApp Connector. */
  nightBridge?: {
    getAddress(): Promise<string>;
    hasOutput(expected: NightBridgeOutput): Promise<boolean>;
    prepareDeposit(request: DeviceNightDepositRequest): Promise<NightSendLeg>;
    submitDeposit(original: NightSendLeg): Promise<string>;
  };
  stop(): Promise<void>;
}
