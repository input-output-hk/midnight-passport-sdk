import { readFileSync } from 'node:fs';
import type { ServiceConfig } from '../config.ts';
import { DeploymentLog, sponsoredAddresses } from '../deployments.ts';
import { HttpError, json, readJson, type Route } from '../http.ts';

const ADDRESS = /^[0-9a-f]{64}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DECIMAL = /^[1-9][0-9]*$/;
const TX_ID = /^(?:[0-9a-f]{64}|[0-9a-f]{66})$/;

interface DemoAsset {
  readonly color: string;
  readonly amount: string;
}

function demoAsset(file: string): DemoAsset {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const first = Array.isArray(parsed)
    ? (parsed[0] as Record<string, unknown> | undefined)
    : undefined;
  if (
    !first ||
    typeof first.color !== 'string' ||
    !ADDRESS.test(first.color) ||
    first.color === '00'.repeat(32) ||
    typeof first.maxPerRequest !== 'string' ||
    !DECIMAL.test(first.maxPerRequest)
  ) {
    throw new Error('demo funding needs a valid non-NIGHT asset policy');
  }
  const limit = BigInt(first.maxPerRequest);
  return { color: first.color, amount: (limit < 10n ? limit : 10n).toString() };
}

/** A localnet-only browser seam. The funding wallet and bearer token stay in their own process. */
export function demoFundingRoute(config: ServiceConfig, env: NodeJS.ProcessEnv): Route | undefined {
  if (env.PASSPORT_DEMO_FUNDING_ENABLED !== '1') return undefined;
  if (
    config.networkId !== 'undeployed' ||
    !['127.0.0.1', 'localhost', '::1'].includes(config.host) ||
    config.corsOrigin !== 'http://localhost:5173'
  ) {
    throw new Error('demo funding is allowed only on the loopback undeployed demo');
  }
  const url = new URL(env.PASSPORT_FUNDING_URL ?? 'http://127.0.0.1:8789');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('demo funding backend must use loopback HTTP');
  const tokenFile = env.PASSPORT_FUNDING_TOKEN_FILE;
  const assetsFile = env.PASSPORT_FUNDING_ASSETS_FILE;
  if (!tokenFile || !assetsFile) throw new Error('demo funding needs token and asset policy files');
  const token = readFileSync(tokenFile, 'utf8').trim();
  if (token.length < 32) throw new Error('demo funding token is invalid');
  const asset = demoAsset(assetsFile);
  const deployments = new DeploymentLog(config);

  const checkedBackend = async (): Promise<void> => {
    const health = await fetch(new URL('/healthz', url), { signal: AbortSignal.timeout(5000) });
    if (!health.ok) throw new HttpError(503, 'funding service is unavailable');
    const identity = (await health.json()) as Record<string, unknown>;
    if (
      identity.networkId !== config.networkId ||
      identity.bindingId !== config.bindingId ||
      identity.manifestSha256 !== config.manifestSha256
    ) {
      throw new HttpError(503, 'funding service binding differs from the demo');
    }
  };

  return async (req, res, requestUrl) => {
    if (requestUrl.pathname !== '/v1/demo/funding') return false;
    if (req.method === 'GET') {
      const address = requestUrl.searchParams.get('accountAddress');
      if (address !== null) {
        if (!ADDRESS.test(address) || !sponsoredAddresses(config, deployments).has(address))
          throw new HttpError(403, 'account is not registered and deployed by this demo');
        await checkedBackend();
        const balanceUrl = new URL('/v1/faucet/balances', url);
        balanceUrl.searchParams.set('accountAddress', address);
        const response = await fetch(balanceUrl, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new HttpError(503, 'ACC balance read unavailable');
        const body = (await response.json()) as Record<string, unknown>;
        if (
          body.accountAddress !== address ||
          body.color !== asset.color ||
          typeof body.night !== 'string' ||
          !/^\d+$/.test(body.night) ||
          typeof body.fundedAsset !== 'string' ||
          !/^\d+$/.test(body.fundedAsset)
        ) {
          throw new HttpError(502, 'funding service returned invalid ACC balances');
        }
        json(res, 200, {
          asset,
          accountAddress: address,
          balances: { night: body.night, fundedAsset: body.fundedAsset },
        });
        return true;
      }
      json(res, 200, { asset });
      return true;
    }
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method not allowed' });
      return true;
    }
    if (req.headers.origin !== config.corsOrigin)
      throw new HttpError(403, 'demo funding requires the Passport demo origin');
    const body = await readJson(req, 512);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new HttpError(400, 'invalid funding request');
    const fields = body as Record<string, unknown>;
    if (
      Object.keys(fields).sort().join(',') !== 'accountAddress,requestId' ||
      typeof fields.accountAddress !== 'string' ||
      !ADDRESS.test(fields.accountAddress) ||
      typeof fields.requestId !== 'string' ||
      !REQUEST_ID.test(fields.requestId)
    ) {
      throw new HttpError(400, 'invalid funding request');
    }
    if (!sponsoredAddresses(config, deployments).has(fields.accountAddress))
      throw new HttpError(403, 'account is not registered and deployed by this demo');

    await checkedBackend();
    const response = await fetch(new URL('/v1/faucet/fund', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        requestId: fields.requestId,
        networkId: config.networkId,
        bindingId: config.bindingId,
        manifestSha256: config.manifestSha256,
        accountAddress: fields.accountAddress,
        color: asset.color,
        amount: asset.amount,
      }),
    });
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const message = typeof result.error === 'string' ? result.error : 'funding was refused';
      throw new HttpError(response.status, message);
    }
    if (
      result.requestId !== fields.requestId ||
      typeof result.txId !== 'string' ||
      !TX_ID.test(result.txId) ||
      typeof result.creditedBalance !== 'string' ||
      !/^\d+$/.test(result.creditedBalance)
    ) {
      throw new HttpError(502, 'funding service returned an invalid confirmation');
    }
    json(res, 200, {
      requestId: fields.requestId,
      accountAddress: fields.accountAddress,
      color: asset.color,
      amount: asset.amount,
      txId: result.txId,
      creditedBalance: result.creditedBalance,
    });
    return true;
  };
}
