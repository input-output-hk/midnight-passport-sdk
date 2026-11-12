import { z } from 'zod';
import { loadArtefact, resolveBinding } from '@input-output-hk/mn-passport-contract';
import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import { parseContractKeyLocation } from '@midnight-ntwrk/compact-js/effect/ContractKeyLocation';
import type { ProvingKeyMaterial } from '@midnightntwrk/ledger-v9';

const maxArtifactBytes = 512 * 1024 * 1024;
const byteLimit = z.number().int().positive().max(maxArtifactBytes);
const parameterPin = z.strictObject({
  k: z.number().int().min(1).max(255),
  url: z.string().max(2048),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: byteLimit,
});

export interface BrowserProofParameterPin {
  readonly k: number;
  readonly url: string;
  readonly sha256: string;
  readonly size: number;
}

export interface BrowserProofArtifactOptions {
  readonly bindingId: string;
  readonly manifestSha256: string;
  readonly circuits: readonly string[];
  /** Absolute key service URL ending in /v1/zk/<bindingId>. */
  readonly artefactUrl: string;
  readonly parameters: readonly BrowserProofParameterPin[];
  /** Decoded per-file ACC limit. Defaults to 128 MiB. */
  readonly maxAccArtifactBytes?: number;
  readonly fetch?: typeof fetch;
}

function publicUrl(value: string): URL {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Use an HTTPS artifact URL or a loopback HTTP URL without credentials.');
  return url;
}

async function download(
  fetchArtifact: typeof fetch,
  url: URL,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetchArtifact(url.href, {
    method: 'GET',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
  const body = response.body;
  if (!body) throw new Error('Missing artifact body.');
  const reader = body.getReader();
  try {
    if (response.status !== 200 || response.redirected || response.headers.has('content-range'))
      throw new Error('Expected a complete artifact response.');
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('Artifact exceeds its byte limit.');
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** Keep the last verified item and share concurrent reads of that item. */
function recent<Key, Value>(read: (key: Key) => Promise<Value>): (key: Key) => Promise<Value> {
  let current: { key: Key; result: Promise<Value> } | undefined;
  return (key) => {
    if (current?.key === key) return current.result;
    const entry = { key, result: read(key) };
    current = entry;
    void entry.result.catch(() => {
      if (current === entry) current = undefined;
    });
    return entry.result;
  };
}

/** Create public-data callbacks for a trusted local proving engine inside its worker. */
export function createBrowserProofArtifacts(options: BrowserProofArtifactOptions): {
  lookupKey(location: string): Promise<ProvingKeyMaterial | undefined>;
  getParams(k: number): Promise<Uint8Array>;
} {
  const { bindingId, manifestSha256 } = options;
  const binding = resolveBinding(bindingId);
  const base = publicUrl(options.artefactUrl);
  if (base.pathname !== `/v1/zk/${bindingId}` || manifestSha256 !== binding.manifestSha256)
    throw new PassportConnectorError('ArtefactIntegrity', 'Browser proving artifact pin mismatch.');
  const circuits = new Set(
    z
      .array(z.string().regex(/^[a-z][a-z0-9_]{0,127}$/))
      .min(1)
      .max(128)
      .parse(options.circuits),
  );
  for (const circuit of circuits) {
    if (!Object.hasOwn(binding.circuits, circuit) || !binding.circuits[circuit]?.proof)
      throw new PassportConnectorError('BindingUnsupported', 'Unknown browser proving circuit.');
  }
  const limit = byteLimit.parse(options.maxAccArtifactBytes ?? 128 * 1024 * 1024);
  const parameters = new Map<number, { url: URL; sha256: string; size: number }>();
  for (const pin of z.array(parameterPin).min(1).max(32).parse(options.parameters)) {
    if (parameters.has(pin.k)) throw new Error('Duplicate browser proving parameter pin.');
    parameters.set(pin.k, { ...pin, url: publicUrl(pin.url) });
  }
  const fetchArtifact = options.fetch ?? globalThis.fetch.bind(globalThis);
  const loadKey = recent(async (circuit: string): Promise<ProvingKeyMaterial> => {
    const { files } = await loadArtefact(
      (path) => download(fetchArtifact, new URL(base.href + '/' + path), limit),
      {
        version: bindingId,
        circuits: [circuit],
        parts: ['verifierKey', 'bzkir', 'proverKey'],
        module: false,
      },
    );
    const proverKey = files.get(`keys/${circuit}.prover`);
    const verifierKey = files.get(`keys/${circuit}.verifier`);
    const ir = files.get(`zkir/${circuit}.bzkir`);
    if (!proverKey || !verifierKey || !ir)
      throw new PassportConnectorError(
        'ArtefactIntegrity',
        'Missing verified browser proving artifact.',
      );
    return { proverKey, verifierKey, ir };
  });
  const getParams = recent(async (k: number) => {
    const pin = parameters.get(k);
    if (!pin)
      throw new PassportConnectorError('ArtefactIntegrity', 'Unpinned browser proving parameters.');
    const bytes = await download(fetchArtifact, pin.url, pin.size);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (bytes.byteLength !== pin.size || hash !== pin.sha256)
      throw new PassportConnectorError(
        'ArtefactIntegrity',
        'Browser proving parameter pin mismatch.',
      );
    return bytes;
  });
  return {
    async lookupKey(location) {
      const parsed = parseContractKeyLocation(location);
      if (!parsed || !circuits.has(parsed.circuitId)) return undefined;
      if (binding.circuits[parsed.circuitId]?.hashes?.verifierKey !== parsed.verifierKeyHash)
        throw new PassportConnectorError(
          'ArtefactIntegrity',
          'Browser proving verifier pin mismatch.',
        );
      return loadKey(parsed.circuitId);
    },
    getParams,
  };
}
