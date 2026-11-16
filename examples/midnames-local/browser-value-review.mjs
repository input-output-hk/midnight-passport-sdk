import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const app = new URL('../../apps/passport-dapp/package.json', import.meta.url);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );

function reviewPage(spec, challenge) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(spec.title)}</title><style>body{font:16px system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;color:#17212d}h1{line-height:1.2}dl{display:grid;grid-template-columns:minmax(9rem,13rem) minmax(0,1fr);gap:.6rem 1rem}dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}button{font:inherit;padding:.7rem 1.1rem;margin:1rem .6rem 0 0}p{line-height:1.5}@media(max-width:550px){dl{display:block}dt{margin-top:1rem}}</style></head><body><main><h1>${escape(spec.title)}</h1><p>${escape(spec.description)}</p><dl>${spec.rows.map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('')}</dl><form method="post" action="/decision"><input type="hidden" name="challenge" value="${challenge}"><button type="submit" name="decision" value="approve" id="approve">${escape(spec.approveLabel)}</button><button type="submit" name="decision" value="decline" id="decline">Decline</button></form></main></body></html>`;
}

/** A localhost review page that receives only the public intent. */
async function reviewInBrowser(spec, output, automation) {
  assert.ok(automation === undefined || automation === 'approve' || automation === 'decline');
  const challenge = randomBytes(24).toString('hex');
  const html = reviewPage(spec, challenge);
  let resolveDecision;
  const decision = new Promise((resolve) => {
    resolveDecision = resolve;
  });
  let answered = false;
  let origin;
  const server = createServer((request, response) => {
    const headers = {
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
    };
    if (!origin || request.headers.host !== new URL(origin).host || answered) {
      response.writeHead(403, headers).end();
      return;
    }
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' }).end(html);
      return;
    }
    if (
      request.method !== 'POST' ||
      request.url !== '/decision' ||
      request.headers.origin !== origin ||
      request.headers['sec-fetch-site'] !== 'same-origin' ||
      !request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')
    ) {
      response.writeHead(403, headers).end();
      return;
    }
    void (async () => {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 512) throw new Error('Review decision too large.');
      }
      const fields = new URLSearchParams(body);
      const action = fields.get('decision');
      if (
        fields.size !== 2 ||
        fields.get('challenge') !== challenge ||
        (action !== 'approve' && action !== 'decline')
      )
        throw new Error('Review decision differs from the displayed page.');
      answered = true;
      response.writeHead(200, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(action === 'approve' ? 'Deposit approved.' : 'Deposit declined.');
      resolveDecision(action === 'approve');
    })().catch(() => response.writeHead(403, headers).end());
  });
  let browser;
  const timeout = new AbortController();
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
    const { chromium } = await import(import.meta.resolve('playwright-core', app.href));
    browser = await chromium.launch({
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: automation !== undefined,
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const displayed = await page.locator('main').innerText();
    for (const [, value] of spec.rows)
      assert.ok(displayed.includes(value), 'Exact value intent was not displayed.');
    assert.equal(answered, false, 'Browser review answered before approval.');
    await page.screenshot({ path: output });
    if (automation) await page.locator('#' + automation).click();
    const approved = await Promise.race([
      decision,
      delay(120_000, undefined, { signal: timeout.signal }).then(() => false),
      page.waitForEvent('close', { timeout: 0 }).then(() => false),
    ]);
    assert.deepEqual(errors, []);
    return { approved, displayed: true, mode: automation ? 'automated' : 'manual' };
  } finally {
    timeout.abort();
    await browser?.close();
    if (server.listening) {
      server.close();
      server.closeAllConnections();
      await once(server, 'close');
    }
  }
}

/** A sender-owned deposit review; the recipient's private state never enters it. */
export function reviewNamedDepositInBrowser(intent, output, automation) {
  assert.match(intent.registryAddress, /^[a-f0-9]{64}$/);
  assert.match(intent.accountAddress, /^[a-f0-9]{64}$/);
  assert.match(intent.color, /^[a-f0-9]{64}$/);
  assert.match(intent.amount, /^[1-9][0-9]*$/);
  return reviewInBrowser(
    {
      title: 'Review named ACC deposit',
      description:
        'Approve only if the resolved account and amount match your intent. The sender will check the name and ACC again before dispatch.',
      approveLabel: 'Approve deposit',
      rows: [
        ['Name', intent.name],
        ['Network', intent.networkId],
        ['Registry', intent.registryAddress],
        ['Provider', intent.providerId],
        ['Namespace', intent.namespace],
        ['Resolved Passport ACC', intent.accountAddress],
        ['Operation', 'deposit_shielded'],
        ['Asset', 'shielded token'],
        ['Asset color', intent.color],
        ['Amount', intent.amount],
      ],
    },
    output,
    automation,
  );
}

/** Owner review of the exact two-leg NIGHT route before any owner signature. */
export function reviewNamedNightSendInBrowser(intent, registryAddress, output, automation) {
  for (const address of [registryAddress, intent.source, intent.target, intent.bridge])
    assert.match(address, /^[a-f0-9]{64}$/);
  assert.equal(intent.providerId, `midnames:${registryAddress}`);
  assert.equal(intent.networkId, 'undeployed');
  assert.equal(intent.asset, 'NIGHT');
  assert.match(intent.amount, /^[1-9][0-9]*$/);
  assert.deepEqual(intent.operations, ['withdraw_unshielded_with_jubjub', 'deposit_unshielded']);
  return reviewInBrowser(
    {
      title: 'Review named ACC NIGHT payment',
      description:
        'The owner withdraws NIGHT to the controlled bridge wallet, then deposits that exact output into the named ACC. These transactions settle separately; an interrupted deposit needs original-intent recovery.',
      approveLabel: 'Approve both operations',
      rows: [
        ['Name', intent.name],
        ['Network', intent.networkId],
        ['Registry', registryAddress],
        ['Provider', intent.providerId],
        ['Namespace', intent.namespace],
        ['Source Passport ACC', intent.source],
        ['Resolved recipient ACC', intent.target],
        ['Bridge wallet', intent.bridge],
        ['First operation', intent.operations[0]],
        ['Second operation', intent.operations[1]],
        ['Asset', intent.asset],
        ['Amount (smallest NIGHT units)', intent.amount],
      ],
    },
    output,
    automation,
  );
}
