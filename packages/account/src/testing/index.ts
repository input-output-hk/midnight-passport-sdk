// `@midnight-ntwrk/mn-passport-account/testing` (design §1.1, §7): deterministic fakes of every
// port, and the port contract suites a host runs against its own adapters. It imports only
// `./ports` and `protocol`, so it runs in a browser, Node or a worker.
export * from './contracts.js';
export * from './fakes.js';
export { FAKE_P256_KEYS, signP256, verifyP256 } from './p256.js';
export { fakeDigest, passportError } from './support.js';
