# 0009 — Versioned sealed P-256 device registration

Status: accepted for the local `acc-s3r1.1` candidate (2026-10-17).

## Context

Lace Passport PR #2845, merged at `502b0794cc7bcfc76342230193fef4ebb63cae1c`,
registers a device with a 192-byte suite-2 inbox record of type `0xd2`. Its plaintext pairs a
32-byte X25519 reader public key with a 32-byte compressed JubJub authoriser key. A P-256 WebAuthn
key needs 33 compressed SEC1 bytes and its enrolled RP hash and origin to derive and verify a live
ACC device entry. Reinterpreting the JubJub field as P-256 would make the roster ambiguous.

## Decision

The SDK retains Lace's `0xd2` record for JubJub and introduces separate type bytes for P-256.
All records are exactly 192 bytes. Byte 1 is suite `0x02`; bytes 2–13 are a random AES-GCM nonce;
bytes 14–29 are its 16-byte tag. The type, suite and nonce are authenticated associated data.
The AES-256-GCM key derives from the random account roster key using HKDF-SHA-256 with empty salt.

| Type | HKDF info | Plaintext, in byte order | Ciphertext | Zero padding |
| --- | --- | --- | --- | --- |
| `0xd2` JubJub | `lace:passport:device-registration:v1` | reader (32), compressed JubJub key (32) | 30–93 | 94–191 |
| `0xd4` P-256 without policy | `mn-passport:device-registration:p256:v1` | reader (32), compressed SEC1 key (33) | 30–94 | 95–191 |
| `0xd5` P-256 with policy | `mn-passport:device-registration:p256-policy:v1` | reader (32), compressed SEC1 key (33), RP id SHA-256 (32), canonical origin (21) | 30–147 | 148–191 |

The canonical P-256 key is lowercase hex encoding of a valid SEC1 point starting with `02` or
`03`; the decoder re-encodes the point and compares it byte for byte. A policy-bearing `0xd5`
record is the current P-256 encoder output. The 21-byte origin is the
`wa-json134` policy origin of this pinned localhost prototype.

The `0xd4` format is readable for earlier SDK candidates, but lacks the policy needed to match
another P-256 device to its live ACC commitment. Reader resolution drops it rather than guessing
an origin. The decoder opens earlier suite-1 `0xd2` JubJub entries for existing SDK accounts;
suite-1 P-256 registrations never existed and are rejected. Unknown types, nonzero padding,
invalid points, wrong keys and unauthenticated frames open to `null`. The roster resolver admits
only unique reader/device pairs whose commitment is present in the current ledger epoch.

Lace's merged module currently reads only `0xd2`; `0xd4` and `0xd5` are SDK extensions and
are not presented as Lace-interoperable registrations. The P-256 browser composition creates a
random viewing secret, publishes its `0xd1` envelope and `0xd5` registration on chain, and
checks the sealed secret against the live `enc_key` when reopening. Earlier deterministic-key
P-256 accounts are explicitly refused by that composition until an audited migration exists.
Loss of every authorising device still requires a separate recovery mechanism.
