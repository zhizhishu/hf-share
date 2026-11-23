# syntax=docker/dockerfile:1

# ============================================================================
# hf-share（alphaeee/claw）四合一 all-in-one 镜像（Monorepo 单仓直构）
# ----------------------------------------------------------------------------
# Build context = 本仓根（zhizhishu/hf-share）：
#   components/fusionsearch-mcp/   聚合搜索 / MCP / Admin UI / 总启动脚本
#   components/clawemail/          邮箱面板与 /clawemail/ext/*
#   components/cloudspace/         CloudSpace 订阅栈脚本 / 网关 / 登录封面
#   public/entry/                  海洋三合一根封面
#
# 外部唯一拉取的私有仓：zhizhishu/icloud-hme（由 repos.lock 锁 ICLOUD_HME_SHA，
# 经 BuildKit secret id=icloud_hme_pat 挂载拉取并 git archive 导出纯净源码树，
# PAT 不进 build-arg/镜像层/provenance，.git 绝不进入构建产物）。
#
# 统一运行时：node 22（glibc/bookworm）+ libregroup/libresearch:latest（Void Linux glibc）。
# ============================================================================

# ---- node 22 runtime 二进制来源（glibc/bookworm） ----
FROM node:22-bookworm-slim AS node-runtime

# public/entry 与全局 node_modules 会进最终镜像：只读 bind 预检，树内不得含 .git。
RUN --mount=type=bind,source=public/entry,target=/run/claw-entry,ro \
    git_entries="$(find /usr/local/lib/node_modules /run/claw-entry -name .git -print -quit)" && test -z "$git_entries"

# ---- clawemail builder：编 better-sqlite3(node22 ABI) + vite build(base=/clawemail) ----
FROM node:22-bookworm-slim AS claw-builder
WORKDIR /claw
# ca-certificates 必装：npm ci 走 HTTPS 取包，node:22-bookworm-slim 默认无 CA 证书
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# 源码直接来自本仓 components/clawemail/（同仓并置，不再 clone 外部仓）
COPY components/clawemail/ /claw/
RUN npm ci
# VITE_API_BASE=/clawemail：静态资源和前端 API/SSE/附件统一走 /clawemail 前缀
RUN VITE_API_BASE=/clawemail npm run build
# 只留生产依赖（含已编译好的 better-sqlite3 原生模块）
RUN npm prune --omit=dev \
    && git_entries="$(find /claw/dist /claw/node_modules -name .git -print -quit)" && test -z "$git_entries"

# ============================================================================
# iCloud HME 引擎（icloud-hme）构建阶段 —— ClawEmail 面板的 iCloud 隐藏邮箱源。
# 纯协议实现(tls-client TLS 指纹,零浏览器二进制,HF 镜像红线合规)。
# ⚠️ 私库 zhizhishu/icloud-hme：读权限走 BuildKit secret（id=icloud_hme_pat, required=true），
#    PAT 不作 ARG/build-arg → 不进镜像 config/history/OCI provenance；仅该 RUN 内临时生效。
# 产物 = 单个静态 Go 二进制(前端已 go:embed 内嵌,运行时无 Node 依赖)。
# ============================================================================
# ---- icloud-web-builder：引擎管理前端(vite) → internal/webui/dist ----
FROM node:22-alpine AS icloud-web-builder
ARG ICLOUD_HME_SHA
RUN apk add --no-cache git ca-certificates
WORKDIR /src
RUN --mount=type=secret,id=icloud_hme_pat,required=true \
    --mount=type=tmpfs,target=/run/icloud-fetch \
    test "${#ICLOUD_HME_SHA}" -eq 40 && ! printf '%s' "${ICLOUD_HME_SHA}" | LC_ALL=C grep -q '[^0-9a-fA-F]' \
    && test -s /run/secrets/icloud_hme_pat \
    && git init /run/icloud-fetch \
    && GIT_TERMINAL_PROMPT=0 git -C /run/icloud-fetch -c credential.helper= \
         -c credential.helper='!f() { if [ "$1" = get ]; then printf "%s\n" "username=x-access-token" "password=$(cat /run/secrets/icloud_hme_pat)"; fi; }; f' \
         fetch --depth 1 https://github.com/zhizhishu/icloud-hme.git "$ICLOUD_HME_SHA" \
    && test "$(git -C /run/icloud-fetch rev-parse 'FETCH_HEAD^{commit}')" = "$(printf '%s' "$ICLOUD_HME_SHA" | tr 'A-F' 'a-f')" \
    && git -C /run/icloud-fetch archive --format=tar --output=/run/icloud-fetch/source.tar FETCH_HEAD \
    && tar -xf /run/icloud-fetch/source.tar -C /src
WORKDIR /src/web
RUN npm ci && npm run build \
    && git_entries="$(find /src -name .git -print -quit)" && test -z "$git_entries"

# ---- icloud-builder：Go 编译(CGO_ENABLED=0 静态,内嵌前端) ----
FROM golang:1.26-alpine AS icloud-builder
RUN apk add --no-cache git ca-certificates
WORKDIR /build
COPY --from=icloud-web-builder /src/go.mod /src/go.sum ./
RUN go mod download
COPY --from=icloud-web-builder /src/ .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/icloud-hme .

# ============================================================================
# CloudSpace（Sub-Store 订阅栈）构建阶段 —— 源码来自本仓 components/cloudspace/
# 保留品牌隐藏 rebrand 的「构建期洗白」层 + 运行期日志过滤 + 网关注入层。
# ============================================================================
FROM scratch AS cloud-src
COPY components/cloudspace/ /cloudspace/

# ---- Nebula(前端) + Cumulus(底核): 取 release 产物 → rebrand 洗白 → 子路径 re-host ----
FROM node:20-alpine AS cloud-fetcher
ARG HTTP_META_VERSION=1.1.0
ARG CLOUDSPACE_MOUNT_SUBPATH=/cloudspace
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
        https://github.com/sub-store-org/Sub-Store/releases/latest/download/sub-store.bundle.js \
    && mkdir -p /opt/app/bin \
    && curl -fsSL -o /opt/app/bin/curl \
        https://github.com/moparisthebest/static-curl/releases/latest/download/curl-amd64 \
    && chmod +x /opt/app/bin/curl \
    && /opt/app/bin/curl --version | head -1

# 构建期洗白（Cumulus 底核 + Nebula 前端）：见 scripts/rebrand.js。品牌漂移会 FAIL 构建。
COPY --from=cloud-src /cloudspace/scripts/rebrand.js /opt/app/scripts/rebrand.js
RUN node /opt/app/scripts/rebrand.js \
      --core /opt/app/cloudspace-core.bundle.js \
      --frontend /opt/app/frontend

# 子路径 re-host：静态资源路径改写到 ${CLOUDSPACE_MOUNT_SUBPATH}/ 前缀下并停用 PWA SW。
COPY --from=cloud-src /cloudspace/scripts/frontend-subpath.js /opt/app/scripts/frontend-subpath.js
RUN node /opt/app/scripts/frontend-subpath.js --frontend /opt/app/frontend --prefix "${CLOUDSPACE_MOUNT_SUBPATH}"

RUN mkdir -p /opt/app/http-meta/meta \
    && curl -fsSL -o /opt/app/http-meta/http-meta.bundle.js \
        "https://github.com/xream/http-meta/releases/download/${HTTP_META_VERSION}/http-meta.bundle.js" \
    && curl -fsSL -o /opt/app/http-meta/meta/tpl.yaml \
        "https://github.com/xream/http-meta/releases/download/${HTTP_META_VERSION}/tpl.yaml" \
    && git_entries="$(find /opt/app -name .git -print -quit)" && test -z "$git_entries"

# ---- Cirrus(内核): 从源码重编 rebranded mihomo v1.19.27（静态 CGO_ENABLED=0，可跑 glibc）----
FROM golang:1.26-alpine AS cloud-cirrus-builder
ARG CIRRUS_UPSTREAM_TAG=v1.19.27
ARG CIRRUS_MODULE=github.com/zhizhishu/cirrus
ARG CIRRUS_VERSION=cirrus-1.19.27
RUN apk add --no-cache git bash grep
WORKDIR /src
RUN git clone --depth 1 --branch "${CIRRUS_UPSTREAM_TAG}" \
        https://github.com/MetaCubeX/mihomo.git .
COPY --from=cloud-src /cloudspace/scripts/cirrus-rename.sh /src/scripts/cirrus-rename.sh
RUN bash /src/scripts/cirrus-rename.sh
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOAMD64=v1 \
    go build -tags with_gvisor -trimpath \
      -ldflags "-X ${CIRRUS_MODULE}/constant.Version=${CIRRUS_VERSION} -X ${CIRRUS_MODULE}/constant.BuildTime=cirrus -s -w -buildid=" \
      -o /out/http-meta . \
 && /out/http-meta -v

# ---- Stratus(Script-Hub): 独立 builder 拉源码 + 装生产依赖 + rebrand 洗白 ----
FROM node:20-alpine AS cloud-scripthub
ARG SCRIPTHUB_REF=main
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apk add --no-cache git ca-certificates \
    && corepack enable
WORKDIR /opt/app/scripthub
RUN git clone --depth 1 --branch "${SCRIPTHUB_REF}" https://github.com/Script-Hub-Org/Script-Hub.git . \
    && corepack prepare pnpm@9.1.0 --activate \
    && pnpm install --prod --no-frozen-lockfile \
    && rm -rf .git
COPY --from=cloud-src /cloudspace/scripts/rebrand.js /tmp/rebrand.js
RUN rm -rf modules assets README.md Dockerfile dockerignore .gitignore \
        .prettierignore .prettierrc.js .nvmrc .vscode preview.js \
        ignored-build-step.js SurgeModuleTool.js SurgeModuleTool_macOS.js scripts \
        pnpm-lock.yaml node_modules/script-hub node_modules/.pnpm/script-hub@file* \
    && node /tmp/rebrand.js --scripthub /opt/app/scripthub \
    && rm -f /tmp/rebrand.js \
    && git_entries="$(find /opt/app/scripthub -name .git -print -quit)" && test -z "$git_entries"

# ---- fusion-src：直接从本仓 components/fusionsearch-mcp/ 取源码 ----
FROM scratch AS fusion-src
COPY components/fusionsearch-mcp/ /fusion/

# ---- 最终 all-in-one：libregroup/libresearch (Void Linux glibc) ----
FROM libregroup/libresearch:latest

WORKDIR /app

ENV NODE_ENV=production
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PATH=/usr/local/bin:$PATH
ENV GRANIAN_PROCESS_NAME=fusionsearch-libre
ENV PORT=3000

# 静态 curl（cloud/start.sh 的 restore/backup/wait/health 必需）
COPY --from=cloud-fetcher /opt/app/bin/curl /usr/local/bin/curl

# node 22 二进制 + 全局 npm/npx
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# fusion node 依赖
COPY --from=fusion-src /fusion/package*.json ./
RUN npm ci --omit=dev

# search2api venv
COPY --from=fusion-src /fusion/services/search2api/requirements.txt ./services/search2api/requirements.txt
RUN python3 -m venv /opt/search2api-venv \
    && /opt/search2api-venv/bin/pip install --no-cache-dir -r /app/services/search2api/requirements.txt

# perplexity venv（curl_cffi manylinux wheel，无需浏览器/编译器；--copies 防 symlink 断链）
COPY --from=fusion-src /fusion/services/perplexity/requirements.txt ./services/perplexity/requirements.txt
RUN python3 -m venv --copies /opt/pplx-venv \
    && /opt/pplx-venv/bin/pip install --no-cache-dir -r /app/services/perplexity/requirements.txt \
    && /opt/pplx-venv/bin/python -c "import curl_cffi, fastmcp, aiohttp, aiohttp_socks, websocket; print('[build] perplexity venv self-check OK')"

# fusion 源码 + 总仓海洋入口 public/entry 覆盖
COPY --from=fusion-src /fusion/src ./src
COPY --from=fusion-src /fusion/public ./public
COPY --from=fusion-src /fusion/services ./services
COPY --from=fusion-src /fusion/deploy ./deploy
COPY public/entry ./public/entry

# clawemail 构建产物（dist + 生产 node_modules 含 better-sqlite3 原生模块）→ /app/mail
COPY --from=claw-builder /claw/dist /app/mail/dist
COPY --from=claw-builder /claw/node_modules /app/mail/node_modules
COPY --from=claw-builder /claw/package*.json /app/mail/

RUN mkdir -p /app/config /app/logs /app/mail/data \
    && chmod +x /app/deploy/hf-allinone/start.sh

# iCloud HME 引擎：单个静态二进制 → /app/icloud-hme
COPY --from=icloud-builder /out/icloud-hme /app/icloud-hme/icloud-hme

# ==== CloudSpace（订阅栈）运行时文件 + 引擎 → /opt/app ====
COPY --from=cloud-fetcher /opt/app /opt/app
COPY --from=cloud-cirrus-builder /out/http-meta /opt/app/http-meta/meta/http-meta
COPY --from=cloud-scripthub /opt/app/scripthub /opt/app/scripthub
COPY --from=cloud-src /cloudspace/cloudspace-access-proxy.js /opt/app/cloudspace-access-proxy.js
COPY --from=cloud-src /cloudspace/cloudspace-state.js /opt/app/cloudspace-state.js
COPY --from=cloud-src /cloudspace/cloudspace-log-filter.js /opt/app/cloudspace-log-filter.js
COPY --from=cloud-src /cloudspace/start.sh /opt/app/start.sh
COPY --from=cloud-src /cloudspace/cover /opt/app/cover
RUN mkdir -p /opt/app/data \
    && chmod +x /opt/app/http-meta/meta/http-meta /opt/app/start.sh \
    && /opt/app/http-meta/meta/http-meta -v \
    && rm -f /opt/app/scripts/rebrand.js /opt/app/scripts/frontend-subpath.js \
    && git_entries="$(find /app /opt/app -name .git -print -quit)" && test -z "$git_entries"

# 容器内端口表：
#   fusion node :3000(对外) / clawemail :3100(内部,/clawemail) / icloud-hme :8081(内部,直连) /
#   CloudSpace 网关 :7861(内部,/cloudspace) / core :3200 / Cirrus :9876 / Stratus :9100+9101 /
#   SearXNG :8080 / search2api :8000 / pplx :8001
EXPOSE 3000

ENTRYPOINT []
CMD ["sh", "/app/deploy/hf-allinone/start.sh"]
