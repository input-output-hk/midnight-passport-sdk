#!/usr/bin/env node
// Candidate-only public imports. Reads metadata; never opens a credential or generates keys.
import { getAccountProofRequirements } from '@input-output-hk/mn-passport-account/preflight';
import { inspectAccProofProfile } from '@input-output-hk/mn-passport-contract/capabilities';

const usage =
  'node check-key-endpoint.mjs <key-base-url> <p256-webauthn|jubjub-schnorr> <withdraw-unshielded|withdraw-shielded|issue-grant|recover-pending-grants> [read|non-read]';
const [base, scheme, operation, read, ...extra] = process.argv.slice(2);
if (base === '--help' && process.argv.length === 3) console.log(usage);
else {
  try {
    if (
      !base ||
      !scheme ||
      !operation ||
      extra.length ||
      !['p256-webauthn', 'jubjub-schnorr'].includes(scheme) ||
      ![
        'withdraw-unshielded',
        'withdraw-shielded',
        'issue-grant',
        'recover-pending-grants',
      ].includes(operation) ||
      (operation === 'issue-grant'
        ? !['read', 'non-read'].includes(read ?? '')
        : read !== undefined)
    )
      throw Error('arguments');
    const endpoint = new URL(base);
    if (
      !['http:', 'https:'].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      throw Error('arguments');
    if (!endpoint.pathname.endsWith('/')) endpoint.pathname += '/';
    const requirements = getAccountProofRequirements(
      /** @type {'p256-webauthn'|'jubjub-schnorr'} */ (scheme),
      {
        operation:
          /** @type {import('@input-output-hk/mn-passport-account/preflight').AccountPreflightOperation} */ (
            operation
          ),
        ...(operation === 'issue-grant' && { grantRead: read === 'read' }),
      },
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      /** @param {string} path */
      const metadata = async (path) => {
        const response = await fetch(new URL(path, endpoint), {
          signal: controller.signal,
          redirect: 'error',
        });
        if (!response.ok || !response.body) throw Error('metadata');
        const reader = response.body.getReader();
        let size = 0;
        const chunks = [];
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 262144) throw Error('metadata');
            chunks.push(value);
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      };
      const [profile, manifest] = await Promise.all([
        metadata('v1/profile'),
        metadata('v1/manifest'),
      ]);
      const coverage = inspectAccProofProfile(profile, manifest, requirements.proofCircuits);
      console.log(JSON.stringify({ schemaVersion: 1, requirements, coverage }, null, 2));
      process.exitCode = coverage.status === 'profile-covers-request' ? 0 : 2;
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  } catch (error) {
    const argumentsInvalid = error instanceof Error && error.message === 'arguments';
    console.log(
      JSON.stringify({
        status: 'refused',
        code: argumentsInvalid ? 'InvalidArguments' : 'KeyMetadataUnavailable',
        message: argumentsInvalid
          ? usage
          : 'Key metadata is unavailable or invalid; no credential or proof operation was started.',
      }),
    );
    process.exitCode = argumentsInvalid ? 3 : 1;
  }
}
