import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pipeline } from 'node:stream';
import { gunzipSync } from 'node:zlib';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const circuitName = /^[a-z][a-z0-9_]*$/;

export function loadBundle(bundlePath, bindingId, manifestSha256) {
  const bundle = JSON.parse(gunzipSync(readFileSync(bundlePath)).toString('utf8'));
  if (bundle.schemaVersion !== 1 || bundle.bindingId !== bindingId)
    throw new Error('unsupported key bundle');
  const manifestBytes = Buffer.from(bundle.manifest, 'utf8');
  if (digest(manifestBytes) !== manifestSha256) throw new Error('compiler manifest hash mismatch');
  const manifest = JSON.parse(bundle.manifest);
  if (manifest['compiler-version'] !== '0.35.0' || manifest['manifest-version'] !== '1')
    throw new Error('unsupported compiler manifest');

  const expected = new Map();
  const provers = new Map();
  for (const [name, pin] of Object.entries(manifest.keys ?? {})) {
    if (name === 'type') continue;
    const match = /^([a-z][a-z0-9_]*)\.(prover|verifier)$/.exec(name);
    if (!match || pin?.type !== 'file') throw new Error(`unexpected key entry: ${name}`);
    if (match[2] === 'prover') provers.set(name, pin);
    else expected.set(`keys/${name}`, pin);
  }
  for (const [name, pin] of Object.entries(manifest.zkir ?? {})) {
    if (name === 'type') continue;
    if (!/^([a-z][a-z0-9_]*)\.(zkir|bzkir)$/.test(name) || pin?.type !== 'file')
      throw new Error(`unexpected ZKIR entry: ${name}`);
    expected.set(`zkir/${name}`, pin);
  }
  if (Object.keys(bundle.files ?? {}).length !== expected.size || !provers.size)
    throw new Error('key bundle has an incomplete input set');
  const files = new Map();
  for (const [name, pin] of expected) {
    const encoded = bundle.files[name];
    if (typeof encoded !== 'string') throw new Error(`missing bundled input: ${name}`);
    const bytes = Buffer.from(encoded, 'base64');
    if (
      bytes.toString('base64') !== encoded ||
      bytes.length !== pin.size ||
      digest(bytes) !== pin.hash
    )
      throw new Error(`bundled input differs from manifest: ${name}`);
    files.set(name, bytes);
  }
  return { files, manifestBytes, provers };
}

function rangeFor(header, size) {
  if (header === undefined) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return undefined;
  let start;
  let end;
  if (!match[1]) {
    const count = Number(match[2]);
    if (!Number.isSafeInteger(count) || count < 1) return undefined;
    start = Math.max(0, size - count);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    return undefined;
  return { start, end: Math.min(end, size - 1), partial: true };
}

export function createKeyServer({ files, manifestBytes, keyManifestBytes, provers, keyDir }) {
  return createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ready: true }));
      return;
    }
    let bytes;
    let diskPath;
    let size;
    if (path === '/v1/manifest') bytes = keyManifestBytes;
    else if (path === '/zk/acc/compiler/contract-manifest.json') bytes = manifestBytes;
    else if (path.startsWith('/zk/acc/')) {
      const name = path.slice('/zk/acc/'.length);
      bytes = files.get(name);
      if (!bytes && name.startsWith('keys/') && name.endsWith('.prover')) {
        const circuit = name.slice('keys/'.length, -'.prover'.length);
        const pin = provers.get(`${circuit}.prover`);
        if (circuitName.test(circuit) && pin) {
          diskPath = join(keyDir, `${circuit}.prover`);
          try {
            size = statSync(diskPath).size;
          } catch {
            res.writeHead(503).end();
            return;
          }
          if (size !== pin.size) {
            res.writeHead(503).end();
            return;
          }
        }
      }
    }
    if (!bytes && !diskPath) {
      res.writeHead(404).end();
      return;
    }
    size ??= bytes.length;
    const range = rangeFor(req.headers.range, size);
    if (!range) {
      res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
      return;
    }
    res.writeHead(range.partial ? 206 : 200, {
      'content-type': 'application/octet-stream',
      'content-length': range.end - range.start + 1,
      'accept-ranges': 'bytes',
      ...(range.partial ? { 'content-range': `bytes ${range.start}-${range.end}/${size}` } : {}),
      'cache-control':
        path.endsWith('contract-manifest.json') || path === '/v1/manifest'
          ? 'no-cache'
          : 'public, max-age=31536000, immutable',
    });
    if (req.method === 'HEAD') {
      res.end();
    } else if (bytes) {
      res.end(bytes.subarray(range.start, range.end + 1));
    } else {
      pipeline(createReadStream(diskPath, { start: range.start, end: range.end }), res, (err) => {
        if (err) res.destroy();
      });
    }
  });
}
