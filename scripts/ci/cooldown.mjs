// An override admits only known recent dates; missing evidence is never safe.
import assert from 'node:assert/strict';
import { addedVersions } from './lock-versions.mjs';
import { MetadataFailure, publishTimes } from './metadata.mjs';

export const COOLDOWN_MS = 7 * 86_400_000;
/** @param {unknown} value @param {number} now @param {string} name */
export function publishDate(value, now, name) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    throw new MetadataFailure(name, 'missing-or-invalid-date');
  const published = Date.parse(value);
  if (
    !Number.isFinite(published) ||
    published > now ||
    new Date(published).toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')
  )
    throw new MetadataFailure(name, 'invalid-or-future-date');
  return published;
}
/** @param {ReturnType<typeof addedVersions>} changes @param {string} body @param {number} now @param {import('./metadata.mjs').MetadataOptions} [options] */
export async function evaluateCooldown(changes, body, now, options = {}) {
  assert.ok(Number.isFinite(now) && now > 0);
  const metadata = await publishTimes(
    changes.added.map((v) => v.name),
    options,
  );
  const versions = changes.added.map(({ name, version, pair }) => {
    const times = metadata.times.get(name);
    const published = publishDate(
      times && Object.hasOwn(times, version) ? times[version] : undefined,
      now,
      name,
    );
    return {
      pair,
      published: new Date(published).toISOString(),
      ageDays: (now - published) / 86_400_000,
      quarantined: now - published < COOLDOWN_MS,
    };
  });
  const override = body.match(/^\s*cooldown-override:\s*(\S[^\r\n]*)$/im)?.[1];
  const violations = versions.filter((v) => v.quarantined);
  return {
    source: changes.source,
    baseline: changes.baseline,
    lockfiles: changes.lockfiles,
    versions,
    violations,
    override: override ?? null,
    passed: violations.length === 0 || Boolean(override),
    metadata: {
      packages: metadata.packages,
      calls: metadata.calls,
      concurrency: metadata.concurrency,
      attempts: metadata.attempts,
      requestMs: metadata.requestMs,
      overallMs: metadata.overallMs,
      maxBytes: metadata.maxBytes,
    },
  };
}
/** @param {string} repository @param {string} base @param {string} body */
export async function cooldown(repository, base, body) {
  return evaluateCooldown(addedVersions(repository, base), body, Date.now());
}
