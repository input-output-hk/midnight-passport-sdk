import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  admitArtifactRedirect,
  admitHttps,
  boundedBody,
  registryBytes,
} from '../scripts/release/transport.mjs';
import { assertAttestedSubject, verifyArchive } from '../scripts/release/registry.mjs';
import { exactCatalog, keyImageTools, verifyRange } from '../scripts/release/key-runtime.mjs';
import { verifyImage } from '../scripts/release/images.mjs';
import { assertSigner } from '../scripts/release/signatures.mjs';
import { verifyCurrentCommands } from '../scripts/release/instructions.mjs';
import { applicationPort } from '../scripts/release/mounted-plan.mjs';
import { safeArchive } from '../scripts/consumer/installed-inputs.mjs';
import { verifyRenderedInstructions } from '../scripts/release/pages-policy.mjs';

const token = 'synthetic-registry-credential';
const registry = 'https://npm.pkg.github.com/package.tgz';
const cdn = 'https://pkg-npm.githubusercontent.com/archive?sig=synthetic&spr=https';
for (const url of [
  'http://npm.pkg.github.com/a',
  'https://npm.pkg.github.com.evil/a',
  'https://npm.pkg.github.com:444/a',
  'https://user:password@npm.pkg.github.com/a',
  'https://npm.pkg.github.com/a#fragment',
])
  test(`credentials refused before network: ${url}`, async () => {
    let calls = 0;
    await assert.rejects(() =>
      registryBytes(url, token, {
        fetch: async () => {
          calls++;
          return new Response('unexpected');
        },
      }),
    );
    assert.equal(calls, 0);
  });
test('canonical default-TLS registry URLs admit', () => {
  assert.equal(
    admitHttps('https://npm.pkg.github.com:443/a', 'npm.pkg.github.com').origin,
    'https://npm.pkg.github.com',
  );
});
for (const query of [
  'sig=&spr=https',
  'sig=x&sig=&spr=https',
  'sig=x&sig=y&spr=https',
  'sig=x&spr=',
  'sig=x&spr=https&spr=',
  'sig=x&spr=http',
  'sig=x',
])
  test(`ambiguous signed CDN query refuses: ${query}`, () =>
    assert.throws(() => admitArtifactRedirect('https://pkg-npm.githubusercontent.com/a?' + query)));

test('actual transport composition forwards credentials only to the original registry request', async () => {
  /** @type {Array<{url:string,init:RequestInit}>} */ const calls = [];
  const bytes = await registryBytes(registry, token, {
    artifact: true,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return calls.length === 1
        ? new Response('', { status: 302, headers: { Location: cdn } })
        : new Response('archive');
    },
  });
  assert.equal(bytes.toString(), 'archive');
  assert.equal(calls.length, 2);
  assert.equal(new Headers(calls[0]?.init.headers).get('authorization'), 'Bearer ' + token);
  assert.equal(new Headers(calls[1]?.init.headers).get('authorization'), null);
  assert.ok(calls.every((call) => call.init.redirect === 'manual'));
});
for (const [artifact, location] of [
  [false, cdn],
  [true, 'https://evil.invalid/a?sig=x&spr=https'],
  [true, 'http://pkg-npm.githubusercontent.com/a?sig=x&spr=https'],
])
  test('metadata or foreign/downgraded redirect is not followed', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        registryBytes(registry, token, {
          artifact: Boolean(artifact),
          fetch: async () => {
            calls++;
            return new Response('', { status: 302, headers: { Location: String(location) } });
          },
        }),
      /omitted/,
    );
    assert.equal(calls, 1);
  });
test('a second CDN redirect and signed-URL-bearing exception are sanitized', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      registryBytes(registry, token, {
        artifact: true,
        fetch: async () => {
          if (++calls === 1) return new Response('', { status: 302, headers: { Location: cdn } });
          throw Error(cdn + token);
        },
      }),
    (error) =>
      error instanceof Error &&
      !error.message.includes('sig=') &&
      !error.message.includes(token) &&
      error.cause === undefined,
  );
  calls = 0;
  await assert.rejects(() =>
    registryBytes(registry, token, {
      artifact: true,
      fetch: async () =>
        ++calls === 1
          ? new Response('', { status: 302, headers: { Location: cdn } })
          : new Response('', { status: 302, headers: { Location: 'https://evil.invalid' } }),
    }),
  );
  assert.equal(calls, 2);
});
test('streamed responses are byte bounded without trusting Content-Length', async () => {
  await assert.rejects(
    () => boundedBody(new Response('oversized', { headers: { 'Content-Length': '1' } }), 3),
    /byte limit/,
  );
  assert.equal((await boundedBody(new Response('yes'), 3)).toString(), 'yes');
});
test('compressed published bytes retain independent integrity despite explainable gzip-header differences', () => {
  const source = gzipSync('identical uncompressed tar bytes'),
    published = Buffer.from(source);
  published[9] = source[9] === 3 ? 19 : 3;
  const dist = {
    integrity: 'sha512-' + createHash('sha512').update(published).digest('base64'),
    shasum: createHash('sha1').update(published).digest('hex'),
  };
  assert.equal(verifyArchive(published, dist, source).gzipOsByteDifference, true);
  assert.throws(() => verifyArchive(published, { ...dist, integrity: 'wrong' }, source), /SRI/);
  assert.throws(() => verifyArchive(published, dist, gzipSync('different')), /uncompressed/);
});
for (const actual of [['a', 'a'], ['a'], ['a', 'b', 'c'], ['a', 'c']])
  test(`verifier catalog rejects substituted/count-only set: ${actual}`, () =>
    assert.throws(() => exactCatalog(actual, ['a', 'b'])));
test('range must match verified payload as well as status and headers', () => {
  const response = new Response('abcd', {
    status: 206,
    headers: {
      'Content-Range': 'bytes 0-3/20',
      'Access-Control-Allow-Origin': 'http://localhost:5173',
    },
  });
  verifyRange(response, Buffer.from('abcd'), Buffer.from('abcd'), 20);
  assert.throws(
    () => verifyRange(response, Buffer.from('evil'), Buffer.from('abcd'), 20),
    /payload/,
  );
});
test('optional Docker metadata is admitted, while wrong digest/platform/root/empty commands refuse', () => {
  const pin = {
    role: /** @type {const} */ ('service'),
    repository: 'ghcr.io/input-output-hk/midnight-passport-service',
    digest: 'sha256:' + 'a'.repeat(64),
    version: '0.1.0-test',
    sourceAlias: 'sha-test',
  };
  const image = {
    Id: 'sha256:' + 'b'.repeat(64),
    Os: 'linux',
    Architecture: 'amd64',
    RepoDigests: [pin.repository + '@' + pin.digest],
    Config: { User: '10001:10001', Cmd: ['node', 'main'] },
  };
  assert.equal(verifyImage(image, pin).entrypoint, null);
  assert.equal(
    verifyImage({ ...image, Config: { User: '10001:10001', Entrypoint: ['node'] } }, pin).cmd,
    null,
  );
  for (const changed of [
    { Architecture: 'arm64' },
    { RepoDigests: [] },
    { Config: { User: 'root', Cmd: ['node'] } },
    { Config: { User: '10001:10001' } },
  ])
    assert.throws(() => verifyImage({ ...image, ...changed }, pin));
});
test('GPG admission pins a cryptographically verified signer, never global ownertrust', () => {
  const signer = 'A'.repeat(40),
    raw = `[GNUPG:] VALIDSIG ${signer} 2026-11-10 1 0 4 0 1 10 00 ${signer}\n[GNUPG:] TRUST_UNDEFINED 0 pgp\n`;
  assertSigner(raw, signer);
  assert.throws(() => assertSigner(raw, 'B'.repeat(40)));
  assert.throws(() => assertSigner(raw + '[GNUPG:] BADSIG bad\n', signer));
  assert.throws(() => assertSigner('[GNUPG:] GOODSIG only', signer));
});
test('active command checks reject stale package versions and image digests without rejecting historical prose', () => {
  const digest = 'sha256:' + 'a'.repeat(64),
    images = [
      {
        role: /** @type {const} */ ('keys'),
        repository: 'ghcr.io/input-output-hk/midnight-passport-keys',
        digest,
        version: '0.1.0-rc9',
        sourceAlias: 'sha-source',
      },
    ];
  const current = `Earlier RC5 remains history.\n\n\`\`\`sh\npnpm add @input-output-hk/mn-passport-account@0.1.0-rc9\n\`\`\`\n\`\`\`sh\ndocker run ghcr.io/input-output-hk/midnight-passport-keys@${digest}\n\`\`\`\n`;
  assert.deepEqual(verifyCurrentCommands(current, '0.1.0-rc9', images), {
    packageCommands: 1,
    imageCommands: 1,
  });
  assert.throws(
    () =>
      verifyCurrentCommands(
        current.replace('account@0.1.0-rc9', 'account@0.1.0-rc8'),
        '0.1.0-rc9',
        images,
      ),
    /exact release/,
  );
  assert.throws(
    () =>
      verifyCurrentCommands(
        current.replace(digest, 'sha256:' + 'b'.repeat(64)),
        '0.1.0-rc9',
        images,
      ),
    /immutable digest/,
  );
  assert.equal(applicationPort(18790, 18790), '127.0.0.1:18790:18790');
  assert.throws(() => applicationPort(18790, 8787), /Host validation/);
});

/** @param {Array<{name:string,body?:string,type?:string}>} entries */
function tar(entries) {
  const blocks = [];
  for (const entry of entries) {
    const bytes = Buffer.from(entry.body ?? ''),
      header = Buffer.alloc(512);
    header.write(entry.name);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136);
    header.fill(32, 148, 156);
    header.write(entry.type ?? '0', 156);
    const checksum = [...header].reduce((sum, value) => sum + value, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
test('Pages parser admits directory-prefixed files without extraction and rejects traversal/links/duplicates', () => {
  assert.equal(
    safeArchive(tar([{ name: './index.html', body: 'page' }]), 'site')
      .get('index.html')
      ?.toString(),
    'page',
  );
  for (const entry of [
    { name: '../escape' },
    { name: '/absolute' },
    { name: './link', type: '2' },
    { name: 'index.html', body: 'duplicate' },
  ])
    assert.throws(() => safeArchive(tar([{ name: 'index.html', body: 'page' }, entry]), 'site'));
});

test('attestation admission requires the exact archive subject, even in a shared statement', () => {
  const hash = 'a'.repeat(64),
    subject = {
      verificationResult: {
        statement: {
          subject: [{ digest: { sha256: hash } }, { digest: { sha256: 'b'.repeat(64) } }],
        },
      },
    };
  assertAttestedSubject([subject], hash);
  assert.throws(() => assertAttestedSubject([subject], 'c'.repeat(64)), /exact archive subject/);
  assert.throws(() => assertAttestedSubject([], hash));
  assert.throws(() => assertAttestedSubject([{ verificationResult: {} }], hash));
});

test('key-image tools derive only from admitted Nix command metadata', () => {
  const pin = {
    role: /** @type {const} */ ('keys'),
    repository: 'ghcr.io/input-output-hk/midnight-passport-keys',
    digest: 'sha256:' + 'a'.repeat(64),
    version: '0.1.0-rc9',
    sourceAlias: 'sha-source',
  };
  const node = '/nix/store/' + 'a'.repeat(32) + '-nodejs-22.23.2/bin/node';
  const app = '/nix/store/' + 'b'.repeat(32) + '-passport-key-service-app';
  const image = verifyImage(
    {
      Id: 'sha256:' + 'b'.repeat(64),
      Os: 'linux',
      Architecture: 'amd64',
      RepoDigests: [pin.repository + '@' + pin.digest],
      Config: { User: '10001:10001', Cmd: [node, app + '/apps/passport-key-service/src/main.mjs'] },
    },
    pin,
  );
  assert.equal(keyImageTools(image).restore, app + '/packages/contract/bin/restore-acc-keys.mjs');
  assert.throws(() => keyImageTools({ ...image, cmd: ['node', '/opt/passport/fake.mjs'] }));
});

test('explicit historical command boundaries preserve old recipes without making them current', () => {
  const history =
    '<!-- release-acceptance:historical:start -->\n```sh\npnpm add @input-output-hk/mn-passport-account@0.1.0-rc8\n```\n<!-- release-acceptance:historical:end -->';
  assert.deepEqual(verifyCurrentCommands(history, '0.1.0-rc9', []), {
    packageCommands: 0,
    imageCommands: 0,
  });
  verifyRenderedInstructions(
    '<!-- release-acceptance:historical:start --><pre>pnpm add @input-output-hk/mn-passport-account@0.1.0-rc8</pre><!-- release-acceptance:historical:end -->',
    'operations/quality.html',
    '0.1.0-rc9',
    [],
  );
  assert.throws(
    () =>
      verifyCurrentCommands(
        history.replace('<!-- release-acceptance:historical:end -->', ''),
        '0.1.0-rc9',
        [],
      ),
    /Unbalanced/,
  );
  const low = gzipSync('repeatable '.repeat(100), { level: 1 }),
    high = gzipSync('repeatable '.repeat(100), { level: 9 });
  const dist = {
    integrity: 'sha512-' + createHash('sha512').update(low).digest('base64'),
    shasum: createHash('sha1').update(low).digest('hex'),
  };
  const checked = verifyArchive(low, dist, high);
  assert.equal(checked.compressedArchiveDifference, true);
  assert.equal(checked.gzipOsByteDifference, false);
});
