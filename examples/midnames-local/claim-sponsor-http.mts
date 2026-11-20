import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import {
  claimReceipt,
  claimReceiptLimit,
} from '../../apps/passport-dapp/src/midnames/claim-receipt.ts';
import {
  claimDispatchPath,
  isClaimSponsorOrigin,
} from '../../apps/passport-dapp/src/midnames/claim-dispatch.ts';
import { openClaimDispatch, type ClaimDispatchPorts } from './claim-dispatch.mts';
import {
  claimPreparePath,
  claimPreparedPath,
  claimQuotePath,
  claimRetirePath,
  claimRetireFailurePath,
  claimRetireUnpreparedPath,
  claimStatusPath,
} from '../../apps/passport-dapp/src/midnames/claim-preparation-transport.ts';
import {
  claimRetiredArchivePath,
  claimPrepareLimit,
  createClaimPreparationJournal,
  type ClaimSponsorPreparationPorts,
} from './claim-preparation.mts';
import {
  ClaimPreIntentRefusal,
  ClaimSponsorBusy,
} from '../../apps/passport-dapp/src/midnames/claim-quote.ts';

async function readJson(request: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Expected binary request chunks.');
    bytes += chunk.length;
    if (bytes > limit) throw new Error('Claim request is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function sendJson(response: ServerResponse, body: unknown, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

/** Bind a single prepared journal to a trusted loopback demo origin. */
export function createClaimSponsorHandler(
  origin: string,
  directory: string,
  ports: ClaimDispatchPorts,
  preparation?: ClaimSponsorPreparationPorts,
  onError?: (error: unknown) => void,
) {
  if (!isClaimSponsorOrigin(origin)) throw new Error('Claim sponsor requires a loopback origin.');
  const host = new URL(origin).host;
  const journal = openClaimDispatch(directory);
  const prep = preparation && createClaimPreparationJournal(directory, journal, preparation);
  let active = 0;
  let retiring = false;
  const isPreparation = (url: string | undefined) =>
    prep &&
    (url === claimQuotePath ||
      url === claimPreparePath ||
      url === claimPreparedPath ||
      url === claimStatusPath ||
      url === claimRetirePath ||
      url === claimRetireFailurePath ||
      url === claimRetireUnpreparedPath);
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    if (request.url !== claimDispatchPath && !isPreparation(request.url)) return false;
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
    const retire =
      request.url === claimRetirePath ||
      request.url === claimRetireFailurePath ||
      request.url === claimRetireUnpreparedPath;
    if (retiring || (retire && active > 0)) {
      response.writeHead(409).end();
      return true;
    }
    if (retire) retiring = true;
    else active++;
    try {
      const input = await readJson(
        request,
        request.url === claimPreparePath ? claimPrepareLimit : claimReceiptLimit,
      );
      if (request.url === claimDispatchPath) {
        await journal.dispatch(claimReceipt(input), {
          async authorize(bytes, receipt) {
            await ports.authorize(bytes, receipt);
            if (!prep || !receipt.quoteSha256)
              throw new Error('A reviewed claim quote and sponsor are required for dispatch.');
            await prep.authorizeDispatch(bytes, receipt);
          },
          submit: (bytes) => ports.submit(bytes),
        });
        response.writeHead(202).end();
      } else if (prep && request.url === claimQuotePath) {
        sendJson(response, await prep.issue(input));
      } else if (prep && request.url === claimRetirePath) {
        sendJson(response, await prep.retireExpiredUnsent(input));
      } else if (prep && request.url === claimRetireUnpreparedPath) {
        sendJson(response, await prep.retireExpiredUnprepared(input));
      } else if (prep && request.url === claimRetireFailurePath) {
        sendJson(response, await prep.retireIndexedFailure(input));
      } else if (prep && request.url === claimStatusPath) {
        const receipt = claimReceipt(input);
        if (JSON.stringify(journal.preparedReceipt()) === JSON.stringify(receipt)) {
          sendJson(response, {
            status: journal.hasFence(receipt) ? 'sent-or-unknown' : 'prepared',
          });
        } else if (existsSync(claimRetiredArchivePath(directory, receipt))) {
          const archived = openClaimDispatch(
            claimRetiredArchivePath(directory, receipt),
          ).preparedReceipt();
          if (JSON.stringify(archived) !== JSON.stringify(receipt))
            throw new Error('The retired local original differs.');
          sendJson(response, { status: 'retired' });
        } else {
          throw new Error('The local sponsor has no matching prepared original.');
        }
      } else if (prep) {
        const result = await (request.url === claimPreparePath
          ? prep.prepare(input)
          : prep.findPrepared(input));
        if (result?.receipt) sendJson(response, result.receipt);
        else response.writeHead(result ? 202 : 404).end();
      }
    } catch (error) {
      onError?.(error);
      if (
        error instanceof Error &&
        error.message === 'The dedicated claim sponsor needs NIGHT and two DUST inputs.'
      ) {
        sendJson(response, { code: 'SponsorNeedsFunding' }, 409);
        return true;
      }
      response
        .writeHead(
          error instanceof ClaimSponsorBusy
            ? 423
            : error instanceof ClaimPreIntentRefusal
              ? 412
              : 409,
        )
        .end();
    } finally {
      if (retire) retiring = false;
      else active--;
    }
    return true;
  };
}
