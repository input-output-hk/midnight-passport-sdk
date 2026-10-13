// The Lace passkey recipe v1 (lace-platform main: LW-15585, LW-15584, LW-15635), ported so the
// prototype derives the same secrets Lace would from the same passkey:
//
//   PRF(salt = SHA-256('lace/prf/root/v1'))                       -> root (32 bytes)
//   HKDF-SHA256(root, salt = empty, info = 'lace/hkdf/wallet-entropy/v1', 32)  -> wallet entropy
//   HKDF-SHA256(entropy, salt = 'lace', info = 'wallet-seed', 32) -> BIP-39 entropy (24 words)
//   mnemonicToSeedSync(words)                                     -> the 64-byte BIP-39 seed
//   MIP-0015 v1 deriveSymmetricSecret(seed, 'lace-passport:acc-enc:v1', `${networkId}/0`)
//                                                                 -> the ACC's X25519 secret
//
// Every intermediate byte array is zeroed before returning. The 24 words are a string and
// cannot be; they never leave this module.
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist as english } from '@scure/bip39/wordlists/english.js';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** PRF output #1: Lace's ACC authoriser (a JubJub key). Evaluated here, but unused (spec §5.4). */
export const PRF_LABEL_AUTHORISER = 'lace-passport/prf/authoriser/v1';
/** PRF output #2: the root every wallet and account secret derives from. */
export const PRF_LABEL_ROOT = 'lace/prf/root/v1';
export const HKDF_WALLET_ENTROPY_INFO = 'lace/hkdf/wallet-entropy/v1';
/** The MIP-0015 domain of the ACC's encryption key. */
export const ACC_ENC_DOMAIN = 'lace-passport:acc-enc:v1';

/** PRF salts are public domain separators: SHA-256 of their label. */
export const prfSalt = (label: string): Uint8Array => sha256(utf8(label));

/** The 24 BIP-39 words of a PRF root. Exported for the test vectors; never shown or stored. */
export function mnemonicFromRoot(root: Uint8Array): string {
  if (root.length !== 32) throw new Error('the PRF root must be 32 bytes');
  const entropy = hkdf(sha256, root, undefined, utf8(HKDF_WALLET_ENTROPY_INFO), 32);
  // Lace's Mnemonic.deriveFrom: HKDF with salt 'lace' and info 'wallet-seed'.
  const derived = hkdf(sha256, entropy, utf8('lace'), utf8('wallet-seed'), 32);
  try {
    return entropyToMnemonic(derived, english);
  } finally {
    entropy.fill(0);
    derived.fill(0);
  }
}

/** The 64-byte BIP-39 seed (empty passphrase) of a PRF root. The caller zeroes it. */
export const seedFromRoot = (root: Uint8Array): Uint8Array =>
  mnemonicToSeedSync(mnemonicFromRoot(root));

const MIP15_MASTER_KEY = 'Symmetric key seed';
const MIP15_CONNECTOR_LABEL = 'MIP-0015-connector-secret';
const MIP15_HKDF_SALT = 'MIP-0015:v1';
const SEPARATOR = Uint8Array.of(0);

/** A SLIP-0021 child: HMAC-SHA512 keyed by the parent's first half over 0x00 || label. */
const childNode = (node: Uint8Array, label: Uint8Array): Uint8Array =>
  hmac(sha512, node.subarray(0, 32), new Uint8Array([...SEPARATOR, ...label]));

/**
 * MIP-0015 v1 `deriveSymmetricSecret`, ported verbatim from lace-platform's
 * `packages/lib/crypto/src/derive-symmetric-secret.ts`: a SLIP-0021 walk from the BIP-39 seed
 * through the connector label and the NFC-normalised domain, then HKDF-SHA256 over the domain
 * node's second half, keyed by the domain and context. The seed is left untouched.
 */
export function deriveSymmetricSecret(
  seed: Uint8Array,
  { domain, context, length = 32 }: { domain: string; context: string; length?: number },
): Uint8Array {
  const domainBytes = utf8(domain.normalize('NFC'));
  if (domainBytes.length < 1 || domainBytes.length > 256) {
    throw new Error(`MIP-0015 domain must encode to 1..256 bytes, got ${domainBytes.length}`);
  }
  const contextBytes = utf8(context);
  if (contextBytes.length > 1024) {
    throw new Error(
      `MIP-0015 context must encode to at most 1024 bytes, got ${contextBytes.length}`,
    );
  }
  if (!Number.isInteger(length) || length < 16 || length > 64) {
    throw new Error(`MIP-0015 secret length must be an integer in 16..64, got ${length}`);
  }
  const master = hmac(sha512, utf8(MIP15_MASTER_KEY), seed);
  const connector = childNode(master, utf8(MIP15_CONNECTOR_LABEL));
  const domainNode = childNode(connector, domainBytes);
  try {
    return hkdf(
      sha256,
      domainNode.subarray(32),
      utf8(MIP15_HKDF_SALT),
      new Uint8Array([...domainBytes, ...SEPARATOR, ...contextBytes]),
      length,
    );
  } finally {
    master.fill(0);
    connector.fill(0);
    domainNode.fill(0);
  }
}

/** The ACC's X25519 secret: MIP-0015 at `lace-passport:acc-enc:v1`, context `<network>/0`. */
export const accEncryptionSecret = (seed: Uint8Array, networkId: string): Uint8Array =>
  deriveSymmetricSecret(seed, { domain: ACC_ENC_DOMAIN, context: `${networkId}/0` });

/**
 * The ACC's `enc_key`, the X25519 public key of {@link accEncryptionSecret}. Network-bound and
 * reproducible from the passkey, so the account's encryption key needs no storage.
 */
export function accEncryptionKey(seed: Uint8Array, networkId: string): Uint8Array {
  const secret = accEncryptionSecret(seed, networkId);
  try {
    return x25519.getPublicKey(secret);
  } finally {
    secret.fill(0);
  }
}
