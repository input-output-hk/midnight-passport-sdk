import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadReferenceModule } from '../src/reference-modules.ts';

test('dynamic module admission retains constructor identity and checks required static capabilities', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'passport-module-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  interface Module {
    Runtime: { new (): object; decode(): string };
  }
  const valid = join(root, 'valid.mjs');
  await writeFile(valid, 'export class Runtime { static decode(){ return "ok"; } }');
  const a = await loadReferenceModule<Module>(valid, ['Runtime'], { Runtime: ['decode'] });
  const b = await loadReferenceModule<Module>(valid, ['Runtime'], { Runtime: ['decode'] });
  assert.equal(a.Runtime, b.Runtime, 'the loader does not wrap or replace runtime constructors');
  assert.equal(new a.Runtime() instanceof b.Runtime, true);
  assert.equal(a.Runtime.decode(), 'ok');
  for (const [name, code] of [
    ['missing', 'export const unrelated = 1;'],
    ['not-class', 'export const Runtime = {};'],
    ['missing-static', 'export class Runtime {}'],
    ['invalid-static', 'export class Runtime { static decode = 1; }'],
  ] as const) {
    const path = join(root, `${name}.mjs`);
    await writeFile(path, code);
    await assert.rejects(
      loadReferenceModule<Module>(path, ['Runtime'], { Runtime: ['decode'] }),
      /reference|export/i,
    );
  }
});
