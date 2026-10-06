import { createServer as createHttpServer, type IncomingMessage, type Server } from 'node:http';
import type { ServiceConfig } from './config.ts';
import { HttpError, json, type Route } from './http.ts';

/** Methods that carry no body and change nothing; every other method must send JSON. */
const BODILESS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The Host values this server answers: loopback names at the port the request arrived on, plus the
 * configured bind host when `PASSPORT_SERVICE_HOST` overrides it. A DNS-rebound attacker page
 * sends its own name, so it is refused even though it reaches the socket (Final review I1).
 */
function allowedHosts(config: ServiceConfig, port: number | undefined): Set<string> {
  const names = new Set(['127.0.0.1', 'localhost', '[::1]']);
  const bind = config.host.toLowerCase();
  names.add(bind.includes(':') && !bind.startsWith('[') ? `[${bind}]` : bind);
  return new Set([...names].map((name) => `${name}:${port}`));
}

/** True when the body is declared as JSON: `application/json`, parameters allowed. */
const isJson = (req: IncomingMessage): boolean =>
  (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase() === 'application/json';

export function createServer(config: ServiceConfig, routes: Route[]): Server {
  return createHttpServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', config.corsOrigin);
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, OPTIONS');
    const host = req.headers.host?.toLowerCase();
    if (host === undefined || !allowedHosts(config, req.socket.localPort).has(host)) {
      json(res, 421, { error: 'unknown host' });
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    // CORS limits who may read an answer, not who may send a request: a cross-site page can POST a
    // text/plain body with no preflight. Requiring JSON forces the preflight, which only the dapp
    // origin passes (Final review I1). The body is never read, so the connection is closed.
    if (!BODILESS.has(req.method ?? '') && !isJson(req)) {
      res.setHeader('connection', 'close');
      json(res, 415, { error: 'the request body must be application/json' });
      return;
    }
    const url = new URL(req.url ?? '/', `http://${host}`);
    try {
      for (const route of routes) if (await route(req, res, url)) return;
      json(res, 404, { error: 'not found' });
    } catch (e) {
      if (e instanceof HttpError) {
        // An oversized body may still be arriving; close the connection once the answer is out.
        if (e.status === 413) res.setHeader('connection', 'close');
        json(res, e.status, { error: e.message });
      } else {
        json(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    }
  });
}
