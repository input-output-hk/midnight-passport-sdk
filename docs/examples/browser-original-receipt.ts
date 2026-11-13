import {
  createBrowserOriginalDispatch,
  type OriginalDispatchIdentity,
  type OriginalDispatchScope,
} from '@input-output-hk/mn-passport-adapter-browser/original-dispatch';
import type { SecretStore, Submitter } from '@input-output-hk/mn-passport-account/ports';

export interface IndependentReceipts {
  /** Commit once by the full scope. Reject if it already exists or cannot be committed. */
  create(scope: OriginalDispatchScope, receipt: OriginalDispatchIdentity): Promise<void>;
  read(scope: OriginalDispatchScope): Promise<OriginalDispatchIdentity | undefined>;
}

/** Call with the finalized bytes of an approved new request. */
export function dispatchApprovedOriginal(
  browserStore: SecretStore,
  receipts: IndependentReceipts,
  transport: Submitter,
  scope: OriginalDispatchScope,
  finalized: Uint8Array,
) {
  const request = Object.freeze({ ...scope });
  const dispatch: ReturnType<typeof createBrowserOriginalDispatch> = createBrowserOriginalDispatch(
    browserStore,
    {
      async submit(bytes) {
        const original = await dispatch.readOriginal(request);
        if (!original) throw new Error('Original receipt missing.');
        await receipts.create(request, original);
        return transport.submit(bytes);
      },
    },
  );
  return dispatch.dispatch(request, finalized);
}
