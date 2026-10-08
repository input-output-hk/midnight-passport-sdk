// The design §1.2 rules of scripts/lint-boundaries.mjs, on a scratch repository: an adapter takes
// account/ports, never the account root, unless it is a composition root; and only the Midnight
// entry points import a Midnight package statically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/lint-boundaries.mjs', import.meta.url));
const GRAPH = {
  protocol: [],
  account: ['protocol'],
  'adapter-webauthn': ['account'],
  'adapter-browser': ['account'],
};

/** @param {Record<string, string>} files source text by path under the scratch root */
async function lint(files) {
  const root = await mkdtemp(join(tmpdir(), 'lint-boundaries-'));
  try {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(root, path, '..'), { recursive: true });
      await writeFile(join(root, path), text);
    }
    await writeFile(join(root, 'graph.json'), JSON.stringify(GRAPH));
    const run = spawnSync(process.execPath, [SCRIPT, root, join(root, 'graph.json')], {
      encoding: 'utf8',
    });
    return { status: run.status, errors: run.stderr.trim().split('\n').filter(Boolean) };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('an adapter imports account/ports, never the account root or another subpath', async () => {
  const { status, errors } = await lint({
    'packages/adapter-webauthn/src/ok.ts':
      "import type { Authoriser } from '@midnight-ntwrk/mn-passport-account/ports';\n",
    'packages/adapter-webauthn/src/root.ts':
      "import { toPassportError } from '@midnight-ntwrk/mn-passport-account';\n",
    'packages/adapter-webauthn/src/deep.ts':
      "import type { X } from '@midnight-ntwrk/mn-passport-account/dist/seams.js';\n",
  });
  assert.equal(status, 1);
  assert.deepEqual(errors.map((e) => e.replace(/^.*\/packages\//, '')).sort(), [
    'adapter-webauthn/src/deep.ts: "adapter-webauthn" must import "@midnight-ntwrk/mn-passport-account/ports" (design §1.2).',
    'adapter-webauthn/src/root.ts: "adapter-webauthn" must import "@midnight-ntwrk/mn-passport-account/ports" (design §1.2).',
  ]);
});

test('a composition root may import the account root, and the graph still binds it', async () => {
  assert.deepEqual(
    await lint({
      'packages/adapter-browser/src/root.ts':
        "import { createPassportConnector } from '@midnight-ntwrk/mn-passport-account';\n",
    }),
    { status: 0, errors: [] },
  );
  const { status, errors } = await lint({
    'packages/account/src/up.ts':
      "import type { Authoriser } from '@midnight-ntwrk/mn-passport-adapter-webauthn';\n",
  });
  assert.equal(status, 1);
  assert.match(errors[0] ?? '', /"account" must not import ".*adapter-webauthn"/);
});

test('a static Midnight import is refused outside the entry points; type and dynamic imports pass', async () => {
  const { status, errors } = await lint({
    'packages/account/src/static.ts':
      "import {\n  setNetworkId,\n} from '@midnight-ntwrk/midnight-js-network-id';\n",
    'packages/account/src/side-effect.ts': "import '@midnightntwrk/ledger-v9';\n",
    'packages/account/src/reexport.ts': "export * from '@midnight-ntwrk/compact-runtime';\n",
    'packages/account/src/fine.ts': [
      "import type { Transaction } from '@midnightntwrk/ledger-v9';",
      "const chain = () => import('@midnight-ntwrk/midnight-js-contracts');",
      '// import { x } from "@midnight-ntwrk/compact-runtime" stays a comment',
      "import { PASSPORT_API_VERSION } from '@midnight-ntwrk/mn-passport-protocol';",
      '',
    ].join('\n'),
    'packages/adapter-browser/src/chain.ts':
      "import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';\n",
  });
  assert.equal(status, 1);
  assert.deepEqual(errors.map((e) => e.replace(/^.*\/packages\//, '')).sort(), [
    'account/src/reexport.ts: "account" must reach "@midnight-ntwrk/compact-runtime" through import() (D-6).',
    'account/src/side-effect.ts: "account" must reach "@midnightntwrk/ledger-v9" through import() (D-6).',
    'account/src/static.ts: "account" must reach "@midnight-ntwrk/midnight-js-network-id" through import() (D-6).',
  ]);
});

test('the repository itself respects every boundary', () => {
  const run = spawnSync(process.execPath, [SCRIPT], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
});
