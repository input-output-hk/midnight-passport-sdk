// Public GHCR manifest and anonymous digest pulls; startup and native claims are separate.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { admitHttps, boundedBody } from './transport.mjs';
import { command, loggedCommand, probeEnvironment } from './process.mjs';
import { localDocker } from './docker.mjs';
import { object, put, sha256 } from './files.mjs';

/** @typedef {{role:'keys'|'service'|'funding',repository:string,digest:string,version:string,sourceAlias:string}} ImagePin */
/** @param {unknown} input @param {ImagePin} pin */
export function verifyImage(input, pin) {
  const image = object(input),
    config = object(image.Config);
  assert.equal(image.Os, 'linux');
  assert.equal(image.Architecture, 'amd64');
  assert.equal(config.User, '10001:10001');
  assert.ok(
    Array.isArray(image.RepoDigests) &&
      image.RepoDigests.includes(`${pin.repository}@${pin.digest}`),
  );
  assert.match(String(image.Id), /^sha256:[a-f0-9]{64}$/);
  // Docker legitimately omits either optional command field.
  assert.ok(
    (Array.isArray(config.Cmd) && config.Cmd.length > 0) ||
      (Array.isArray(config.Entrypoint) && config.Entrypoint.length > 0),
    'Image lacks an effective command',
  );
  return {
    ...pin,
    id: String(image.Id),
    user: String(config.User),
    platform: 'linux/amd64',
    cmd: config.Cmd ?? null,
    entrypoint: config.Entrypoint ?? null,
  };
}
/** @param {string} url @param {Record<string,string>} [headers] */
async function ghcr(url, headers = {}) {
  admitHttps(url, 'ghcr.io');
  try {
    const response = await fetch(url, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status !== 200) await response.body?.cancel();
    assert.equal(response.status, 200);
    const digest = response.headers.get('docker-content-digest');
    return { bytes: await boundedBody(response, 4 * 1024 * 1024), digest };
  } catch {
    throw Error('Anonymous GHCR request failed');
  }
}
/** @param {ImagePin[]} pins @param {string} root @param {ReturnType<typeof localDocker>} [engine] */
export async function acceptImages(pins, root, engine = localDocker()) {
  const endpoint = engine.endpoint;
  const config = join(root, 'anonymous-docker');
  mkdirSync(config, { mode: 0o700 });
  put(join(config, 'config.json'), '{"auths":{}}\n');
  /** @type {NodeJS.ProcessEnv} */ const env = { ...probeEnvironment(), DOCKER_CONFIG: config };
  const rows = [];
  for (const pin of pins) {
    const name = pin.repository.replace(/^ghcr.io\//, '');
    const packageName = name.split('/')[1];
    const access = JSON.parse(
      command('gh', ['api', `orgs/input-output-hk/packages/container/${packageName}`]).stdout,
    );
    assert.equal(access.visibility, 'public');
    assert.equal(access.repository?.full_name, 'input-output-hk/midnight-passport-sdk');
    const tokenReply = await ghcr(
      'https://ghcr.io/token?' +
        new URLSearchParams({ service: 'ghcr.io', scope: `repository:${name}:pull` }),
    );
    const auth = JSON.parse(tokenReply.bytes.toString());
    const token = auth.token ?? auth.access_token;
    assert.ok(typeof token === 'string' && token.length > 0);
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept:
        'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
    };
    const manifest = await ghcr(`https://ghcr.io/v2/${name}/manifests/${pin.version}`, headers);
    assert.equal(`sha256:${sha256(manifest.bytes)}`, pin.digest);
    assert.equal(manifest.digest, pin.digest);
    const alias = await ghcr(`https://ghcr.io/v2/${name}/manifests/${pin.sourceAlias}`, headers);
    assert.ok(alias.bytes.equals(manifest.bytes), 'Source/version image aliases differ');
    assert.equal(JSON.parse(manifest.bytes.toString()).schemaVersion, 2);
    put(join(root, `${pin.role}-manifest.json`), manifest.bytes);
    engine.verify();
    loggedCommand(
      root,
      `${pin.role}-pull.private.log`,
      'docker',
      [
        '--config',
        config,
        '--host',
        endpoint,
        'pull',
        '--platform',
        'linux/amd64',
        `${pin.repository}@${pin.digest}`,
      ],
      { env, timeout: 600_000 },
    );
    const inspected = JSON.parse(
      engine.docker(['image', 'inspect', `${pin.repository}@${pin.digest}`]).stdout,
    );
    assert.equal(inspected.length, 1);
    rows.push({
      ...verifyImage(inspected[0], pin),
      anonymousPull: true,
      visibility: 'public',
      aliasesEqual: true,
      sourceBuildAttestation: false,
      daemonId: engine.daemonId,
    });
  }
  put(
    join(root, 'images.json'),
    JSON.stringify({ kind: 'actual-public-image-identities', images: rows }, null, 2) + '\n',
  );
  return rows;
}
