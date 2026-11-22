import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localNightBinding } from '../src/midnames/local-binding.js';

test('named NIGHT accepts only exact stable and provisional local pins', () => {
  assert.equal(
    localNightBinding(
      'acc-s3r1.1',
      '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
    ),
    true,
  );
  assert.equal(
    localNightBinding(
      'acc-s3r1.1-zkir036',
      '590d3c97db7fce05d5ea85a9bf37c82b7032c498703a2807276ca7ae0ca52e5f',
    ),
    true,
  );
  assert.equal(localNightBinding('acc-s3r1.1-zkir036', '0'.repeat(64)), false);
  assert.equal(localNightBinding('acc-unknown'), false);
});
