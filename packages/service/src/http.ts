import type { IncomingMessage, ServerResponse } from 'node:http';

export type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean>;

/** An error that carries the HTTP status the server should answer with. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)));
}

/**
 * Reads a JSON body. Throws HttpError 400 for malformed JSON and 413 for an oversized body.
 * The request is never destroyed here: destroying it would tear down the socket before the
 * error response is written. On overflow the rest of the body is discarded as it arrives.
 */
export function readJson(req: IncomingMessage, limit = 8 * 1024 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overflowed = false;
    req.on('data', (chunk: Buffer) => {
      if (overflowed) return;
      size += chunk.length;
      if (size > limit) {
        overflowed = true;
        chunks.length = 0;
        reject(new HttpError(413, 'request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (overflowed) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(
          new HttpError(
            400,
            e instanceof SyntaxError ? 'request body is not valid JSON' : String(e),
          ),
        );
      }
    });
    req.on('error', reject);
  });
}
