/** Checked facts for publishing an already submitted JubJub grant. */
import type { Flow } from './flow.js';
import type { StagedJubjubGrant } from './jubjub-grant-issue.js';
import type { PublishJubjubGrantPorts } from './jubjub-grant-publication.js';
import type {
  AccLedgerView,
  AccountHint,
  AccountRecord,
  Authoriser,
  CurvePoint,
} from './ports/index.js';

export type PublicationHint = AccountHint & { readonly credentialId: Uint8Array };
export type PublicationPorts = PublishJubjubGrantPorts & {
  readonly authoriser: Authoriser & { withKeySession: NonNullable<Authoriser['withKeySession']> };
};
export type PublicationView = AccLedgerView & {
  readonly encKey: Uint8Array;
  readonly inboxEntries: readonly Uint8Array[];
};
export interface PublicationOperation {
  readonly ports: PublicationPorts;
  readonly flow: Flow;
  readonly hint: PublicationHint;
  readonly credentialId: Uint8Array;
  readonly grantId: string;
  readonly attempts: number;
  readonly wait: (milliseconds: number) => Promise<void>;
  readonly self: { readonly bytes: Uint8Array };
  readonly appendTxHashes: string[];
}
export interface ApprovedPublication {
  readonly operation: PublicationOperation;
  readonly view: PublicationView;
  readonly opening: StagedJubjubGrant;
  readonly approved: {
    readonly scope: StagedJubjubGrant['scope'];
    readonly scopeDigest: string;
    readonly scopeSalt: string;
    readonly slot: number;
  };
}
export interface SelectedPublication {
  readonly operation: PublicationOperation;
  readonly record: AccountRecord;
  readonly staged: StagedJubjubGrant;
  readonly publicKey: CurvePoint;
}
export type ReadPublicationOpening = StagedJubjubGrant & {
  readonly bookkeeping: StagedJubjubGrant['bookkeeping'] & { readonly readPublicKey: string };
};
export interface PublicationProgress {
  readonly view: PublicationView;
  readonly parts: { readonly header: boolean; readonly object: boolean };
  readonly readOpening: ReadPublicationOpening | undefined;
  readonly viewRecord: { readonly seal: string; readonly encKeyPrefix: string } | undefined;
}
export const publicationBytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);
export const publicationPointEqual = (a: CurvePoint, b: CurvePoint): boolean =>
  a.x === b.x && a.y === b.y;

/** Only used after the supported-opening guard has bound the staged read key. */
export const isReadPublication = (staged: StagedJubjubGrant): staged is ReadPublicationOpening =>
  staged.scope.read === true;
