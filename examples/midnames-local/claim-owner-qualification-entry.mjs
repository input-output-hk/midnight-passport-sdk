import { commitment, enroll, prove } from './claim-owner-browser-entry.mjs';

globalThis.midnamesOwner = {
  enroll,
  commitment,
  async prove(input, credential) {
    const result = await prove(input, credential);
    return { ...result, bytes: Array.from(result.bytes) };
  },
};
