FROM node:20-alpine AS fetcher

ARG HTTP_META_VERSION=1.1.0

RUN apk add --no-cache ca-certificates curl unzip

WORKDIR /opt/app

RUN mkdir -p /opt/app/frontend /opt/app/data \
    && curl -fsSL -o /tmp/cloudspace-frontend.zip \
        https://github.com/sub-store-org/Sub-Store-Front-End/releases/latest/download/dist.zip \
    && unzip -q /tmp/cloudspace-frontend.zip -d /tmp/cloudspace-frontend \
    && if [ -d /tmp/cloudspace-frontend/dist ]; then \
        cp -a /tmp/cloudspace-frontend/dist/. /opt/app/frontend/; \
      else \
        cp -a /tmp/cloudspace-frontend/. /opt/app/frontend/; \
      fi \
    && curl -fsSL -o /opt/app/cloudspace-core.bundle.js \
        https://github.com/sub-store-org/Sub-Store/releases/latest/download/sub-store.bundle.js

# Cumulus (底核) + Nebula (前端) rebrand: surgically wash the upstream "Sub-Store"
# self-identification out of the bundled core + frontend at build time. Functional
# identifiers (env var names, gist sync descriptions, cache keys, Platform) are kept.
# See scripts/rebrand.js. X-Powered-By is additionally overridden via env below.
COPY scripts/rebrand.js /opt/app/scripts/rebrand.js
RUN node /opt/app/scripts/rebrand.js \
      --core /opt/app/cloudspace-core.bundle.js \
      --frontend /opt/app/frontend

ARG CLOUDSPACE_MOUNT_SUBPATH=
COPY scripts/frontend-subpath.js /opt/app/scripts/frontend-subpath.js
RUN node /opt/app/scripts/frontend-subpath.js --frontend /opt/app/frontend --prefix "${CLOUDSPACE_MOUNT_SUBPATH}"

RUN mkdir -p /opt/app/http-meta/meta \
    && curl -fsSL -o /opt/app/http-meta/http-meta.bundle.js \
        "https://github.com/xream/http-meta/releases/download/${HTTP_META_VERSION}/http-meta.bundle.js" \
    && curl -fsSL -o /opt/app/http-meta/meta/tpl.yaml \
        "https://github.com/xream/http-meta/releases/download/${HTTP_META_VERSION}/tpl.yaml"

# ---- Cirrus (内核): rebranded mihomo v1.19.27, built from source ----
# The prebuilt mihomo binary carries identifiable brand strings; we recompile it
# from source with a module-path + brand rename so the binary presents as "Cirrus"
# (functionally equivalent, verified). On-disk filename stays http-meta (required
# by the http-meta runtime). See scripts/cirrus-rename.sh + cirrus-build-recipe.md.
FROM golang:1.26-alpine AS cirrus-builder
ARG CIRRUS_UPSTREAM_TAG=v1.19.27
ARG CIRRUS_MODULE=github.com/zhizhishu/cirrus
ARG CIRRUS_VERSION=cirrus-1.19.27
RUN apk add --no-cache git bash grep
WORKDIR /src
RUN git clone --depth 1 --branch "${CIRRUS_UPSTREAM_TAG}" \
        https://github.com/MetaCubeX/mihomo.git .
COPY scripts/cirrus-rename.sh /src/scripts/cirrus-rename.sh
RUN bash /src/scripts/cirrus-rename.sh
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOAMD64=v1 \
    go build -tags with_gvisor -trimpath \
      -ldflags "-X ${CIRRUS_MODULE}/constant.Version=${CIRRUS_VERSION} -X ${CIRRUS_MODULE}/constant.BuildTime=cirrus -s -w -buildid=" \
      -o /out/http-meta . \
 && /out/http-meta -v

# Script-Hub 全服务器版: 在独立 builder 阶段拉源码并装生产依赖, 再整目录拷进运行镜像。
FROM node:20-alpine AS scripthub

ARG SCRIPTHUB_REF=main
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN apk add --no-cache git ca-certificates \
    && corepack enable

WORKDIR /opt/app/scripthub

RUN git clone --depth 1 --branch "${SCRIPTHUB_REF}" https://github.com/Script-Hub-Org/Script-Hub.git . \
    && corepack prepare pnpm@9.1.0 --activate \
    && pnpm install --prod --no-frozen-lockfile \
    && rm -rf .git

# Stratus rebrand: prune files not needed at runtime (drops the bundled tool's
# filenames, client module templates, dev/build scripts → shrinks the scan surface),
# then surgically wash the remaining self-identification: display text, the internal
# routing sentinel host, the served UI filenames, and package metadata. Functional
# remote /scripts/ URLs the proxy client fetches at runtime are intentionally kept.
# See scripts/rebrand.js. Drift in upstream anchors fails the build loudly.
COPY scripts/rebrand.js /tmp/rebrand.js
RUN rm -rf modules assets README.md Dockerfile dockerignore .gitignore \
        .prettierignore .prettierrc.js .nvmrc .vscode preview.js \
        ignored-build-step.js SurgeModuleTool.js SurgeModuleTool_macOS.js scripts \
        pnpm-lock.yaml node_modules/script-hub node_modules/.pnpm/script-hub@file* \
    && node /tmp/rebrand.js --scripthub /opt/app/scripthub \
    && rm -f /tmp/rebrand.js

FROM node:20-alpine

RUN apk add --no-cache ca-certificates curl procps tzdata

ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    PORT=7860 \
    CLOUDSPACE_PRODUCT_NAME=CloudSpace \
    SUB_STORE_X_POWERED_BY=CloudSpace \
    CLOUDSPACE_LOG_FILTER_ENABLED=true \
    CLOUDSPACE_LOG_FILTER_BRAND=true \
    CLOUDSPACE_LOG_FILTER_REDACT=true \
    CLOUDSPACE_LOG_FILTER_SCRUB_CLIENTS=true \
    ACCESS_LOCK_ENABLED=true \
    ACCESS_LOCK_PORT=7860 \
    ACCESS_LOCK_DATA_PATH=/opt/app/data/cloudspace-access.json \
    ACCESS_LOCK_UPSTREAM_TIMEOUT_MS=300000 \
    ACCESS_LOCK_MAX_FRONTEND_TRANSFORM_BYTES=2097152 \
    ACCESS_LOCK_FRONTEND_CACHE_CONTROL=no-store \
    ACCESS_LOCK_API_CACHE_CONTROL=no-store \
    CLOUDSPACE_API_MAX_CONCURRENT=4 \
    CLOUDSPACE_API_MAX_BODY_BYTES=8388608 \
    CLOUDSPACE_PUBLIC_HEALTH=true \
    CLOUDSPACE_HEALTH_TIMEOUT_MS=2500 \
    CLOUDSPACE_HEALTH_CACHE_MS=10000 \
    CLOUDSPACE_UPSTREAM_HOST=127.0.0.1 \
    CLOUDSPACE_UPSTREAM_PORT=3001 \
    CLOUDSPACE_BACKEND_API_HOST=127.0.0.1 \
    CLOUDSPACE_BACKEND_API_PORT=3001 \
    CLOUDSPACE_BACKEND_MERGE=true \
    CLOUDSPACE_BACKEND_PATH=/2cXaAxRGfddmGz2yx1wA \
    CLOUDSPACE_FRONTEND_PATH=/opt/app/frontend \
    CLOUDSPACE_DATA_BASE_PATH=/opt/app/data \
    CLOUDSPACE_BODY_JSON_LIMIT=8mb \
    CLOUDSPACE_CORE_NODE_MAX_OLD_SPACE_SIZE=6144 \
    CLOUDSPACE_ACCESS_NODE_MAX_OLD_SPACE_SIZE=128 \
    CLOUDSPACE_JOBS_PATH=/__cloudspace/jobs \
    CLOUDSPACE_JOB_ENABLED=true \
    CLOUDSPACE_JOB_MAX_CONCURRENT=2 \
    CLOUDSPACE_JOB_MAX_QUEUE=20 \
    CLOUDSPACE_JOB_MAX_BODY_BYTES=67108864 \
    CLOUDSPACE_JOB_RESULT_MAX_BYTES=67108864 \
    CLOUDSPACE_JOB_TIMEOUT_MS=300000 \
    CLOUDSPACE_JOB_RETENTION_MS=86400000 \
    HTTP_META_ENABLED=true \
    HTTP_META_HOST=127.0.0.1 \
    HTTP_META_PORT=9876 \
    HTTP_META_BODY_JSON_LIMIT=256mb \
    HTTP_META_NODE_MAX_OLD_SPACE_SIZE=8192 \
    HTTP_META_START_DELAY_SECONDS=2 \
    HTTP_META_RESTART_ENABLED=true \
    HTTP_META_RESTART_DELAY_SECONDS=5 \
    HTTP_META_FOLDER=/opt/app/http-meta/meta \
    HTTP_META_TEMP_FOLDER=/tmp/http-meta \
    CURL_CONNECT_TIMEOUT=10 \
    CURL_MAX_TIME=180 \
    SUPABASE_BACKUP_MAX_BYTES=16777216 \
    SUPABASE_BACKUP_REQUIRE_VALID_STORAGE=true \
    SUPABASE_RESTORE_REQUIRE_VALID_STORAGE=true \
    SUPABASE_DAILY_BACKUP_ENABLED=true \
    SUPABASE_DAILY_BACKUP_PREFIX=cloudspace/daily \
    CLOUDSPACE_CACHE_CLEANUP_ENABLED=true \
    CLOUDSPACE_CACHE_CLEANUP_INTERVAL_SECONDS=600 \
    CLOUDSPACE_CACHE_MAX_AGE_MINUTES=360 \
    CLOUDSPACE_CACHE_MIN_DELETE_AGE_MINUTES=15 \
    CLOUDSPACE_CACHE_MAX_KB=262144 \
    CLOUDSPACE_CACHE_EMERGENCY_PURGE=true \
    SUB_STORE_BACKEND_SYNC_CRON="0 6 * * *" \
    SCRIPTHUB_ENABLED=true \
    SCRIPTHUB_DIR=/opt/app/scripthub \
    SCRIPTHUB_HOST=127.0.0.1 \
    SCRIPTHUB_PORT=9100 \
    SCRIPTHUB_BETA_ENABLED=true \
    SCRIPTHUB_BETA_PORT=9101 \
    SCRIPTHUB_PUBLIC_PATH=/sh-REPLACE_ME \
    SCRIPTHUB_BETA_PUBLIC_PATH=/shb-REPLACE_ME \
    SCRIPTHUB_MAX_CONCURRENT=16 \
    SCRIPTHUB_BASE_URL=https://your-account-cloudspace.hf.space/sh-REPLACE_ME \
    SCRIPTHUB_BETA_BASE_URL=https://your-account-cloudspace.hf.space/shb-REPLACE_ME \
    SCRIPTHUB_NODE_MAX_OLD_SPACE_SIZE=1024 \
    SCRIPTHUB_START_DELAY_SECONDS=2 \
    SCRIPTHUB_RESTART_ENABLED=true \
    SCRIPTHUB_RESTART_DELAY_SECONDS=5

WORKDIR /opt/app

COPY --from=fetcher /opt/app /opt/app
COPY --from=cirrus-builder /out/http-meta /opt/app/http-meta/meta/http-meta
COPY --from=scripthub /opt/app/scripthub /opt/app/scripthub
COPY start.sh /usr/local/bin/start-cloudspace
COPY cloudspace-access-proxy.js /opt/app/cloudspace-access-proxy.js
COPY cloudspace-state.js /opt/app/cloudspace-state.js
COPY cloudspace-log-filter.js /opt/app/cloudspace-log-filter.js
COPY cover /opt/app/cover

RUN chmod +x /usr/local/bin/start-cloudspace \
    && chmod +x /opt/app/http-meta/meta/http-meta \
    && /opt/app/http-meta/meta/http-meta -v \
    && rm -f /opt/app/cover/cover.src.js /opt/app/cover/build.mjs /opt/app/cover/README-INTEGRATION.md /opt/app/scripts/rebrand.js /opt/app/scripts/frontend-subpath.js \
    && addgroup -S cloudspace \
    && adduser -S -G cloudspace cloudspace \
    && chown -R cloudspace:cloudspace /opt/app

USER cloudspace

EXPOSE 7860
VOLUME ["/opt/app/data"]

CMD ["start-cloudspace"]
