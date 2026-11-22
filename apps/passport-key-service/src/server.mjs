import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pipeline } from 'node:stream';
import { gunzipSync } from 'node:zlib';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const circuitName = /^[a-z][a-z0-9_]*$/;

function parseKeyManifest(bytes, bindingId, manifestSha256, manifest) {
  if (!bytes) return undefined;
  const keyManifest = JSON.parse(bytes.toString('utf8'));
  if (
    keyManifest.schemaVersion !== 1 ||
    keyManifest.bindingId !== bindingId ||
    keyManifest.compilerManifestSha256 !== manifestSha256 ||
    Object.keys(keyManifest.circuits ?? {}).length !==
      Object.keys(manifest.keys ?? {}).filter((name) => name.endsWith('.prover')).length
  )
    throw new Error('key manifest does not match the compiler profile');
  return keyManifest;
}

function selectedKeyPin(name, pin, keyManifest) {
  if (!keyManifest) return pin;
  const match = /^([a-z][a-z0-9_]*)\.(prover|verifier)$/.exec(name);
  const profilePin = match && keyManifest.circuits?.[match[1]]?.[match[2]];
  if (
    !Number.isSafeInteger(profilePin?.size) ||
    profilePin.size <= 0 ||
    !/^[a-f0-9]{64}$/.test(profilePin?.sha256 ?? '')
  )
    throw new Error(`invalid key-generation pin: ${name}`);
  return { type: 'file', size: profilePin.size, hash: profilePin.sha256 };
}

function assertZkirPin(name, pin, keyManifest) {
  if (!keyManifest) return;
  const [circuit, kind] = name.split('.');
  const profilePin = keyManifest.circuits?.[circuit]?.[kind];
  if (profilePin?.size !== pin.size || profilePin?.sha256 !== pin.hash)
    throw new Error(`ZKIR key profile differs from compiler manifest: ${name}`);
}

export function loadBundle(bundlePath, bindingId, manifestSha256, keyManifestBytes) {
  const bundle = JSON.parse(gunzipSync(readFileSync(bundlePath)).toString('utf8'));
  if (bundle.schemaVersion !== 1 || bundle.bindingId !== bindingId)
    throw new Error('unsupported key bundle');
  const manifestBytes = Buffer.from(bundle.manifest, 'utf8');
  if (digest(manifestBytes) !== manifestSha256) throw new Error('compiler manifest hash mismatch');
  const manifest = JSON.parse(bundle.manifest);
  if (manifest['compiler-version'] !== '0.35.0' || manifest['manifest-version'] !== '1')
    throw new Error('unsupported compiler manifest');
  const keyManifest = parseKeyManifest(keyManifestBytes, bindingId, manifestSha256, manifest);

  const expected = new Map();
  const provers = new Map();
  for (const [name, pin] of Object.entries(manifest.keys ?? {})) {
    if (name === 'type') continue;
    const match = /^([a-z][a-z0-9_]*)\.(prover|verifier)$/.exec(name);
    if (!match || pin?.type !== 'file') throw new Error(`unexpected key entry: ${name}`);
    const selectedPin = selectedKeyPin(name, pin, keyManifest);
    if (match[2] === 'prover') provers.set(name, selectedPin);
    else expected.set(`keys/${name}`, selectedPin);
  }
  for (const [name, pin] of Object.entries(manifest.zkir ?? {})) {
    if (name === 'type') continue;
    if (!/^([a-z][a-z0-9_]*)\.(zkir|bzkir)$/.test(name) || pin?.type !== 'file')
      throw new Error(`unexpected ZKIR entry: ${name}`);
    assertZkirPin(name, pin, keyManifest);
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

function keyAsset(path, name, files, manifestBytes, keyManifestBytes, provers, keyDir) {
  let bytes;
  let diskPath;
  let size;
  if (path === '/v1/manifest') bytes = keyManifestBytes;
  else if (name === 'compiler/contract-manifest.json') bytes = manifestBytes;
  else if (name) {
    bytes = files.get(name);
    if (!bytes && name.startsWith('keys/') && name.endsWith('.prover')) {
      const circuit = name.slice('keys/'.length, -'.prover'.length);
      const pin = provers.get(`${circuit}.prover`);
      if (circuitName.test(circuit) && pin) {
        diskPath = join(keyDir, `${circuit}.prover`);
        try {
          size = statSync(diskPath).size;
        } catch {
          return { unavailable: true };
        }
        if (size !== pin.size) {
          return { unavailable: true };
        }
      }
    }
  }
  if (!bytes && !diskPath) return undefined;
  return { bytes, diskPath, size: size ?? bytes.length };
}

function corsHeaders(req, res, corsOrigins) {
  const origin = req.headers.origin;
  if (corsOrigins.length) res.setHeader('vary', 'Origin');
  if (origin && corsOrigins.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-methods', 'GET, HEAD, OPTIONS');
    res.setHeader('access-control-allow-headers', 'range');
    res.setHeader('access-control-expose-headers', 'accept-ranges, content-range, content-length');
  }
}

function keyPath(path, bindingId) {
  const prefix = path.startsWith(`/v1/zk/${bindingId}/`)
    ? `/v1/zk/${bindingId}/`
    : bindingId === 'acc-s3r1.1' && path.startsWith('/zk/acc/')
      ? '/zk/acc/'
      : undefined;
  return prefix && path.slice(prefix.length);
}

export function createKeyServer({
  bindingId,
  files,
  manifestBytes,
  keyManifestBytes,
  provers,
  keyDir,
  profile = { name: 'all', circuits: [...provers.keys()].map((name) => name.slice(0, -7)) },
  corsOrigins = [],
}) {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(bindingId)) throw new Error('invalid binding ID');
  const available = new Set(profile.circuits);
  // Deployment installs verifier keys for operations whose proofs may be produced by a caller
  // outside the owner module. A proving cache profile must not hide the bundled verifiers.
  const verifierCircuits = [...files.keys()]
    .filter((name) => /^keys\/[a-z][a-z0-9_]*\.verifier$/.test(name))
    .map((name) => name.slice('keys/'.length, -'.verifier'.length))
    .sort();
  return createServer((req, res) => {
    const origin = req.headers.origin;
    corsHeaders(req, res, corsOrigins);
    if (req.method === 'OPTIONS') {
      res.writeHead(origin && corsOrigins.includes(origin) ? 204 : 403).end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD, OPTIONS' }).end();
      return;
    }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        req.method === 'HEAD' ? undefined : JSON.stringify({ ready: true, profile: profile.name }),
      );
      return;
    }
    if (path === '/v1/profile') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ...profile, verifierCircuits }));
      return;
    }
    const name = keyPath(path, bindingId);
    const circuitPath = /^(?:zkir|keys)\/([a-z][a-z0-9_]*)\.(?:zkir|bzkir|prover)$/.exec(
      name ?? '',
    );
    if (circuitPath && !available.has(circuitPath[1])) {
      res.writeHead(404).end();
      return;
    }
    const asset = keyAsset(path, name, files, manifestBytes, keyManifestBytes, provers, keyDir);
    if (asset?.unavailable) {
      res.writeHead(503).end();
      return;
    }
    if (!asset) {
      res.writeHead(404).end();
      return;
    }
    const { bytes, diskPath, size } = asset;
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
