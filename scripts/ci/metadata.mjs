// Public registry metadata: bounded work, no user credentials or cached age assertions.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export class MetadataFailure extends Error {
  /** @param {string} name @param {string} code @param {boolean} [retryable] */
  constructor(name, code, retryable = false) {
    super(`Publish metadata refused for ${name}: ${code}`);
    this.name = 'MetadataFailure';
    this.code = code;
    this.retryable = retryable;
  }
}
/** @param {unknown} name */
export function packageName(name) {
  assert.equal(typeof name, 'string');
  assert.ok(String(name).length <= 214);
  assert.equal(/\s/.test(String(name)), false);
  assert.match(
    String(name),
    /^(?:@[A-Za-z0-9_~-][A-Za-z0-9._~-]*\/)?[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/,
  );
  return String(name);
}
/** @template T @param {Promise<T>} promise @param {AbortSignal} signal */
async function underSignal(promise, signal) {
  /** @type {()=>void} */ let abort = () => {};
  /** @type {Promise<never>} */ const aborted = new Promise((_, reject) => {
    abort = () => reject(Error('Metadata request aborted'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
/** @param {Response} response @param {number} maxBytes @param {AbortSignal} signal */
async function boundedBody(response, maxBytes, signal) {
  assert.ok(response.body, 'Metadata body missing');
  const reader = response.body.getReader();
  /** @type {Uint8Array[]} */ const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const part = await underSignal(reader.read(), signal);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw Error('Metadata body exceeds limit');
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    void reader.cancel().catch(() => {});
  }
}
/** @param {string} name @param {typeof fetch} fetcher @param {AbortSignal} signal @param {number} maxBytes */
async function fetchTimes(name, fetcher, signal, maxBytes) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  let response;
  try {
    response = await underSignal(
      fetcher(url, { redirect: 'manual', headers: { Accept: 'application/json' }, signal }),
      signal,
    );
  } catch {
    throw new MetadataFailure(name, 'transport', true);
  }
  if (response.status !== 200) {
    void response.body?.cancel().catch(() => {});
    throw new MetadataFailure(
      name,
      `http-${response.status}`,
      response.status === 429 || response.status >= 500,
    );
  }
  if (
    (response.url && response.url !== url) ||
    !/^application\/(?:json|[\w.-]+\+json)(?:;|$)/i.test(response.headers.get('content-type') ?? '')
  ) {
    void response.body?.cancel().catch(() => {});
    throw new MetadataFailure(name, 'response-identity');
  }
  let value;
  try {
    value = await boundedBody(response, maxBytes, signal);
  } catch {
    throw new MetadataFailure(
      name,
      signal.aborted ? 'read-timeout' : 'invalid-body',
      signal.aborted,
    );
  }
  if (
    !value ||
    value.name !== name ||
    !value.time ||
    typeof value.time !== 'object' ||
    Array.isArray(value.time)
  )
    throw new MetadataFailure(name, 'missing-times');
  return /** @type {Record<string,unknown>} */ (value.time);
}
/** @typedef {{fetcher?:typeof fetch,concurrency?:number,attempts?:number,requestMs?:number,overallMs?:number,maxBytes?:number}} MetadataOptions */
/** @param {string[]} names @param {MetadataOptions} [options] */
export async function publishTimes(names, options = {}) {
  const concurrency = options.concurrency ?? 4,
    attempts = options.attempts ?? 2,
    requestMs = options.requestMs ?? 8_000,
    overallMs = options.overallMs ?? 30_000,
    maxBytes = options.maxBytes ?? 32 * 1024 ** 2;
  for (const n of [concurrency, attempts, requestMs, overallMs, maxBytes])
    assert.ok(Number.isSafeInteger(n) && n > 0);
  assert.ok(
    concurrency <= 8 &&
      attempts <= 3 &&
      requestMs <= 10_000 &&
      overallMs <= 45_000 &&
      maxBytes <= 32 * 1024 ** 2,
  );
  const unique = [...new Set(names.map(packageName))].sort();
  assert.ok(unique.length <= 500, 'Metadata batch exceeds supported bound');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), overallMs);
  /** @type {Map<string,Record<string,unknown>>} */ const results = new Map();
  let index = 0,
    calls = 0;
  /** @type {unknown} */ let failure;
  try {
    await Promise.allSettled(
      Array.from({ length: Math.min(concurrency, unique.length) }, async () => {
        while (index < unique.length && !failure) {
          const name = unique[index++];
          assert.ok(name);
          for (let attempt = 1; attempt <= attempts; attempt++) {
            calls++;
            try {
              if (controller.signal.aborted) throw new MetadataFailure(name, 'overall-deadline');
              const times = await fetchTimes(
                name,
                options.fetcher ?? fetch,
                AbortSignal.any([controller.signal, AbortSignal.timeout(requestMs)]),
                maxBytes,
              );
              results.set(name, times);
              break;
            } catch (error) {
              if (
                !(error instanceof MetadataFailure) ||
                !error.retryable ||
                attempt === attempts ||
                controller.signal.aborted
              ) {
                failure ??= error;
                controller.abort();
                return;
              }
              await delay(100, undefined, { signal: controller.signal }).catch(() => {});
            }
          }
        }
      }),
    );
    if (failure) throw failure;
    assert.equal(results.size, unique.length, 'Incomplete metadata batch');
    return {
      times: results,
      packages: unique.length,
      calls,
      concurrency,
      attempts,
      requestMs,
      overallMs,
      maxBytes,
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
