/** Decode the existing encrypted journal format without replanning or replacing keys. */
import { z } from 'zod';
import { hostFailure, type HostMutationRecord } from '@input-output-hk/mn-passport-service';

import { grantIssueContext } from './host-grant-issue.ts';

const hex = z.string().regex(/^(?:[0-9a-f]{2})+$/);
const prepared = z.object({ tx: hex, identifiers: z.array(z.string()).min(1) });
export const waveSchema = z.object({
  index: z.number().int().min(1).max(64),
  kind: z.enum(['deploy', 'maintenance']),
  circuits: z
    .array(z.string().regex(/^[a-z][a-z0-9_]*$/))
    .min(1)
    .max(52),
  verifierBytes: z.number().int().nonnegative().max(15000),
  retiresAuthority: z.boolean(),
});
const ownerCallSchema = z.object({
  kind: z.literal('call'),
  driver: z.literal('reference-v9-owner-call:1'),
  transaction: prepared,
});
const callSchema = z.discriminatedUnion('driver', [ownerCallSchema, grantIssueContext]);
const deploySchema = z.object({
  kind: z.literal('deploy'),
  driver: z.literal('reference-v9-waves:1'),
  deployTx: hex,
  state: hex,
  signingKey: z.object({ tag: z.enum(['schnorr', 'ecdsa']), value: hex }),
  waves: z.array(waveSchema).min(2).max(64),
  retireAuthority: z.boolean(),
});
export type DeploymentContext = z.infer<typeof deploySchema>;
export function requireHostPlan(record: HostMutationRecord) {
  if (!record.plan) return hostFailure();
  return record.plan;
}
export function callContext(record: HostMutationRecord) {
  if (record.identity.kind !== 'call') return hostFailure();
  const plan = requireHostPlan(record);
  if (plan.steps !== 1) return hostFailure();
  const value = callSchema.safeParse(plan.context);
  if (!value.success) return hostFailure();
  return value.data;
}
export function deploymentContext(record: HostMutationRecord) {
  if (record.identity.kind !== 'deploy') return hostFailure();
  const plan = requireHostPlan(record);
  const value = deploySchema.safeParse(plan.context);
  if (
    !value.success ||
    value.data.waves.length !== plan.steps ||
    value.data.waves.some((wave, index) => wave.index !== index + 1)
  )
    return hostFailure();
  return value.data;
}
