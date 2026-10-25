import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SCENARIOS, SUITES } from './catalog.mjs';

/** @param {string | Uint8Array} bytes */
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** Compiled JS is ignored by Git but is executed by qualification tests. Never omit it.
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function qualificationRuntimeFiles(root) {
  /** @type {string[]} */ const found = [];
  /** @param {string} relative */
  const walk = async (relative) => {
    let entries;
    try {
      const directory = await lstat(join(root, relative));
      if (directory.isSymbolicLink() || !directory.isDirectory())
        throw new Error('Compiled qualification inputs must not be symlinks.');
      entries = await readdir(join(root, relative), { withFileTypes: true });
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const name = relative + '/' + entry.name;
      if (entry.isSymbolicLink())
        throw new Error('Compiled qualification inputs must not be symlinks.');
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) found.push(name);
    }
  };
  let packages;
  try {
    packages = await readdir(join(root, 'packages'), { withFileTypes: true });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return [];
    throw error;
  }
  for (const entry of packages) {
    if (entry.isSymbolicLink())
      throw new Error('Compiled package directories must not be symlinks.');
    if (entry.isDirectory()) await walk('packages/' + entry.name + '/dist');
  }
  return found.sort();
}
/** @param {string} root */
export async function workspaceIdentity(root) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const changed = execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const names = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8' },
  );
  const hash = createHash('sha256');
  let fileCount = 0;
  // Include current bytes, including new uncommitted code. Deleted files get an explicit marker.
  for (const name of [
    ...new Set([...names.split('\0').filter(Boolean), ...(await qualificationRuntimeFiles(root))]),
  ].sort()) {
    let fileHash;
    try {
      fileHash = sha256(await readFile(join(root, name)));
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
      fileHash = 'deleted';
    }
    hash.update(`${name}\0${fileHash}\n`);
    fileCount++;
  }
  return { commit, dirty: Boolean(changed), workspaceSha256: hash.digest('hex'), fileCount };
}

/** Only aggregate test counters and bounded output digests leave a subprocess.
 * @param {string} stdout
 */
export function tapSummary(stdout) {
  const last = (/** @type {string} */ name) => {
    const matches = [...stdout.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))];
    return matches.length ? Number(matches.at(-1)?.[1]) : undefined;
  };
  return Object.fromEntries(
    Object.entries({
      passed: last('pass'),
      failed: last('fail'),
      skipped: last('skipped'),
      cancelled: last('cancelled'),
    }).filter(([, value]) => value !== undefined),
  );
}

/** Validate the receipt's closed schema. Arbitrary child messages/metadata cannot be exported.
 * @param {unknown} value
 */
export function validateReceipt(value) {
  const r = /** @type {any} */ (value);
  const exact = (/** @type {any} */ object, /** @type {string[]} */ keys) => {
    if (
      !object ||
      typeof object !== 'object' ||
      Array.isArray(object) ||
      Object.keys(object).some((k) => !keys.includes(k))
    )
      throw new Error('receipt contains an unsupported field');
  };
  exact(r, [
    'schemaVersion',
    'runId',
    'suite',
    'startedAt',
    'source',
    'binding',
    'results',
    'allRequiredPassed',
    'releaseQualified',
  ]);
  if (
    r.schemaVersion !== 1 ||
    typeof r.runId !== 'string' ||
    typeof r.suite !== 'string' ||
    typeof r.startedAt !== 'string' ||
    !Object.hasOwn(SUITES, r.suite) ||
    !/^[a-f0-9-]{36}$/.test(r.runId) ||
    !/^[a-z-]+$/.test(r.suite) ||
    !Number.isFinite(Date.parse(r.startedAt))
  )
    throw new Error('invalid receipt identity');
  exact(r.source, ['commit', 'dirty', 'workspaceSha256', 'fileCount']);
  if (
    typeof r.source.commit !== 'string' ||
    typeof r.source.workspaceSha256 !== 'string' ||
    !/^[a-f0-9]{40}$/.test(r.source.commit) ||
    !/^[a-f0-9]{64}$/.test(r.source.workspaceSha256) ||
    typeof r.source.dirty !== 'boolean' ||
    !Number.isSafeInteger(r.source.fileCount) ||
    r.source.fileCount < 1
  )
    throw new Error('invalid source identity');
  exact(r.binding, ['id', 'compilerManifestSha256', 'moduleSha256']);
  if (
    r.binding.id !== 'acc-s3r1.1' ||
    ![r.binding.compilerManifestSha256, r.binding.moduleSha256].every(
      (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v),
    )
  )
    throw new Error('invalid binding identity');
  if (!Array.isArray(r.results) || !r.results.length || r.results.length > 32)
    throw new Error('invalid result inventory');
  const seen = new Set();
  for (const result of r.results) {
    exact(result, [
      'id',
      'tier',
      'outcome',
      'elapsedMs',
      'failureCode',
      'exitCode',
      'signal',
      'stdoutSha256',
      'stderrSha256',
      'outputBytes',
      'tests',
    ]);
    if (
      typeof result.id !== 'string' ||
      typeof result.tier !== 'string' ||
      !/^[a-z-]+$/.test(result.id) ||
      seen.has(result.id) ||
      !/^[a-z-]+$/.test(result.tier)
    )
      throw new Error('invalid result identity');
    seen.add(result.id);
    if (
      ![
        'passed',
        'passed-with-skips',
        'failed',
        'timed-out',
        'output-limit',
        'not-configured',
        'not-implemented',
      ].includes(result.outcome)
    )
      throw new Error('invalid outcome');
    if (!Number.isSafeInteger(result.elapsedMs) || result.elapsedMs < 0)
      throw new Error('invalid elapsed time');
    if (
      result.failureCode !== undefined &&
      ![
        'PROCESS_EXIT',
        'SPAWN_FAILED',
        'MISSING_INPUT',
        'UNSUPPORTED_NETWORK',
        'NOT_IMPLEMENTED',
        'TIME_LIMIT',
        'OUTPUT_LIMIT',
        'TEST_FAILURE',
        'NO_TESTS',
        'TEST_SKIP',
        'SOURCE_CHANGED',
      ].includes(result.failureCode)
    )
      throw new Error('unsafe error message');
    if (
      result.exitCode !== undefined &&
      result.exitCode !== null &&
      !Number.isInteger(result.exitCode)
    )
      throw new Error('invalid exit code');
    if (
      result.signal !== undefined &&
      result.signal !== null &&
      (typeof result.signal !== 'string' || !/^SIG[A-Z0-9]{1,12}$/.test(result.signal))
    )
      throw new Error('invalid signal');
    for (const key of ['stdoutSha256', 'stderrSha256'])
      if (
        result[key] !== undefined &&
        (typeof result[key] !== 'string' || !/^[a-f0-9]{64}$/.test(result[key]))
      )
        throw new Error('invalid output digest');
    if (
      result.outputBytes !== undefined &&
      (!Number.isSafeInteger(result.outputBytes) || result.outputBytes < 0)
    )
      throw new Error('invalid output count');
    if (
      result.outcome === 'passed' &&
      result.tests &&
      (result.tests.failed || result.tests.skipped || result.tests.cancelled)
    )
      throw new Error('passing outcome contradicts test counts');
    const testCommand = /** @type {Record<string,{command:readonly string[]}>} */ (SCENARIOS)[
      result.id
    ]?.command.includes('--test');
    if (result.outcome === 'passed' && testCommand && !(result.tests?.passed > 0))
      throw new Error('Declared test scenario requires positive passing test evidence.');
    if (result.tests) {
      exact(result.tests, ['passed', 'failed', 'skipped', 'cancelled']);
      for (const count of Object.values(result.tests))
        if (!Number.isSafeInteger(count) || Number(count) < 0)
          throw new Error('invalid test count');
    }
  }
  const declared = /** @type {Record<string,string[]>} */ (SUITES)[r.suite];
  const ids = r.results.map((/** @type {any} */ e) => e.id);
  const expectedIds = ids.includes('source-changed')
    ? [.../** @type {string[]} */ (declared), 'source-changed']
    : declared;
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds))
    throw new Error('result inventory differs from declared suite');
  for (const result of r.results) {
    const tier =
      result.id === 'source-changed'
        ? 'source-comparison'
        : /** @type {Record<string,{tier:string}>} */ (SCENARIOS)[result.id]?.tier;
    if (result.tier !== tier) throw new Error('result evidence tier differs from catalog');
  }
  if (
    typeof r.allRequiredPassed !== 'boolean' ||
    r.allRequiredPassed !== r.results.every((/** @type {any} */ e) => e.outcome === 'passed')
  )
    throw new Error('qualification summary contradicts results');
  // The foundation intentionally cannot certify a release. Required wider scenarios are still open.
  if (r.releaseQualified !== false)
    throw new Error('release qualification is unavailable in this foundation');
  if (Buffer.byteLength(JSON.stringify(r)) > 128 * 1024)
    throw new Error('receipt exceeds size limit');
  return r;
}

/** Never overwrite evidence from an uncertain earlier attempt.
 * @param {string} file @param {unknown} record
 */
export async function writeReceipt(file, record) {
  const safe = validateReceipt(record);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(safe, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

/** Fail before any service/proof action if the shipped module differs from its pin.
 * @param {string} root
 */
export async function verifyQualificationBinding(root) {
  const binding = JSON.parse(
    await readFile(join(root, 'packages/contract/acc-binding-v2.generated.json'), 'utf8'),
  );
  if (
    binding.id !== 'acc-s3r1.1' ||
    binding.source.revision !== '6458ed5fe6a4843912328bbf11112b97e33abf45' ||
    binding.manifestSha256 !== '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f' ||
    binding.module.js.sha256 !== '0ee002d3ac6eae8c048fbd9017ed2f1215e3961629f998221dd9b3e77d74bccf'
  )
    throw new Error('qualification binding pin mismatch');
  const module = await readFile(join(root, 'packages/contract/generated/acc-s3r1.1/index.js'));
  const types = await readFile(join(root, 'packages/contract/generated/acc-s3r1.1/index.d.ts'));
  if (sha256(module) !== binding.module.js.sha256 || sha256(types) !== binding.module.types.sha256)
    throw new Error('qualification artifact integrity failure');
  return {
    id: binding.id,
    compilerManifestSha256: binding.manifestSha256,
    moduleSha256: sha256(module),
  };
}

/** Three clean runs establish repeatability for their declared scope only.
 * @param {unknown[]} receipts
 */
export function qualifyRepeatedRuns(receipts) {
  if (receipts.length !== 3)
    throw new Error('exactly three chronological matching receipts are required');
  const records = receipts.map(validateReceipt);
  const first = records[0];
  const scope = (/** @type {any} */ record) =>
    JSON.stringify({
      suite: record.suite,
      source: record.source,
      binding: record.binding,
      scenarios: record.results.map((/** @type {any} */ r) => [r.id, r.tier]),
    });
  if (!first || records.some((r) => !r.allRequiredPassed || scope(r) !== scope(first)))
    throw new Error('repeat receipts differ in source/scope or include incomplete outcomes');
  if (new Set(records.map((r) => r.runId)).size !== 3)
    throw new Error('replayed receipt is not a new run');
  for (let i = 1; i < records.length; i++)
    if (Date.parse(records[i].startedAt) < Date.parse(records[i - 1].startedAt))
      throw new Error('receipts are not chronological');
  return {
    repeatable: true,
    runs: 3,
    omittedRunsAudited: false,
    suite: first.suite,
    workspaceSha256: first.source.workspaceSha256,
    releaseQualified: false,
  };
}
