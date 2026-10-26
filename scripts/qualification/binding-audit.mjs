import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const PINNED_ACC_REVISION = '6458ed5fe6a4843912328bbf11112b97e33abf45';
export const REVIEWED_ACC_REVISION = 'cd346383c89b9ac3b328122b0053d66a2ce6215e';
const FILES = ['account.compact', 'account-p256.compact', 'webauthn.compact'];
/** @param {string | Uint8Array} value */
const digest = (value) => createHash('sha256').update(value).digest('hex');

/** Remove comments while preserving quoted messages, including escaped quote characters.
 * @param {string} source
 */
export function executableSource(source) {
  let output = '',
    state = 'code';
  for (let i = 0; i < source.length; i++) {
    const c = source[i],
      n = source[i + 1];
    if (state === 'string') {
      output += c;
      if (c === '\\') output += source[++i] ?? '';
      else if (c === '"') state = 'code';
    } else if (state === 'line') {
      if (c === '\n') {
        output += '\n';
        state = 'code';
      }
    } else if (state === 'block') {
      if (c === '*' && n === '/') {
        output += ' ';
        state = 'code';
        i++;
      }
    } else if (c === '"') {
      output += c;
      state = 'string';
    } else if (c === '/' && n === '/') {
      state = 'line';
      i++;
    } else if (c === '/' && n === '*') {
      state = 'block';
      i++;
    } else output += c;
  }
  if (state === 'block' || state === 'string') throw new Error('unterminated source token');
  return output.trim();
}

/** Conservative declaration comparison, not a semantic ABI/codec proof.
 * @param {string} source
 */
export function sourceSurface(source) {
  const code = executableSource(source);
  const normal = (/** @type {string} */ text) => text.replace(/\s+/g, ' ').trim();
  return {
    circuits: [
      ...code.matchAll(/export\s+(?:pure\s+)?circuit\s+\w+\s*\([\s\S]*?\)\s*:\s*[^{}]+(?=\{)/g),
    ]
      .map((m) => normal(m[0]))
      .sort(),
    ledger: [...code.matchAll(/export\s+ledger\s+[^;]+;/g)].map((m) => normal(m[0])).sort(),
    structs: [...code.matchAll(/export\s+struct\s+\w+\s*\{[^}]+\}/g)]
      .map((m) => normal(m[0]))
      .sort(),
  };
}

/**
 * Read exact public source objects without changing the upstream checkout.
 * @param {{repository: string, pinned?: string, reviewed?: string}} options
 */
export function auditBindingSources({
  repository,
  pinned = PINNED_ACC_REVISION,
  reviewed = REVIEWED_ACC_REVISION,
}) {
  for (const rev of [pinned, reviewed]) {
    if (!/^[a-f0-9]{40}$/.test(rev)) throw new Error('source audit requires full commit IDs');
    const actual = execFileSync('git', ['-C', repository, 'rev-parse', `${rev}^{commit}`], {
      encoding: 'utf8',
    }).trim();
    if (actual !== rev) throw new Error('source revision did not resolve exactly');
  }
  const files = FILES.map((name) => {
    const path = `contract/contracts/${name}`;
    const before = execFileSync('git', ['-C', repository, 'show', `${pinned}:${path}`], {
      encoding: 'utf8',
    });
    const after = execFileSync('git', ['-C', repository, 'show', `${reviewed}:${path}`], {
      encoding: 'utf8',
    });
    return {
      path,
      pinnedSha256: digest(before),
      reviewedSha256: digest(after),
      sourceChanged: before !== after,
      executableChanged: executableSource(before) !== executableSource(after),
      declarationSurfaceEqual:
        JSON.stringify(sourceSurface(before)) === JSON.stringify(sourceSurface(after)),
      pinnedDeviceSetReset: executableSource(before).includes('devices.resetToDefault();'),
      reviewedDeviceSetReset: executableSource(after).includes('devices.resetToDefault();'),
    };
  });
  return {
    schemaVersion: 1,
    evidenceKind: 'source-comparison',
    pinnedRevision: pinned,
    reviewedRevision: reviewed,
    files,
    declarationsEqual: files.every((f) => f.declarationSurfaceEqual),
    executableChanges: files.filter((f) => f.executableChanged).map((f) => f.path),
    limits: [
      'Declaration comparison is not binary ABI, codec or proof compatibility.',
      'Source changes do not update any deployed account or registered binding.',
      'Fresh key generation, proof/node validation and verifier wave sizing are separate gates.',
    ],
  };
}
