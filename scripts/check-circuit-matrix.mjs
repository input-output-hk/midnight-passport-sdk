#!/usr/bin/env node
// Generate or verify the release binding's complete circuit capability inventory.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import prettier from 'prettier';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const binding = 'acc-s3r1.1';
const manifest = JSON.parse(
  readFileSync(resolve(root, `packages/contract/resources/${binding}.key-manifest.json`), 'utf8'),
);
const declarations = readFileSync(
  resolve(root, `packages/contract/generated/${binding}/index.d.ts`),
  'utf8',
);
const profileSource = readFileSync(
  resolve(root, 'apps/passport-key-service/src/profiles.mjs'),
  'utf8',
);
const destination = resolve(root, 'docs/site/circuits.md');
const source = ts.createSourceFile('index.d.ts', declarations, ts.ScriptTarget.Latest, true);

/** @param {string} typeName */
function methods(typeName) {
  const alias = source.statements.find(
    (statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName,
  );
  if (!alias || !ts.isTypeAliasDeclaration(alias) || !ts.isTypeLiteralNode(alias.type))
    throw new Error(`missing generated ${typeName} type`);
  return new Map(
    alias.type.members.map((member) => {
      if (!ts.isMethodSignature(member) || !ts.isIdentifier(member.name))
        throw new Error(`unexpected ${typeName} member`);
      const inputs = member.parameters
        .filter((parameter) => parameter.name.getText(source) !== 'context')
        .map((parameter) => {
          const type = parameter.type?.getText(source).replace(/\s+/g, ' ') ?? 'unknown';
          return `${parameter.name.getText(source)}: ${type.replaceAll('__compactRuntime.', '')}`;
        });
      return [member.name.text, inputs];
    }),
  );
}

const provable = methods('ProvableCircuits');
const pure = methods('PureCircuits');
const witnesses = methods('Witnesses');
const pinned = Object.keys(manifest.circuits).sort();
if (pinned.length !== 52 || provable.size < pinned.length)
  throw new Error('the pinned proof-circuit roster changed');
if (witnesses.size !== 1 || !witnesses.has('held_coin'))
  throw new Error('the ACC witness roster changed');
for (const name of provable.keys()) {
  if (!pure.has(name) && !pinned.includes(name))
    throw new Error(`generated proving circuit lacks manifest entry: ${name}`);
}
for (const name of pinned) {
  if (!provable.has(name)) throw new Error(`manifest circuit lacks generated declaration: ${name}`);
  for (const part of ['zkir', 'bzkir', 'prover', 'verifier']) {
    if (!/^[a-f0-9]{64}$/.test(manifest.circuits[name]?.[part]?.sha256 ?? ''))
      throw new Error(`missing pinned ${part} hash for ${name}`);
  }
}
const profile = [...profileSource.matchAll(/^  '([a-z0-9_]+)',?$/gm)].map(
  (match) => match[1] ?? '',
);
if (profile.length !== 10 || profile.some((name) => !pinned.includes(name)))
  throw new Error('the JubJub key profile is not a pinned ten-circuit subset');

/** @param {string} name */
function scheme(name) {
  if (/_with_jubjub$|_grant_jubjub$/.test(name)) return 'JubJub';
  if (/_with_p256$|_grant_p256$|^webauthn_/.test(name)) return 'P-256';
  if (/_with_k256$|_grant_k256$/.test(name)) return 'k256';
  return 'common';
}
/** @param {string} name @param {boolean} isPure @returns {[string, string, string]} */
function policy(name, isPure) {
  if (isPure && !name.startsWith('challenge_')) return ['local helper', 'none', 'contract'];
  if (name === 'deposit_shielded') return ['sender wallet', 'sender', 'account/sender'];
  if (name.startsWith('deposit_')) return ['sender wallet', 'sender', 'funding service'];
  if (/^recover_submit$|^recover_finalise$|^challenge_recover_submit$/.test(name))
    return ['recovery proof', 'recovery provider', 'account/recovery'];
  if (name.startsWith('activate_initial_device_')) return ['boot commitment', 'owner', 'account'];
  if (name.includes('_with_grant_')) return ['grant bearer', 'grantee', 'account/grants'];
  if (name.startsWith('recover_') || name.includes('_recovery_'))
    return ['owner signature', 'owner', 'account/recovery'];
  return ['owner signature', 'owner', 'account'];
}
/** @param {string} name @param {boolean} isPure @returns {[string, string]} */
function evidence(name, isPure) {
  if (name === 'deposit_shielded')
    return ['sender port', 'tests/account-shielded-deposit.test.mjs'];
  if (/^(issue_grant_with_jubjub|challenge_issue_grant_with_jubjub)$/.test(name))
    return ['typed flow', 'tests/account-jubjub.test.mjs'];
  if (/^(revoke_grant_with_jubjub|challenge_revoke_grant_with_jubjub)$/.test(name))
    return ['typed flow', 'tests/account-jubjub-grant-revoke.test.mjs'];
  if (/^(revoke_all_grants_with_jubjub|challenge_revoke_all_grants_with_jubjub)$/.test(name))
    return ['typed flow', 'tests/account-jubjub-grant-revoke-all.test.mjs'];
  if (/^(revoke_all_grants_with_p256|challenge_revoke_all_grants_with_p256)$/.test(name))
    return ['typed flow', 'tests/account-p256-grant-revoke-all.test.mjs'];
  if (/^(revoke_grant_with_p256|challenge_revoke_grant_with_p256)$/.test(name))
    return ['typed flow', 'tests/account-p256-grant-revoke-all.test.mjs'];
  if (/^(issue_grant_with_p256|challenge_issue_grant_with_p256)$/.test(name))
    return ['typed flow', 'tests/account-p256-grant-issue.test.mjs'];
  if (/^(append_inbox_with_p256|challenge_append_inbox_with_p256)$/.test(name))
    return ['typed flow', 'tests/account-p256-grant-publication.test.mjs'];
  if (
    /^(add_device_with_p256|challenge_add_device_with_p256|remove_device_with_p256|challenge_remove_device_with_p256)$/.test(
      name,
    )
  )
    return ['typed flow', 'tests/account-p256-sealed.test.mjs'];
  if (/^(remove_device_with_jubjub|challenge_remove_device_with_jubjub)$/.test(name))
    return ['typed flow', 'tests/account-jubjub.test.mjs'];
  if (
    /^(derive_grant_id_with_jubjub|derive_grant_object_commit|derive_grant_scope_digest)$/.test(
      name,
    )
  )
    return ['scope helper', 'tests/account-grant-scope.test.mjs'];
  if (/^(add_device_with_jubjub|challenge_add_device_with_jubjub)$/.test(name))
    return ['typed flow', 'tests/account-jubjub-device.test.mjs'];
  if (
    /^(activate_initial_device_with_p256|rotate_enc_key_with_p256|derive_boot_commitment_with_p256|derive_device_entry_with_p256|challenge_rotate_enc_key_with_p256)$/.test(
      name,
    )
  )
    return ['typed flow', 'tests/account-connector.test.mjs'];
  if (
    /^(activate_initial_device_with_jubjub|append_inbox_with_jubjub|rotate_enc_key_with_jubjub|derive_boot_commitment_with_jubjub|derive_device_entry_with_jubjub|challenge_append_inbox_with_jubjub|challenge_rotate_enc_key_with_jubjub)$/.test(
      name,
    )
  )
    return ['typed flow', 'tests/account-jubjub.test.mjs'];
  if (/^(compute_public_point_with_jubjub|derive_device_entry_with_jubjub)$/.test(name))
    return ['key helper', 'tests/keys-jubjub.test.mjs'];
  if (name === 'deposit_unshielded')
    return ['service flow', 'tests/service-wallet-funding-backend.test.mjs'];
  return [isPure ? 'binding only' : 'artifact only', '—'];
}
/** @param {string} value */
const cell = (value) => value.replaceAll('|', '\\|').replaceAll('\n', ' ');

const rows = [
  '| Circuit | Kind | Scheme | Inputs (generated types) | Witness | Authority | Consent | Keys | Flow owner | Status | Test evidence |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];
/** @type {Array<{name: string, isPure: boolean, inputs: string[]}>} */
const inventory = [];
for (const name of pinned) {
  const inputs = provable.get(name);
  if (!inputs) throw new Error(`missing inputs for ${name}`);
  inventory.push({ name, isPure: false, inputs });
}
for (const [name, inputs] of [...pure.entries()].sort(([left], [right]) =>
  left.localeCompare(right),
))
  inventory.push({ name, isPure: true, inputs });
for (const { name, isPure, inputs } of inventory) {
  const [authority, consent, owner] = policy(name, isPure);
  const [status, test] = evidence(name, isPure);
  if (test !== '—' && !existsSync(resolve(root, test)))
    throw new Error(`missing circuit evidence for ${name}: ${test}`);
  const witness = !isPure && name.includes('withdraw_shielded') ? 'held_coin' : '—';
  const keys = isPure ? 'inline' : profile.includes(name) ? 'all + jubjub-owner-v1' : 'all';
  rows.push(
    `| \`${name}\` | ${isPure ? 'pure' : 'proof'} | ${scheme(name)} | ${cell(inputs.join(', ') || '—')} | ${witness} | ${authority} | ${consent} | ${keys} | ${owner} | ${status} | ${test} |`,
  );
}

const raw = `---
layout: default
title: ACC circuit capabilities
permalink: /circuits/
---

# ACC circuit capabilities

Generated from the pinned \`${binding}\` binding (manifest SHA-256 \`${manifest.compilerManifestSha256}\`). The generated TypeScript declarations supply the exact argument names and types. Every one of the ${pinned.length} proof circuits and ${pure.size} pure helpers appears below. The \`held_coin\` witness is required by shielded withdrawal paths; other circuit inputs are shown directly in the generated signature.

**Status:** \`typed flow\` means the account package has a tested typed call path for this circuit; \`service flow\` means the standalone funding service has a tested call path; \`sender port\` means the account package seals and confirms a deposit but the host must supply a value-bearing sender wallet that proves and submits it; \`key helper\` means the portable key recipe tests the pure helper. \`artifact only\` and \`binding only\` mean the bytes or callable generated helper are packaged, with no typed account flow yet. The funding service completed a local node-backed non-native unshielded deposit. The shielded sender port completed a local node-backed non-native deposit using the pinned upstream wallet; the funding service does not expose that path yet. These labels are release limits, not claims that all 52 circuits are ready for applications. The key service's \`all\` profile serves every proof circuit; \`jubjub-owner-v1\` serves the marked subset.

${rows.join('\n')}
`;
const expected = await prettier.format(raw, { filepath: destination });
if (process.argv.includes('--write')) {
  writeFileSync(destination, expected);
  console.log(`wrote ${pinned.length} proof and ${pure.size} pure circuit rows`);
} else if (readFileSync(destination, 'utf8') !== expected) {
  throw new Error('ACC capability matrix is stale; run check-circuit-matrix.mjs --write');
} else {
  console.log(`ACC capability matrix covers ${pinned.length} proof and ${pure.size} pure circuits`);
}
