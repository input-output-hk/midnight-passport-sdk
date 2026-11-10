// Freeze the local daemon endpoint for the entire run, including final cleanup.
import assert from 'node:assert/strict';
import { command } from './process.mjs';

export function localDocker() {
  const context = JSON.parse(command('docker', ['context', 'inspect']).stdout);
  assert.equal(context.length, 1);
  const endpoint = context[0].Endpoints?.docker?.Host;
  assert.ok(
    typeof endpoint === 'string' && /^unix:\/\/\//.test(endpoint),
    'Local Unix Docker endpoint required',
  );
  const info = JSON.parse(
    command('docker', ['--host', endpoint, 'info', '--format', '{{json .}}']).stdout,
  );
  assert.ok(typeof info.ID === 'string' && info.ID, 'Docker daemon identity required');
  /** @type {NodeJS.ProcessEnv} */ const env = { ...process.env };
  for (const key of ['DOCKER_CONTEXT', 'DOCKER_AUTH_CONFIG', 'GITHUB_TOKEN', 'GH_TOKEN'])
    delete env[key];
  /** @type {import('./resources.mjs').Docker} */
  const docker = (args, options = {}) => {
    const current = JSON.parse(
      command('docker', ['--host', endpoint, 'info', '--format', '{{json .}}'], { env }).stdout,
    );
    assert.equal(current.ID, info.ID, 'Docker daemon changed');
    return command('docker', ['--host', endpoint, ...args], {
      ...options,
      env,
      timeout: args[0] === 'start' ? 300_000 : 90_000,
    });
  };
  return {
    docker,
    endpoint,
    daemonId: info.ID,
    info,
    verify() {
      assert.equal(
        JSON.parse(docker(['info', '--format', '{{json .}}']).stdout).ID,
        info.ID,
        'Docker daemon changed',
      );
    },
  };
}
