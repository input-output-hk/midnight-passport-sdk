/** Small typed native operations shared by preparation and retained-plan continuation. */
import type * as Ledger from '@midnightntwrk/ledger-v9';
import { hostFailure } from '@input-output-hk/mn-passport-service';

export const bytes = (value: string) => new Uint8Array(Buffer.from(value, 'hex'));
export const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');
export const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
export function operation(state: Ledger.ContractState, name: string) {
  const value = state.operation(name);
  if (!value) return hostFailure();
  return value;
}
export function intents<
  S extends Ledger.Signaturish,
  P extends Ledger.Proofish,
  B extends Ledger.Bindingish,
>(tx: Ledger.Transaction<S, P, B>) {
  if (!tx.intents) return hostFailure();
  return [...tx.intents.values()];
}
export function verifierSize(sizes: ReadonlyMap<string, number>, name: string): number {
  const value = sizes.get(name);
  if (value === undefined) return hostFailure();
  return value;
}
