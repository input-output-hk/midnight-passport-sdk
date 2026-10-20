import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executableSource, sourceSurface } from '../scripts/qualification/binding-audit.mjs';

test('source comparison preserves comment-like assertion strings and removes actual comments', () => {
  const code = 'export circuit f(): [] { assert(true, "https://example/*x*/"); }';
  assert.equal(executableSource(`/* header */\n${code} // trailing`).trim(), code);
  assert.notEqual(executableSource(code), executableSource(code.replace('true', 'false')));
  assert.throws(() => executableSource('/* open'), /unterminated/);
});

test('surface comparison separates executable fixes from declaration/schema changes', () => {
  const before =
    'export ledger devices: Set<Bytes<32>>; export circuit recover_finalise(): [] { finish(); }';
  const after = before.replace('finish();', 'devices.resetToDefault(); finish();');
  assert.deepEqual(sourceSurface(before), sourceSurface(after));
  assert.notEqual(executableSource(before), executableSource(after));
  assert.notDeepEqual(
    sourceSurface(before),
    sourceSurface(before.replace('Bytes<32>', 'Bytes<64>')),
  );
  assert.notDeepEqual(
    sourceSurface(before),
    sourceSurface(before.replace('():', '(arg: Boolean):')),
  );
});
