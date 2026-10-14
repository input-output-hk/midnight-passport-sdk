FROM node:22.23.2-bookworm-slim AS build

WORKDIR /opt/passport
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json tsconfig.build.json tsconfig.json ./
COPY packages/ packages/
COPY apps/passport-funding-service/ apps/passport-funding-service/
RUN pnpm install --frozen-lockfile
RUN pnpm exec tsc -b tsconfig.build.json

FROM node:22.23.2-bookworm-slim

RUN groupadd --gid 10001 passport && useradd --uid 10001 --gid 10001 --home-dir /data/state --create-home passport
COPY --from=build --chown=10001:10001 /opt/passport /opt/passport
RUN chmod 0555 /opt/passport/apps/passport-funding-service/image-entrypoint.sh

ENV NODE_ENV=production \
    PASSPORT_CONTRACT_DIR=/data/contract \
    PASSPORT_FUNDING_HOST=0.0.0.0 \
    PASSPORT_FUNDING_PORT=8789 \
    PASSPORT_FUNDING_RESERVATIONS_FILE=/data/state/funding-reservations.json
WORKDIR /data/state
USER 10001:10001
VOLUME ["/data/contract", "/data/state"]
EXPOSE 8789
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8789/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/opt/passport/apps/passport-funding-service/image-entrypoint.sh"]

LABEL org.opencontainers.image.source="https://github.com/input-output-hk/midnight-passport-sdk" \
      org.opencontainers.image.description="Pinned Passport ACC funding service"
