import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { interactiveReviewRequested } from '../examples/midnames-local/terminal-review.mjs';

test('terminal review is an exact opt-in', () => {
  assert.equal(interactiveReviewRequested({}), false);
  assert.equal(interactiveReviewRequested({ PASSPORT_MIDNAMES_INTERACTIVE: '0' }), false);
  assert.equal(interactiveReviewRequested({ PASSPORT_MIDNAMES_INTERACTIVE: '1' }), true);
  assert.throws(() => interactiveReviewRequested({ PASSPORT_MIDNAMES_INTERACTIVE: 'yes' }));
});

test('interactive native runner refuses a nonterminal before touching Docker or evidence', () => {
  const runner = fileURLToPath(
    new URL('../examples/midnames-local/qualify-deposit.mjs', import.meta.url),
  );
  const env = {
    // The child checks this guard before its TTY preflight; CI itself is not a Nix shell.
    IN_NIX_SHELL: '1',
    PASSPORT_MIDNAMES_NATIVE: '1',
    PASSPORT_RC_LOCALNET: '1',
    PASSPORT_MIDNAMES_INTERACTIVE: '1',
  };
  const result = spawnSync(process.execPath, [runner], {
    env,
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Interactive review requires a terminal/);
  assert.doesNotMatch(result.stderr, /docker|native lease|EEXIST/i);
});
