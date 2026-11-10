// Credentials are attached only after exact-origin admission; redirects are never automatic.
import assert from 'node:assert/strict';

/** @param {string} input @param {string} hostname */
export function admitHttps(input, hostname) {
  const url = new URL(input);
  assert.ok(
    url.protocol === 'https:' &&
      url.hostname === hostname &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash,
    'Untrusted HTTPS origin',
  );
  return url;
}
/** @param {string} input */
export function admitArtifactRedirect(input) {
  const url = admitHttps(input, 'pkg-npm.githubusercontent.com');
  const signatures = url.searchParams.getAll('sig'),
    protocols = url.searchParams.getAll('spr');
  assert.ok(
    signatures.length === 1 && signatures[0] && signatures[0].trim().length > 0,
    'Ambiguous CDN signature',
  );
  assert.deepEqual(protocols, ['https'], 'Ambiguous CDN protocol');
  return url;
}
/** Bounds streamed responses, including a dishonest/missing Content-Length.
 * @param {Response} response @param {number} limit */
export async function boundedBody(response, limit) {
  assert.ok(Number.isSafeInteger(limit) && limit > 0);
  const chunks = [];
  let length = 0;
  assert.ok(response.body, 'Missing response body');
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      assert.ok(length <= limit, 'Response exceeds byte limit');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
/** @typedef {(url:string,init:RequestInit)=>Promise<Response>} Fetch */
/** Sanitizes all transport failures: signed CDN URLs and credentials never reach errors.
 * @param {string} url @param {string} token @param {{artifact?:boolean,limit?:number,fetch?:Fetch}} [options] */
export async function registryBytes(url, token, options = {}) {
  admitHttps(url, 'npm.pkg.github.com');
  assert.ok(token.length >= 8 && !/[\r\n]/.test(token), 'Registry credential required');
  const request = options.fetch ?? fetch;
  try {
    const response = await request(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status === 200)
      return await boundedBody(response, options.limit ?? 4 * 1024 * 1024);
    const location = response.headers.get('location');
    await response.body?.cancel();
    assert.ok(
      options.artifact && response.status === 302 && location,
      'Unexpected registry redirect/status',
    );
    const target = admitArtifactRedirect(new URL(location, url).href);
    const cdn = await request(target.href, {
      headers: { Accept: 'application/octet-stream' },
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
    });
    if (cdn.status !== 200) await cdn.body?.cancel();
    assert.equal(cdn.status, 200, 'Unexpected CDN redirect/status');
    return await boundedBody(cdn, options.limit ?? 32 * 1024 * 1024);
  } catch {
    throw Error('Registry transport refused or failed; credentials and signed URL omitted');
  }
}
/** @param {string} url @param {number} limit @param {Fetch} [request] */
export async function publicBytes(url, limit, request = fetch) {
  const parsed = new URL(url);
  admitHttps(url, parsed.hostname);
  try {
    const response = await request(url, {
      redirect: 'manual',
      headers: { 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status !== 200) await response.body?.cancel();
    assert.equal(response.status, 200);
    return await boundedBody(response, limit);
  } catch {
    throw Error('Public artifact request failed');
  }
}
