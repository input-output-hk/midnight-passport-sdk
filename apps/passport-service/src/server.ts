import { createServer as createHttpServer, type Server } from 'node:http';
import type { ServiceConfig } from './config.ts';
import { HttpError, json, type Route } from './http.ts';

export function createServer(config: ServiceConfig, routes: Route[]): Server {
  return createHttpServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', config.corsOrigin);
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
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
