import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  Contract,
  ledger,
  pureCircuits,
} from '@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1';
import {
  createMidnightChain,
  createMidnightWalletPorts,
} from '@input-output-hk/mn-passport-adapter-midnight-js';
import { remoteV1Prover } from '@input-output-hk/mn-passport-adapter-service';
import { HttpError, json, readJson, serial } from '@input-output-hk/mn-passport-service';
import type { FundingConfig } from './config.ts';
import { deployedAddresses } from './deployments.ts';

const HEX32 = /^[0-9a-f]{64}$/;
const CIRCUIT_LENGTH = new Map([
  ['withdraw_unshielded_with_p256', 4],
  ['withdraw_unshielded_with_jubjub', 8],
  ['withdraw_unshielded_with_grant_jubjub', 14],
]);
const U256 = (1n << 256n) - 1n;

/** Decode only the two tagged primitive types sent by the demo. */
export function decodeValueArg(value: unknown, depth = 0): unknown {
  if (depth > 8) throw new HttpError(400, 'value call arguments are too deep');
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (Array.isArray(value)) {
    if (value.length > 32) throw new HttpError(400, 'value call array is too long');
    return value.map((item) => decodeValueArg(item, depth + 1));
  }
  if (!value || typeof value !== 'object') throw new HttpError(400, 'invalid value call argument');
  const fields = value as Record<string, unknown>;
  const keys = Object.keys(fields);
  if (keys.length === 1 && keys[0] === '$bytes') {
    if (typeof fields.$bytes !== 'string' || !/^(?:[0-9a-f]{2}){0,2048}$/.test(fields.$bytes))
      throw new HttpError(400, 'invalid value call bytes');
    return Uint8Array.from(Buffer.from(fields.$bytes, 'hex'));
  }
  if (keys.length === 1 && keys[0] === '$bigint') {
    if (typeof fields.$bigint !== 'string' || !/^(0|[1-9][0-9]*)$/.test(fields.$bigint))
      throw new HttpError(400, 'invalid value call integer');
    const integer = BigInt(fields.$bigint);
    if (integer > U256) throw new HttpError(400, 'value call integer exceeds 256 bits');
    return integer;
  }
  if (
    keys.length > 16 ||
    keys.some(
      (key) => key === 'constructor' || key === 'prototype' || !/^[a-z][a-z0-9_]{0,31}$/.test(key),
    )
  )
    throw new HttpError(400, 'invalid value call object');
  return Object.fromEntries(keys.map((key) => [key, decodeValueArg(fields[key], depth + 1)]));
}

export function valueCallRoute(
  config: FundingConfig,
  wallet: {
    providers: {
      walletProvider: Parameters<typeof createMidnightWalletPorts>[0];
      midnightProvider: Parameters<typeof createMidnightWalletPorts>[1];
    };
  },
  authorized: (header: string | undefined) => boolean,
) {
  const runExclusive = serial(2);
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname !== '/v1/value-call') return false;
    if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');
    if (!authorized(req.headers.authorization)) throw new HttpError(403, 'funding caller refused');
    if (
      config.networkId !== 'undeployed' ||
      !['127.0.0.1', 'localhost', '::1'].includes(config.host)
    )
      throw new HttpError(403, 'demo value calls require the loopback localnet');
    const body = await readJson(req, 16 * 1024);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new HttpError(400, 'invalid value call');
    const fields = body as Record<string, unknown>;
    const count = CIRCUIT_LENGTH.get(String(fields.circuit));
    if (
      Object.keys(fields).sort().join(',') !== 'accountAddress,args,circuit' ||
      typeof fields.accountAddress !== 'string' ||
      !HEX32.test(fields.accountAddress) ||
      count === undefined ||
      !Array.isArray(fields.args) ||
      fields.args.length !== count
    )
      throw new HttpError(400, 'invalid value call');
    if (!deployedAddresses(config.deploymentsFile, config.networkId).has(fields.accountAddress))
      throw new HttpError(403, 'value call account is not eligible');
    const args = fields.args.map((value) => decodeValueArg(value));
    const color = args[0];
    const amount = args[1];
    const recipient = args[2];
    const asset =
      color instanceof Uint8Array &&
      config.assets.find((candidate) => candidate.color === Buffer.from(color).toString('hex'));
    if (
      !(color instanceof Uint8Array) ||
      color.length !== 32 ||
      typeof amount !== 'bigint' ||
      amount < 1n ||
      !asset ||
      amount > asset.maxPerRequest ||
      !recipient ||
      typeof recipient !== 'object' ||
      !('bytes' in recipient) ||
      !(recipient.bytes instanceof Uint8Array) ||
      recipient.bytes.length !== 32
    )
      throw new HttpError(400, 'value call exceeds demo asset policy');
    const result = await runExclusive(async () => {
      const service = process.env.PASSPORT_SERVICE_URL ?? 'http://127.0.0.1:8787';
      const chain = createMidnightChain({
        network: {
          networkId: config.networkId,
          bindingId: config.bindingId,
          manifestSha256: config.manifestSha256,
          indexerUrl: config.indexerUri,
          indexerWsUrl: config.indexerWsUri,
          nodeUrl: config.nodeUri,
          artefactUrl: `${service}/v1/zk/${config.bindingId}`,
        },
        binding: { Contract, ledger, pureCircuits },
        prover: remoteV1Prover(service),
        ...createMidnightWalletPorts(
          wallet.providers.walletProvider,
          wallet.providers.midnightProvider,
        ),
      });
      const account = await chain.readAccount(fields.accountAddress as string);
      if (!account?.booted || account.specVersion !== 3)
        throw new HttpError(409, 'ACC is not active under the pinned binding');
      return chain.call({
        address: fields.accountAddress as string,
        circuit: fields.circuit as string,
        args,
      });
    });
    json(res, 200, result);
    return true;
  };
}
