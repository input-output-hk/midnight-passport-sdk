// Local verification only: no tag creation/push, global ownertrust or credentials mutation.
import assert from 'node:assert/strict';
import { command } from './process.mjs';

/** @typedef {{checkout:string,tag:string,source:string,signer:string}} SignedTag */
/** @param {string} raw @param {string} signer */
export function assertSigner(raw, signer) {
  assert.match(signer, /^[A-F0-9]{40}$/);
  const valid = [...raw.matchAll(/^\[GNUPG:\] VALIDSIG ([A-F0-9]{40}) .+$/gm)];
  assert.ok(
    valid.some((match) => match[1] === signer || match[0].endsWith(' ' + signer)),
    'Unexpected GPG signing fingerprint',
  );
  assert.ok(
    !/\[GNUPG:\] (?:BADSIG|ERRSIG|REVKEYSIG|EXPKEYSIG|EXPSIG)\b/.test(raw),
    'Invalid GPG signature status',
  );
}
/** @param {SignedTag} pin */
export function verifySignedTag(pin) {
  const git = (/** @type {string[]} */ args) => command('git', args, { cwd: pin.checkout });
  assert.equal(
    git(['cat-file', '-t', `refs/tags/${pin.tag}`]).stdout.trim(),
    'tag',
    'Annotated tag required',
  );
  assert.equal(git(['rev-parse', `refs/tags/${pin.tag}^{commit}`]).stdout.trim(), pin.source);
  const result = git(['verify-tag', '--raw', `refs/tags/${pin.tag}`]);
  assertSigner(result.stderr, pin.signer);
  const body = git(['for-each-ref', '--format=%(contents)', `refs/tags/${pin.tag}`]).stdout;
  assert.match(body, /^Signed-off-by: .+ <[^>\r\n]+>$/m, 'Tag lacks DCO');
  const commit = git(['verify-commit', '--raw', pin.source]);
  assertSigner(commit.stderr, pin.signer);
  assert.match(
    git(['show', '-s', '--format=%B', pin.source]).stdout,
    /^Signed-off-by: .+ <[^>\r\n]+>$/m,
    'Source commit lacks DCO',
  );
  return {
    tag: pin.tag,
    source: pin.source,
    signer: pin.signer,
    signatureVerified: true,
    dco: true,
  };
}
