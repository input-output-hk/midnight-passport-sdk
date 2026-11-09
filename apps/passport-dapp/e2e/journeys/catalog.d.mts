export type JourneyGroup = 'presentation' | 'account-actions' | 'scoped-sessions' | 'owner-safety';
export interface JourneyCase {
  readonly id: string;
  readonly name: string;
  readonly group: JourneyGroup;
  readonly arms: readonly ('p256' | 'jubjub')[];
}
export const journeyGroups: readonly JourneyGroup[];
export const journeyCatalog: readonly JourneyCase[];
export function expectedCases(arm: string, group?: string): readonly JourneyCase[];
export function journeySelection(
  arm: string | undefined,
  group: string | undefined,
): JourneyGroup | undefined;
export const expiryCases: Readonly<Record<'holdings' | 'wallet', string>>;
export const receiptCases: Readonly<
  Record<'rotate' | 'removeDevice' | 'revokeGrant' | 'indexer-outage', string>
>;

export const bootstrapPlans: Readonly<Record<JourneyGroup, readonly string[]>>;

export function expectedCredentialPurposes(arm: string, group?: string): string[];
