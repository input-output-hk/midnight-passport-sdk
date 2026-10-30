# Passport key service image

`passport-key-service` is a Node application dedicated to the pinned
`acc-s3r1.1` proving artefacts. It carries the contract package's small ZKIR
bundle and the Compact 0.35.0 `zkir-v3` compiler. It carries **no sponsor wallet
or seed** and no prebuilt 12 GB prover-key set.

At startup the pinned `mn-passport-restore-keys` command regenerates missing
prover keys in `/data/keys` and checks every cached file against the compiler
manifest and package pin. The HTTP socket opens only after restoration succeeds.
An incorrect cached file makes startup fail; the service never replaces it
silently. Keep `/data/keys` on a persistent volume with at least 15 GB free.
The first start can take roughly 20–30 minutes for 52 circuits; subsequent
starts verify the cache before serving.

The image is published by
[`publish-key-image.yml`](../../.github/workflows/publish-key-image.yml) to
`ghcr.io/input-output-hk/midnight-passport-keys:<version>`. The workflow runs
from `passport-acc-prototype` and also accepts `keys-v*` release tags on that
branch's history. The image has a version tag and a commit-SHA tag. Use a digest
pin for deployment. `0.1.0-rc6` and `sha-7848d3029de7` resolve to
`sha256:86280acb7f23c7a9f46339c9b58afb7416038d7c2d2ab05559ef4029027929be`.
The [publication receipt](https://github.com/input-output-hk/midnight-passport-sdk/releases/download/sdk-v0.1.0-rc6/rc6-publication-receipt.json) records its checks.
GHCR package visibility and
consumer access are configured on the container package's GitHub settings page.

```sh
docker volume create passport-acc-keys
docker run --rm --platform linux/amd64 --read-only --tmpfs /tmp \
  --mount type=volume,src=passport-acc-keys,dst=/data/keys \
  -p 127.0.0.1:8788:8788 \
  ghcr.io/input-output-hk/midnight-passport-keys@sha256:86280acb7f23c7a9f46339c9b58afb7416038d7c2d2ab05559ef4029027929be
```

The process runs as UID/GID `10001`. A bind-mounted cache must be writable by
that identity. Keep the HTTP port on a private network or behind an authenticated
ingress; the files are public proving material, but `.prover` downloads are
large. The image accepts `PASSPORT_KEY_DIR`, `PASSPORT_KEY_HOST` and
`PASSPORT_KEY_PORT`; the binding and manifest hash are pinned in the image.

For a browser consumer such as Lace, set `PASSPORT_KEY_CORS_ORIGINS` to a
comma-separated list of exact `http://` or `https://` origins and set the
consumer's `artefactUrl` to `https://<key-host>/v1/zk/acc-s3r1.1`. Set the same
exact URL as `PASSPORT_PUBLIC_ZK_BASE_URL` on the Passport service; the browser
connector must pin it independently (the demo uses `VITE_PASSPORT_ARTEFACT_URL`).
The existing `/zk/acc` route remains for the legacy and proof-server clients. Browser reads and
single-range downloads receive CORS headers only for those origins. The
default list is empty. Keep the service behind a private or controlled ingress.

`PASSPORT_KEY_PROFILE=jubjub-owner-v1` restores and serves the ten proving
circuits currently used by Lace PR #2845, about 530 MB instead of the full 12 GB.
The default `all` profile restores all 52 circuits. `/v1/profile` reports the
`circuits` proving list and the separate `verifierCircuits` list. All small, pinned
verifier keys remain available even outside a reduced proving profile, because a
consumer may install operations proved by another caller. Unselected prover and ZKIR
requests still return 404. `/v1/manifest` remains the complete binding's integrity
manifest, so a partial profile must not be treated as a complete key cache.
The RC6 image contains the verifier-availability correction; RC5 does not.
Check the [RC6 release notes](../../docs/site/release-notes-rc6.md) before deploying
its image. For the older RC5 image, keep the `all` profile.

| Endpoint | Response |
| --- | --- |
| `GET /healthz` | Ready only after all keys pass verification. |
| `GET /v1/manifest` | Readable key manifest with per-file SHA-256 and toolchain. |
| `GET /v1/profile` | Active proving profile (`circuits`) and all bundled `verifierCircuits`. |
| `GET /zk/acc/compiler/contract-manifest.json` | Pinned compiler manifest. |
| `GET /zk/acc/zkir/<circuit>.{zkir,bzkir}` | Verified bundled ZKIR. |
| `GET /zk/acc/keys/<circuit>.verifier` | Verified bundled verifier key. |
| `GET /zk/acc/keys/<circuit>.prover` | Streamed, restored prover key. |
| `GET /v1/zk/acc-s3r1.1/{compiler,zkir,keys}/...` | Binding-specific alias for the same pinned bytes. |

`GET` and `HEAD` accept single `Range: bytes=...` requests so a proof server can
resume large key downloads. Clients must pin the manifest hash independently:
`77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f`.
The service itself verifies the bundled inputs; its cache verification takes
place before readiness.

The image serves keys and manifests only. It does not fund ACCs, sponsor fees,
prove transactions, or expose the demo backend's registry and deployment routes.

## Compiler home, cache and TLS

The image sets `HOME=/data/keys` and `XDG_CACHE_HOME=/data/keys/.cache`, and includes a pinned
CA bundle through `SSL_CERT_FILE` / `SSL_CERT_DIR`. Fresh regeneration needs a writable home/cache
and outbound HTTPS for the compiler's data fetcher; a fully populated verified key cache can be
served without regeneration. Keep the key volume writable for a restoring instance. With a
read-only root, also provide a writable `/tmp` (for example `--tmpfs /tmp`). If overriding the
home/cache locations, give UID/GID `10001:10001` access. Cache files are not exposed as arbitrary
HTTP paths: only pinned bundle inputs and known circuit keys are served.

RC5 published-image qualification regenerated `deposit_unshielded` from packaged ZKIR in the Linux image
and checked both output hashes. It separately verified/served all 52 cached circuits. It does
not claim a fresh generation of every circuit in the container during the handover run.
