import { Buffer } from 'buffer';
// First import of the app: the SDK chunks read the Buffer global at load time.
(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;
