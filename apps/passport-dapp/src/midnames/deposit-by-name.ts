import {
  depositShielded,
  type ShieldedDepositPorts,
  type ShieldedDepositRequest,
  type ShieldedDepositSender,
} from '@input-output-hk/mn-passport-account';
import {
  resolvePassportName,
  type PassportNameService,
} from '@input-output-hk/mn-passport-account/names';

type CoinRequest = Parameters<ShieldedDepositSender['depositShielded']>[0];

export interface NamedDepositReview {
  readonly name: string;
  readonly networkId: string;
  readonly providerId: string;
  readonly namespace: string;
  readonly accountAddress: string;
  readonly color: string;
  readonly amount: bigint;
}

/** One attempt using a pinned external resolver and a sender-owned, value-capable wallet. */
export async function depositByName(
  request: Omit<ShieldedDepositRequest, 'account'> & {
    readonly name: string;
    readonly networkId: string;
  },
  ports: Pick<ShieldedDepositPorts, 'chain' | 'sealCoin' | 'sleep' | 'confirmationMs'> & {
    readonly names: PassportNameService;
    readonly review: (intent: Readonly<NamedDepositReview>) => Promise<boolean>;
    /** Build, prove and balance without broadcasting. Return a dispatch of these exact bytes.
     * Resolve dispatch only after successful original transaction finality. */
    readonly prepare: (request: CoinRequest) => Promise<() => Promise<{ readonly txId: string }>>;
  },
) {
  const { name, networkId, requestId, amount } = request;
  if (
    !(request.color instanceof Uint8Array) ||
    !(request.nonce instanceof Uint8Array) ||
    request.color.length !== 32 ||
    request.nonce.length !== 32 ||
    typeof amount !== 'bigint' ||
    amount <= 0n ||
    amount >= 1n << 128n
  )
    throw new Error('Invalid shielded deposit asset or amount.');
  const color = new Uint8Array(request.color);
  const nonce = new Uint8Array(request.nonce);
  const resolve = async () => {
    const target = await resolvePassportName(ports.names, { name, networkId });
    if (!target || target.mode !== 'external')
      throw new Error('No external contract target for this name.');
    return target;
  };
  const original = await resolve();
  const review = Object.freeze({
    name,
    networkId,
    providerId: original.providerId,
    namespace: original.namespace,
    accountAddress: original.accountAddress,
    color: Array.from(color, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    amount,
  });
  if ((await ports.review(review)) !== true) throw new Error('Named deposit declined.');

  let sealedKey: Uint8Array | undefined;
  let enteredDispatch = false;
  let refusal: unknown;
  try {
    const result = await depositShielded(
      { account: original.accountAddress, requestId, color, amount, nonce },
      {
        chain: ports.chain,
        sealCoin(encKey, coin) {
          sealedKey = new Uint8Array(encKey);
          return ports.sealCoin(encKey, coin);
        },
        sleep: ports.sleep,
        ...(ports.confirmationMs !== undefined && { confirmationMs: ports.confirmationMs }),
        sender: {
          async depositShielded(coin) {
            try {
              const dispatch = await ports.prepare(coin);
              const account = await ports.chain.readAccount(original.accountAddress);
              if (
                account?.specVersion !== 3 ||
                !account.booted ||
                !account.encKey ||
                account.encKey.length !== 32 ||
                !sealedKey ||
                !sealedKey.every((byte, index) => byte === account.encKey?.[index])
              )
                throw new Error(
                  'The destination account or encryption key changed before submission.',
                );
              const current = await resolve();
              if (
                current.accountAddress !== original.accountAddress ||
                current.providerId !== original.providerId ||
                current.namespace !== original.namespace
              )
                throw new Error('The name destination changed before submission.');
              enteredDispatch = true;
              return await dispatch();
            } catch (error) {
              if (!enteredDispatch) refusal = error;
              throw error;
            }
          },
        },
      },
    );
    return { ...result, review };
  } catch (error) {
    throw refusal ?? error;
  }
}
