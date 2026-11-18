import type {
  CallRequest,
  NetworkConfig,
  TxResult,
} from '@input-output-hk/mn-passport-account/ports';
import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import { createMidnightChain } from '@input-output-hk/mn-passport-adapter-midnight-js';
import { remoteV1Prover, remoteV1Sponsor } from '@input-output-hk/mn-passport-adapter-service';
import { accModule } from '../acc-module.js';
import { tracedFetch } from '../operation-trace.js';
import type { DevWallet } from '../wallet/contracts.js';
import { validNightCredentialBytes } from './night-send-credential.js';

const NIGHT = '00'.repeat(32);
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

function selectedNightOwner(
  account: PassportAccount | undefined,
  request: CallRequest,
  network: NetworkConfig,
): account is PassportAccount & { credentialId: Uint8Array } {
  return !!(
    account &&
    account.address === request.address &&
    account.networkId === network.networkId &&
    account.bindingId === network.bindingId &&
    account.scheme === 'jubjub-schnorr' &&
    validNightCredentialBytes(account.credentialId)
  );
}

/** One host-owned fenced withdrawal: the device wallet pays Dust and signs no value input. */
export async function fencedNightValueCall(
  request: CallRequest,
  selected: () => { readonly account?: PassportAccount; readonly wallet?: DevWallet },
  network: NetworkConfig,
  serviceUrl: string,
): Promise<TxResult> {
  const { account, wallet } = selected();
  const bridge = wallet?.nightBridge;
  const [color, amount, recipient] = request.args;
  const recipientBytes =
    recipient && typeof recipient === 'object' && 'bytes' in recipient
      ? recipient.bytes
      : undefined;
  if (
    !request.beforeSubmit ||
    request.circuit !== 'withdraw_unshielded_with_jubjub' ||
    network.networkId !== 'undeployed' ||
    !selectedNightOwner(account, request, network) ||
    !bridge ||
    !(color instanceof Uint8Array) ||
    hex(color) !== NIGHT ||
    typeof amount !== 'bigint' ||
    amount <= 0n ||
    amount >= 1n << 128n
  )
    throw new Error('The selected owner and wallet cannot fence this NIGHT withdrawal.');
  if (!(recipientBytes instanceof Uint8Array) || recipientBytes.length !== 32)
    throw new Error('The withdrawal output is not one wallet address.');
  const rawBridge = await bridge.getAddress();
  if (hex(recipientBytes) !== rawBridge)
    throw new Error('The withdrawal output differs from the selected device wallet.');
  const scope = {
    networkId: 'undeployed' as const,
    source: account.address,
    credentialId: hex(account.credentialId),
  };
  const connected = await wallet.descriptor.connect(network.networkId);
  const config = await connected.getConfiguration();
  if (
    config.networkId !== network.networkId ||
    config.indexerUri !== network.indexerUrl ||
    config.indexerWsUri !== network.indexerWsUrl ||
    config.substrateNodeUri !== network.nodeUrl
  )
    throw new Error('The fee wallet and selected ACC use different chains.');
  const keys = await connected.getShieldedAddresses();
  if (selected().account !== account || selected().wallet !== wallet)
    throw new Error('The selected owner or fee wallet changed.');
  const submitter = remoteV1Sponsor(serviceUrl, { fetch: tracedFetch });
  const chain = createMidnightChain({
    network,
    binding: accModule,
    prover: remoteV1Prover(serviceUrl, { fetch: tracedFetch }),
    sponsorKeys: {
      coinPublicKey: keys.shieldedCoinPublicKey,
      encryptionPublicKey: keys.shieldedEncryptionPublicKey,
    },
    sponsor: {
      supportsShieldedOffers: true,
      balanceAndSign: (proven) => {
        if (selected().account !== account || selected().wallet !== wallet)
          throw new Error('The selected owner or fee wallet changed.');
        return bridge.balanceWithdrawalFee({
          scope,
          bridge: rawBridge,
          amount: amount.toString(),
          proven,
        });
      },
    },
    submitter,
  });
  return chain.call(request);
}
