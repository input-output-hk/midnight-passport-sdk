// Native-session infrastructure is isolated from all retained localnets. No side effects.
import assert from 'node:assert/strict';
import { assertNativeContainer } from './native-container-shape.mjs';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from 'node:fs';
import { join, relative, sep, dirname, basename, isAbsolute } from 'node:path';
export const SESSION_PORTS = Object.freeze({ node: 19964, indexer: 18108, prover: 16320 });
export const SESSION_ENDPOINTS = Object.freeze({
  nodeUrl: 'http://127.0.0.1:19964',
  indexerUrl: 'http://127.0.0.1:18108/api/v4/graphql',
  indexerWsUrl: 'ws://127.0.0.1:18108/api/v4/graphql/ws',
  proverUrl: 'http://127.0.0.1:16320',
});
/** @param {string} runId */
export function sessionProject(runId) {
  assert.match(runId, /^[a-f0-9]{16}$/);
  return `mn-passport-session-${runId}`;
}
/** Verify actual identity, endpoint and private volume ownership before cleanup or use.
 * @param {any} c @param {string} project @param {'node'|'indexer'|'proof-server'} service
 * @param {string} image @param {boolean} [running]
 */
export function sessionContainer(c, project, service, image, running = true) {
  assert.match(project, /^mn-passport-session-[a-f0-9]{16}$/);
  const port =
    service === 'node'
      ? SESSION_PORTS.node
      : service === 'indexer'
        ? SESSION_PORTS.indexer
        : SESSION_PORTS.prover;
  return assertNativeContainer(c, {
    project,
    labelPrefix: 'passport.session',
    service,
    image,
    port,
    running,
  });
}

/** Audit executable workspace dependencies, recording only known workspace package links as
 * source-bound seams. Their tracked source and generated dist are pinned by workspaceIdentity.
 * No arbitrary outside link or recursively traversed private workspace directory is allowed.
 * @param {string} workspace
 */
export function sessionDependencyIdentity(workspace) {
  const root = realpathSync(workspace),
    modules = join(root, 'node_modules');
  assert.ok(!lstatSync(modules).isSymbolicLink());
  const hash = createHash('sha256');
  let files = 0,
    links = 0,
    workspaceLinks = 0;
  /** @param {string} path @param {string} name */
  const walk = (path, name) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      const target = realpathSync(path);
      if (target !== modules && !target.startsWith(modules + sep)) {
        const destination = relative(root, target).split(sep);
        assert.ok(
          destination.length === 2 && ['packages', 'apps'].includes(destination[0] ?? ''),
          'Dependency link escapes the frozen workspace',
        );
        const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
        assert.ok(
          typeof manifest.name === 'string' &&
            (manifest.name.startsWith('@input-output-hk/mn-passport-') ||
              manifest.name.startsWith('passport-')),
          'Outside link is not a known workspace package',
        );
        workspaceLinks++;
      }
      hash.update(`link\0${name}\0${readlinkSync(path)}\n`);
      links++;
    } else if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) walk(join(path, entry), name + '/' + entry);
    } else {
      assert.ok(stat.isFile(), 'Dependency input is not a regular file');
      hash.update(
        `file\0${name}\0${createHash('sha256').update(readFileSync(path)).digest('hex')}\n`,
      );
      files++;
    }
  };
  walk(modules, 'node_modules');
  for (const parent of ['packages', 'apps']) {
    if (!existsSync(join(root, parent))) continue;
    for (const entry of readdirSync(join(root, parent)).sort()) {
      const local = join(root, parent, entry, 'node_modules');
      if (!existsSync(local)) continue;
      assert.ok(!lstatSync(local).isSymbolicLink(), 'Local dependency root must not be a symlink');
      walk(local, `${parent}/${entry}/node_modules`);
    }
  }
  assert.ok(files > 0);
  return { files, links, workspaceLinks, treeSha256: hash.digest('hex') };
}

/** Require a new canonical output outside every frozen input tree.
 * @param {string} requested @param {string[]} inputs
 */
export function sessionOutputPath(requested, inputs) {
  assert.ok(isAbsolute(requested), 'Native session output must be absolute');
  const output = join(realpathSync(dirname(requested)), basename(requested));
  for (const input of inputs) {
    const root = realpathSync(input);
    assert.ok(
      output !== root && !output.startsWith(root + sep) && !root.startsWith(output + sep),
      'Native output overlaps frozen inputs',
    );
  }
  return output;
}
