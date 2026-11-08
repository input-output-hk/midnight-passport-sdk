import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  PUBLIC_SIGNER_SOURCE,
  verifyPublicSigner,
} from '../scripts/consumer/public-signer-source.mjs';

/** @param {string|Uint8Array} bytes */
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const previousBuilder = '7b82280351d90eddf2d86d404275c83eba0b9fc53c6f97c7ae5191fd46642266';

test('retained signer records from the prior recipe refuse without rewriting or visiting source paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'signer-recipe-pin-'));
  try {
    const file = join(root, 'signer-inputs.json');
    const body = JSON.stringify({
      schemaVersion: 1,
      kind: 'public-source-signer',
      source: { ...PUBLIC_SIGNER_SOURCE, root: '/untrusted/source' },
      builderSha256: previousBuilder,
    });
    writeFileSync(file, body);
    const currentBuilder = hash(
      readFileSync(new URL('../scripts/consumer/public-signer-source.mjs', import.meta.url)),
    );
    assert.notEqual(currentBuilder, previousBuilder);
    assert.throws(() => verifyPublicSigner(root, hash(body), '/untrusted/repository'), {
      message: /Signer preparation recipe changed; use a fresh root/,
    });
    assert.equal(readFileSync(file, 'utf8'), body);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
