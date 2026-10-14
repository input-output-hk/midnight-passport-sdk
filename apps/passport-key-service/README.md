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
pin for deployment after choosing a release. GHCR package visibility and
consumer access are configured on the container package's GitHub settings page.

```sh
docker volume create passport-acc-keys
docker run --rm \
  --mount type=volume,src=passport-acc-keys,dst=/data/keys \
  -p 127.0.0.1:8788:8788 \
  ghcr.io/input-output-hk/midnight-passport-keys:0.1.0-rc1
```

The process runs as UID/GID `10001`. A bind-mounted cache must be writable by
that identity. Keep the HTTP port on a private network or behind an authenticated
ingress; the files are public proving material, but `.prover` downloads are
large. The image accepts `PASSPORT_KEY_DIR`, `PASSPORT_KEY_HOST` and
`PASSPORT_KEY_PORT`; the binding and manifest hash are pinned in the image.

| Endpoint | Response |
| --- | --- |
| `GET /healthz` | Ready only after all keys pass verification. |
| `GET /v1/manifest` | Readable key manifest with per-file SHA-256 and toolchain. |
| `GET /zk/acc/compiler/contract-manifest.json` | Pinned compiler manifest. |
| `GET /zk/acc/zkir/<circuit>.{zkir,bzkir}` | Verified bundled ZKIR. |
| `GET /zk/acc/keys/<circuit>.verifier` | Verified bundled verifier key. |
| `GET /zk/acc/keys/<circuit>.prover` | Streamed, restored prover key. |

`GET` and `HEAD` accept single `Range: bytes=...` requests so a proof server can
resume large key downloads. Clients must pin the manifest hash independently:
`77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f`.
The service itself verifies the bundled inputs; its cache verification takes
place before readiness.

The image serves keys and manifests only. It does not fund ACCs, sponsor fees,
prove transactions, or expose the demo backend's registry and deployment routes.
