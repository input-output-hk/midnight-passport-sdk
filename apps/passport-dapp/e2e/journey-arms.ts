export type JourneyArm = 'p256' | 'jubjub';

/** Local default covers both; CI uses two isolated processes/jobs, never competing foreground tabs. */
export function journeyArms(value: string | undefined): readonly JourneyArm[] {
  if (value === undefined) return Object.freeze(['p256', 'jubjub']);
  if (value === 'p256' || value === 'jubjub') return Object.freeze([value]);
  throw new Error('PASSPORT_DEMO_JOURNEY_ARM must be p256 or jubjub; leave unset to run both.');
}
