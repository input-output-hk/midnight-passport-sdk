import {
  ContractCall,
  type Bindingish,
  type Proofish,
  type Signaturish,
  type Transaction,
} from '@midnightntwrk/ledger-v9';

/** Select a solitary call with the exact target and circuit, regardless of wallet inputs. */
export function singleContractCall<S extends Signaturish, P extends Proofish, B extends Bindingish>(
  tx: Transaction<S, P, B>,
  address: string,
  circuit: string,
): { readonly call: ContractCall<P>; readonly segment: number } | undefined {
  const actions = [...(tx.intents ?? [])].flatMap(([segment, intent]) =>
    intent.actions.map((call) => ({ segment, call })),
  );
  const [entry] = actions;
  if (actions.length !== 1 || !entry || !(entry.call instanceof ContractCall)) return undefined;
  const { call, segment } = entry;
  if (call.address !== address) return undefined;
  const name =
    typeof call.entryPoint === 'string'
      ? call.entryPoint
      : new TextDecoder().decode(call.entryPoint);
  return name === circuit ? { call, segment } : undefined;
}
