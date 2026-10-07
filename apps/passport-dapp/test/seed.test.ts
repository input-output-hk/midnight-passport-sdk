// The built-in wallet's seed ceremony (src/wallet/seed.ts), beyond e2e/seed-policy.e2e.ts: what
// each prompt asks for in the pinned and in the discoverable case, how a dismissed or failing
// prompt reads, and that a PRF that is missing or half there never yields a seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { walletSeed } from '../src/wallet/seed.ts';

const ID = Uint8Array.of(1, 2, 3);
const OTHER = Uint8Array.of(9, 9, 9);

const sha256 = (data: BufferSource): ArrayBuffer =>
  new Uint8Array(
    createHash('sha256')
      .update(new Uint8Array(data as ArrayBuffer))
      .digest(),
  ).buffer;

type Answer = (options: CredentialRequestOptions, call: number) => unknown;

/** A CredentialsContainer whose `get` is `answer`, remembering each request it saw. */
function container(answer: Answer) {
  const gets: CredentialRequestOptions[] = [];
  const credentials = {
    async get(options?: CredentialRequestOptions) {
      gets.push(options ?? {});
      return answer(options ?? {}, gets.length);
    },
  } as unknown as CredentialsContainer;
  return { credentials, gets };
}

/** A credential answer: the id it names and what its extension results hold. */
const credential = (rawId: Uint8Array, results: Record<string, unknown> = {}) => ({
  rawId: rawId.slice().buffer,
  getClientExtensionResults: () => results,
});

/** The fixed PRF function of each salt, as a software authenticator would answer. */
const withPrf = (options: CredentialRequestOptions, rawId: Uint8Array = ID) => {
  const salts = options.publicKey?.extensions?.prf?.eval;
  return credential(
    rawId,
    salts
      ? { prf: { results: { first: sha256(salts.first), second: sha256(salts.second!) } } }
      : {},
  );
};

const ids = (options: CredentialRequestOptions | undefined) =>
  (options?.publicKey?.allowCredentials ?? []).map((c) => new Uint8Array(c.id as ArrayBuffer));

test('with an account open there is one prompt, pinned to its passkey, for the PRF, with user verification', async () => {
  const { credentials, gets } = container((o) => withPrf(o));
  const seed = await walletSeed({ rpId: 'localhost', accountCredentialId: ID, credentials });
  assert.equal(seed.length, 64);
  assert.equal(gets.length, 1);
  const publicKey = gets[0]!.publicKey!;
  assert.equal(publicKey.rpId, 'localhost');
  assert.equal(publicKey.userVerification, 'required');
  assert.deepEqual(ids(gets[0]), [ID]);
  assert.ok(publicKey.extensions?.prf?.eval?.first && publicKey.extensions.prf.eval.second);
});

test('without an account the picker comes first, asks for no PRF and pins nothing, then the PRF is pinned to the pick', async () => {
  const { credentials, gets } = container((o) => withPrf(o, OTHER));
  const seed = await walletSeed({ rpId: 'example.test', credentials });
  assert.equal(seed.length, 64);
  assert.equal(gets.length, 2);
  const picker = gets[0]!.publicKey!;
  assert.equal(picker.rpId, 'example.test');
  assert.equal(picker.userVerification, 'required');
  assert.equal(picker.allowCredentials, undefined, 'discoverable: the user chooses');
  assert.equal(picker.extensions, undefined);
  assert.deepEqual(ids(gets[1]), [OTHER], 'the PRF prompt names the passkey that was picked');
  assert.equal(gets[1]!.publicKey!.rpId, 'example.test');
});

test('an explicit undefined account id is the same as none: the user picks', async () => {
  const { credentials, gets } = container((o) => withPrf(o));
  await walletSeed({ rpId: 'localhost', accountCredentialId: undefined, credentials });
  assert.equal(gets.length, 2);
});

test('each prompt carries its own fresh 32-byte challenge', async () => {
  const { credentials, gets } = container((o) => withPrf(o));
  await walletSeed({ rpId: 'localhost', credentials });
  await walletSeed({ rpId: 'localhost', accountCredentialId: ID, credentials });
  const challenges = gets.map((g) =>
    Buffer.from(g.publicKey!.challenge as Uint8Array).toString('hex'),
  );
  assert.equal(challenges.length, 3);
  for (const c of challenges) assert.equal(c.length, 64);
  assert.equal(new Set(challenges).size, 3);
});

test('the seed is the same on every connect for the same passkey, and differs between passkeys', async () => {
  const same = container((o) => withPrf(o));
  const a = await walletSeed({
    rpId: 'localhost',
    accountCredentialId: ID,
    credentials: same.credentials,
  });
  const b = await walletSeed({ rpId: 'localhost', credentials: same.credentials });
  assert.deepEqual(a, b, 'pinned and discoverable agree for the same passkey');
  // Another passkey's PRF is another function of the salts.
  const other = container((o) => {
    const salts = o.publicKey?.extensions?.prf?.eval;
    return credential(ID, {
      prf: {
        results: {
          first: sha256(Uint8Array.of(0, ...new Uint8Array(salts!.first as ArrayBuffer))),
          second: sha256(Uint8Array.of(0, ...new Uint8Array(salts!.second as ArrayBuffer))),
        },
      },
    });
  });
  const c = await walletSeed({
    rpId: 'localhost',
    accountCredentialId: ID,
    credentials: other.credentials,
  });
  assert.notDeepEqual(a, c);
});

test('a dismissed picker is UserCancelled, whether it answers nothing or throws NotAllowedError or AbortError', async () => {
  for (const answer of [
    () => null,
    () => {
      throw Object.assign(new Error('dismissed'), { name: 'NotAllowedError' });
    },
    () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    },
  ] as Answer[]) {
    const { credentials, gets } = container(answer);
    await assert.rejects(walletSeed({ rpId: 'localhost', credentials }), {
      code: 'UserCancelled',
      type: 'PassportConnectorError',
    });
    assert.equal(gets.length, 1, 'no PRF prompt follows a dismissed picker');
  }
});

test('the picker failing for another reason is an InternalError that keeps its message and cause', async () => {
  const boom = Object.assign(new Error('RP ID is not valid for this origin'), {
    name: 'SecurityError',
  });
  const { credentials } = container(() => {
    throw boom;
  });
  await assert.rejects(walletSeed({ rpId: 'localhost', credentials }), (e) => {
    assert.equal((e as { code: string }).code, 'InternalError');
    assert.equal((e as Error).message, 'RP ID is not valid for this origin');
    assert.equal((e as Error).cause, boom);
    return true;
  });
});

test('a dismissed or failing PRF prompt is mapped the same way, and yields no seed', async () => {
  const dismissed = container((o) => {
    if (o.publicKey?.extensions?.prf) return null;
    return credential(ID);
  });
  await assert.rejects(walletSeed({ rpId: 'localhost', credentials: dismissed.credentials }), {
    code: 'UserCancelled',
  });
  const cancelled = container((o) => {
    if (o.publicKey?.extensions?.prf) {
      throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
    }
    return credential(ID);
  });
  await assert.rejects(
    walletSeed({ rpId: 'localhost', accountCredentialId: ID, credentials: cancelled.credentials }),
    { code: 'UserCancelled' },
  );
});

test('picking one passkey and then confirming with another is the wrong-passkey error, not a seed', async () => {
  const { credentials } = container((o) =>
    o.publicKey?.extensions?.prf ? withPrf(o, OTHER) : credential(ID),
  );
  await assert.rejects(walletSeed({ rpId: 'localhost', credentials }), {
    code: 'AccountNotFound',
    message: 'This is not the passkey this account was created with; choose that passkey.',
  });
});

test('a passkey with no PRF, or only half of it, is UnsupportedAuthenticator at either ceremony', async () => {
  const noPrf = container(() => credential(ID));
  const first = container((o) => {
    const salts = o.publicKey?.extensions?.prf?.eval;
    return credential(ID, salts ? { prf: { results: { first: sha256(salts.first) } } } : {});
  });
  const empty = container(() => credential(ID, { prf: { enabled: true } }));
  for (const { credentials } of [noPrf, first, empty]) {
    await assert.rejects(walletSeed({ rpId: 'localhost', accountCredentialId: ID, credentials }), {
      code: 'UnsupportedAuthenticator',
      message: /no PRF output/,
    });
    await assert.rejects(walletSeed({ rpId: 'localhost', credentials }), {
      code: 'UnsupportedAuthenticator',
    });
  }
});

test('the pinned ceremony tells the wrong-passkey and no-PRF cases apart', async () => {
  const wrong = container((o) => withPrf(o, OTHER));
  await assert.rejects(
    walletSeed({ rpId: 'localhost', accountCredentialId: ID, credentials: wrong.credentials }),
    { code: 'AccountNotFound' },
  );
  const noPrf = container(() => credential(ID));
  await assert.rejects(
    walletSeed({ rpId: 'localhost', accountCredentialId: ID, credentials: noPrf.credentials }),
    { code: 'UnsupportedAuthenticator' },
  );
});
