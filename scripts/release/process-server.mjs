// A worker exits itself; control never signals a potentially reused PID or group.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { chmodSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { admitProcessMessage, processProof } from './process-protocol.mjs';

/** @param {{key:Buffer,launchSha256:string,identitySha256:string,controlDirectory:string,phase:()=>string,admitGo:()=>void,run:()=>void,close:()=>void}} options */
export async function processServer(options) {
  const used = new Set();
  /** @type {Set<import('node:net').Socket>} */ const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.setTimeout(2_000, () => socket.destroy());
    let bytes = '',
      handled = false;
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk) => {
      if (handled) return socket.destroy();
      bytes += chunk.toString('utf8');
      if (Buffer.byteLength(bytes) > 4096) return socket.destroy();
      if (!bytes.includes('\n')) return;
      handled = true;
      try {
        assert.ok(bytes.endsWith('\n') && bytes.indexOf('\n') === bytes.length - 1);
        const request = admitProcessMessage(options.key, 'request', JSON.parse(bytes));
        assert.equal(request.launch, options.launchSha256);
        assert.equal(request.identity, options.identitySha256);
        assert.ok(!used.has(request.challenge) && used.size < 1024, 'Repeated control challenge');
        used.add(request.challenge);
        if (request.action === 'go') {
          assert.equal(options.phase(), 'ready');
          options.admitGo();
        }
        const reply = {
          ...request,
          phase: request.action === 'shutdown' ? 'closing' : options.phase(),
        };
        socket.end(
          JSON.stringify({ ...reply, proof: processProof(options.key, 'reply', reply) }) + '\n',
          () => {
            if (request.action === 'shutdown') options.close();
            else if (request.action === 'go') options.run();
          },
        );
      } catch {
        socket.destroy();
      }
    });
  });
  server.maxConnections = 4;
  const path = join(options.controlDirectory, 'c.sock');
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => resolve(undefined));
  });
  chmodSync(path, 0o600);
  const stat = lstatSync(path);
  return {
    pin: { dev: stat.dev, ino: stat.ino },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    },
  };
}
