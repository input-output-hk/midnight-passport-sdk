import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  claimReceipt,
  claimReceiptLimit,
} from '../../apps/passport-dapp/src/midnames/claim-receipt.ts';
import {
  claimDispatchPath,
  isClaimSponsorOrigin,
} from '../../apps/passport-dapp/src/midnames/claim-dispatch.ts';
import { openClaimDispatch, type ClaimDispatchPorts } from './claim-dispatch.mts';

async function readAcknowledgement(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Expected binary request chunks.');
    bytes += chunk.length;
    if (bytes > claimReceiptLimit) throw new Error('Claim acknowledgement is too large.');
    chunks.push(chunk);
  }
  return claimReceipt(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

/** Bind a single prepared journal to a trusted loopback demo origin. */
export function createClaimSponsorHandler(
  origin: string,
  directory: string,
  ports: ClaimDispatchPorts,
) {
  if (!isClaimSponsorOrigin(origin)) throw new Error('Claim sponsor requires a loopback origin.');
  const host = new URL(origin).host;
  const journal = openClaimDispatch(directory);
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    if (request.url !== claimDispatchPath) return false;
    response.setHeader('Cache-Control', 'no-store');
    if (
      request.method !== 'POST' ||
      request.headers.host !== host ||
      request.headers.origin !== origin ||
      request.headers['content-type'] !== 'application/json'
    ) {
      response.writeHead(403).end();
      return true;
    }
    try {
      const acknowledged = await readAcknowledgement(request);
      await journal.dispatch(acknowledged, ports);
      response.writeHead(202).end();
    } catch {
      response.writeHead(409).end();
    }
    return true;
  };
}
