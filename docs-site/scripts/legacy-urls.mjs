import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const source = join(root, 'docs/site');
const site = join(root, 'docs-site/.vitepress/dist');
const base =
  process.env.DOCS_BASE ?? (process.env.GITHUB_ACTIONS ? '/midnight-passport-sdk/' : '/');
if (!base.startsWith('/') || !base.endsWith('/'))
  throw new Error('DOCS_BASE must be an absolute slash-terminated path');
if (!existsSync(join(site, 'index.html'))) throw new Error('Build the VitePress site first');

const destinations = {
  '': '/',
  'getting-started': '/getting-started/',
  packages: '/packages/',
  architecture: '/architecture/',
  api: '/packages/api',
  'library-guide': '/getting-started/first-integration',
  'account-keys': '/architecture/keys-wallets',
  authorization: '/guides/authorization',
  consent: '/guides/authorization',
  'passkey-prompts': '/guides/authorization',
  'authenticated-owner': '/demo/signing-activity',
  'quick-actions': '/demo/signing-activity',
  'jubjub-sessions': '/guides/devices-grants',
  'grant-recovery': '/guides/devices-grants',
  'shielded-deposit-recovery': '/guides/assets',
  durability: '/guides/durability',
  'host-durability': '/guides/durability',
  background: '/guides/durability',
  'secret-storage': '/guides/durability',
  'partner-integration': '/architecture/standards',
  'consumer-integration': '/guides/hosts',
  'lace-handover': '/guides/hosts',
  'lace-wallet': '/guides/hosts',
  'react-example': '/guides/hosts',
  interaction: '/guides/hosts',
  names: '/guides/hosts',
  capabilities: '/packages/api',
  circuits: '/operations/artifacts',
  keys: '/operations/artifacts',
  service: '/operations/services',
  'service-jobs': '/operations/services',
  'demo-guide': '/demo/',
  'demo-ui': '/demo/signing-activity',
  'use-cases': '/demo/scenarios',
  problems: '/getting-started/',
  'use-case-coverage': '/operations/quality',
  qualification: '/operations/quality',
  quality: '/operations/quality',
  troubleshooting: '/operations/troubleshooting',
  releasing: '/operations/quality',
  handover: '/operations/archive',
  'live-qualification': '/operations/archive',
  'release-notes-rc4': '/operations/archive',
  'release-notes-rc5': '/operations/archive',
  'release-notes-rc6': '/operations/archive',
  'release-notes-rc7': '/operations/archive',
  'release-notes-rc8': '/operations/archive',
  'release-notes-rc9': '/operations/rc9-preview',
  'source-preview': '/operations/archive',
};

const escape = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const slug = (value) =>
  value
    .toLowerCase()
    .replace(/`[^`]*`/g, (match) => match.slice(1, -1))
    .replace(/<[^>]+>/g, '')
    .replace(/\[[^\]]+\]\([^)]*\)/g, (match) => match.slice(1, match.indexOf(']')))
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
const pages = [];
for (const name of readdirSync(source)
  .filter((value) => value.endsWith('.md'))
  .sort()) {
  const markdown = readFileSync(join(source, name), 'utf8');
  const permalink = /^permalink:[ \t]*\/([^/\r\n]*)\/?[ \t]*$/m.exec(markdown)?.[1];
  if (permalink === undefined) continue;
  if (!(permalink in destinations)) throw new Error(`Missing old URL migration: /${permalink}/`);
  const title = /^title:\s*(.+)$/m.exec(markdown)?.[1] ?? name;
  const anchors = new Map();
  const counts = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      const explicit = /\s*\{#([^}]+)\}\s*$/.exec(heading[1])?.[1];
      const label = heading[1].replace(/\s*\{#[^}]+\}\s*$/, '').trim();
      const baseId = explicit ?? slug(label);
      const count = counts.get(baseId) ?? 0;
      counts.set(baseId, count + 1);
      const id = count ? `${baseId}-${count}` : baseId;
      if (id) anchors.set(id, label);
    }
    for (const match of line.matchAll(/<(?:span|a)\s+id=["']([^"']+)["'][^>]*>/g))
      anchors.set(match[1], match[1].replaceAll('-', ' '));
  }
  pages.push({ permalink, title, target: destinations[permalink], anchors });
}

for (const { permalink, title, target, anchors } of pages) {
  const output = join(site, permalink, 'index.html');
  const url = base + target.replace(/^\//, '') + (target.endsWith('/') ? '' : '.html');
  const rows = [...anchors]
    .map(
      ([id, label]) =>
        `<li id="${escape(id)}"><a href="${escape(url)}">${escape(label)} → ${escape(target)}</a></li>`,
    )
    .join('\n');
  if (existsSync(output)) {
    // A new page owns this path. Preserve old fragment IDs without changing its primary content.
    const html = readFileSync(output, 'utf8');
    const missing = [...anchors].filter(([id]) => !html.includes(`id="${escape(id)}"`));
    const aliases = missing
      .map(
        ([id, label]) =>
          `<div class="legacy-alias" id="${escape(id)}"><a href="${escape(url)}">This earlier heading, “${escape(label)}”, moved to the current guide.</a></div>`,
      )
      .join('\n');
    if (aliases)
      writeFileSync(
        output,
        html.replace(
          '</body>',
          `<style>.legacy-alias{height:0;overflow:hidden}.legacy-alias:target{height:auto;padding:1rem;max-width:54rem;margin:1rem auto;border:1px solid #ccd4e4;border-radius:8px}</style>${aliases}</body>`,
        ),
      );
  } else {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(
      output,
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · moved · Midnight Passport SDK</title><style>body{font:16px/1.6 system-ui;max-width:52rem;margin:auto;padding:2rem;color:#17233b}a{color:#3156bf}li{padding:.35rem 0;scroll-margin-top:1rem}header{border-bottom:1px solid #ccd4e4}nav{margin-top:2rem}</style></head><body><header><a href="${escape(base)}">Midnight Passport SDK</a></header><main><h1>${escape(title)} moved</h1><p>This earlier URL is kept for existing links. The current guide is <a href="${escape(url)}">${escape(target)}</a>.</p><nav aria-label="Earlier page headings"><h2>Earlier headings</h2><ul>${rows}</ul></nav></main></body></html>`,
    );
  }
}

const migration = [
  '# Old page migration map',
  '',
  'Every earlier Jekyll permalink remains available in the built site. Earlier heading fragments land on a compatibility anchor linked to the new task guide.',
  '',
  '| Earlier URL | Current guide |',
  '| --- | --- |',
  ...pages.map(
    (page) => `| \`/${page.permalink ? page.permalink + '/' : ''}\` | \`${page.target}\` |`,
  ),
  '',
];
writeFileSync(join(root, 'docs-site/MIGRATION.md'), migration.join('\n'));
console.log(
  `Preserved ${pages.length} old URLs and ${pages.reduce((sum, page) => sum + page.anchors.size, 0)} earlier anchors`,
);
