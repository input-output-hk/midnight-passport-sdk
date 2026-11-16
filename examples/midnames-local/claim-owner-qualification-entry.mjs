import { commitment, enroll, prove, proveReviewedClaim } from './claim-owner-browser-entry.mjs';

globalThis.midnamesOwner = {
  enroll,
  commitment,
  async prove(input, credential) {
    const result = await prove(input, credential);
    return { ...result, bytes: Array.from(result.bytes) };
  },
  async proveReviewed(quote, credential) {
    const result = await proveReviewedClaim(
      quote,
      Uint8Array.from(credential.match(/../g), (part) => parseInt(part, 16)),
      () => {
        if (quote.expiresAt <= Date.now()) throw new Error('Reviewed quote expired.');
      },
    );
    return { ...result, bytes: Array.from(result.bytes) };
  },
};
