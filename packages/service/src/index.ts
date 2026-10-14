/** Node HTTP service primitives over an injected Passport chain backend. */
export { createServer, type HttpServiceConfig } from './server.js';
export { chainRoute, type ChainRouteOptions } from './chain.js';
export type { ChainBackend } from './backend.js';
export { HttpError, json, readJson, type Route } from './http.js';
export { serial } from './queue.js';
export { verifyArtefacts, bindingCircuits } from './artefacts.js';
export { zkRoute, type ArtefactRouteConfig } from './artefact-route.js';
export { createMemoryJobStore, jobsRoute, type JobStore, type JobStoreOptions } from './jobs.js';
