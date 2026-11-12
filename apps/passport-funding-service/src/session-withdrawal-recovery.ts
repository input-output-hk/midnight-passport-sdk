import {
  recoverAgentGrantSpend,
  type AgentGrantSpendReceiptStore,
  type P256GrantSpendFinalitySource,
} from '@input-output-hk/mn-passport-account';
import type { P256GrantSpendSource } from '@input-output-hk/mn-passport-account/ports';
import { HttpError, json, readJson, type Route } from '@input-output-hk/mn-passport-service';
import { abortable } from '@input-output-hk/mn-passport-service/finality';

const address = /^[0-9a-f]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const amount = /^[1-9][0-9]{0,38}$/;

interface RecoveryPorts {
  readonly receipts: Pick<AgentGrantSpendReceiptStore, 'readRecord'>;
  readonly grants: P256GrantSpendSource;
  readonly finality: P256GrantSpendFinalitySource;
  readonly authorize: (header: string | undefined) => boolean;
  readonly eligible: (address: string) => boolean;
}

function recoveryRequest(body: unknown) {
  if (
    !body ||
    typeof body !== 'object' ||
    Object.keys(body).sort().join(',') !== 'accountAddress,amount,grantId,requestId'
  )
    throw new HttpError(400, 'invalid session withdrawal recovery request');
  const { accountAddress, amount: value, grantId, requestId } = body as Record<string, unknown>;
  if (
    typeof accountAddress !== 'string' ||
    !address.test(accountAddress) ||
    typeof grantId !== 'string' ||
    !address.test(grantId) ||
    typeof requestId !== 'string' ||
    !uuid.test(requestId) ||
    typeof value !== 'string' ||
    !amount.test(value) ||
    BigInt(value) >= 1n << 128n
  )
    throw new HttpError(400, 'invalid session withdrawal recovery request');
  return { accountAddress, grantId, requestId, amount: value };
}

/** Observe one original request. There is no wallet, signer, prover or submit port. */
export function sessionWithdrawalRecoveryRoute(ports: RecoveryPorts): Route {
  return async (req, res, url) => {
    if (url.pathname !== '/v1/session-withdrawal/recover') return false;
    if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');
    if (!ports.authorize(req.headers.authorization))
      throw new HttpError(403, 'funding caller refused');
    const input = recoveryRequest(await readJson(req, 512));
    if (!ports.eligible(input.accountAddress))
      throw new HttpError(403, 'value call account is not eligible');
    const record = await ports.receipts.readRecord(input.requestId);
    if (
      !record?.transaction ||
      record.reservation.account !== input.accountAddress ||
      record.reservation.grantId !== input.grantId ||
      record.reservation.amount !== input.amount
    ) {
      json(res, 200, { kind: 'unknown' });
      return true;
    }
    const result = await abortable(
      recoverAgentGrantSpend(
        input.requestId,
        { readRecord: async () => record },
        ports.finality,
        ports.grants,
      ),
      AbortSignal.timeout(12_000),
    );
    json(
      res,
      200,
      result.kind === 'confirmed'
        ? { kind: 'confirmed', ...input, txHash: result.txHash, blockHeight: result.blockHeight }
        : { kind: 'unknown' },
    );
    return true;
  };
}
