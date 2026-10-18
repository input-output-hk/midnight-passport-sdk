FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS build

WORKDIR /opt/passport
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json tsconfig.build.json tsconfig.json ./
COPY packages/ packages/
COPY apps/passport-service/ apps/passport-service/
RUN pnpm install --frozen-lockfile
RUN pnpm exec tsc -b tsconfig.build.json

FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9

RUN groupadd --gid 10001 passport && useradd --uid 10001 --gid 10001 --home-dir /data/state --create-home passport
COPY --from=build --chown=10001:10001 /opt/passport /opt/passport
RUN chmod 0555 /opt/passport/apps/passport-service/image-entrypoint.sh

ENV NODE_ENV=production \
    HOME=/data/state \
    PASSPORT_CONTRACT_DIR=/data/contract \
    PASSPORT_REGISTRY_FILE=/data/state/registry.json \
    PASSPORT_SERVICE_HOST=0.0.0.0 \
    PASSPORT_SERVICE_PORT=8787
WORKDIR /data/state
USER 10001:10001
VOLUME ["/data/contract", "/data/state"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
  CMD node -e "const raw=process.env.PASSPORT_SERVICE_HOST || '127.0.0.1';const host=raw==='0.0.0.0'?'127.0.0.1':raw==='::'?'[::1]':raw.includes(':')&&!raw.startsWith('[')?'['+raw+']':raw;fetch('http://' + host + ':' + (process.env.PASSPORT_SERVICE_PORT || '8787') + '/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/opt/passport/apps/passport-service/image-entrypoint.sh"]

LABEL org.opencontainers.image.source="https://github.com/input-output-hk/midnight-passport-sdk" \
      org.opencontainers.image.description="Pinned Passport ACC proving and sponsorship service"
