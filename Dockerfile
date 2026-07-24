# ============================================================================
# FusionSearch + ClawEmail 合并 all-in-one 镜像（目标：部署到 alphaeee/claw Space）
# ----------------------------------------------------------------------------
# Build context 假设（自包含形态，便于云端验证）：以 fusion 源为集成层主体，
# clawemail 全部源码放在子目录 mail/：
#   <context>/  package.json src/ public/ services/ deploy/ Dockerfile.claw-merge  (fusion)
#   <context>/mail/  package.json src/ ...                                         (clawemail 全部源码)
# ⚠️ context 需带一个 .dockerignore 排除 **/node_modules（尤其 mail/node_modules），
#    否则 COPY mail/ 会把 clawemail 本地 node_modules 覆盖掉 builder 里刚编好的。
# 最终形态（build 时 git clone 两源 pin commit vs 自包含快照）由用户拍板；本文件用
# 自包含，云端验证与最终形态无关（build 逻辑一致，只是源码来源不同）。
#
# 关键决策：统一 node 22 —— fusion 纯 JS(express/mcp-sdk/cors/zod)升 22 零 ABI 风险；
# clawemail better-sqlite3 用 node22 编、运行时也 node22，原生模块 ABI 匹配不崩。
# base = libregroup/libresearch:latest（已坐实=SearXNG 的 Void Linux glibc 版，
# 能跑 glibc node 二进制 + libstdc++，故 debian bookworm 编的原生 .node 可直接跑）。
# ============================================================================

# ---- node 22 runtime 二进制来源（glibc/bookworm） ----
FROM node:22-bookworm-slim AS node-runtime

# ---- clawemail builder：编 better-sqlite3(node22 ABI) + vite build(base=/clawemail) ----
FROM node:22-bookworm-slim AS claw-builder
WORKDIR /claw
# better-sqlite3 原生模块编译依赖（与 clawemail 原 Dockerfile 一致，已验证可行）
ARG CLAWEMAIL_REF=main
# ca-certificates 必装：node:22-bookworm-slim 默认无 CA 证书，git clone HTTPS 会 CAfile:none 验证失败
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# cache-bust：同 fusion-src，commits API 使 ClawEmail 源码更新时下方 clone 层必重拉。
ADD https://api.github.com/repos/zhizhishu/ClawEmail/commits/${CLAWEMAIL_REF} /tmp/.clawemail-ref.json
# clone-at-build：clawemail 唯一真源 = zhizhishu/ClawEmail（不再 vendored mail/ 拷贝）
RUN git clone --depth 1 --branch "${CLAWEMAIL_REF}" \
        https://github.com/zhizhishu/ClawEmail.git . \
    && npm ci
# VITE_API_BASE=/clawemail：vite base 让静态资源引用带 /clawemail 前缀，同时前端 API/SSE/附件
# 全走 /clawemail（api.ts 的 API_BASE 读同一个 VITE_API_BASE）。esbuild 后端 bundle 一并产出。
RUN VITE_API_BASE=/clawemail npm run build
# 只留生产依赖（含已编译好的 better-sqlite3 原生模块）
RUN npm prune --omit=dev

# ============================================================================
# CloudSpace（Sub-Store 订阅栈）构建阶段 —— 整合自 cloudspace/Dockerfile。
# 忠实保留品牌隐藏 rebrand 的「构建期洗白」层：
#   scripts/rebrand.js  洗 Nebula(前端 dist) + Cumulus(底核 bundle) + Stratus(Script-Hub)
#   scripts/cirrus-rename.sh  把 mihomo 改名 Cirrus 并从源码重编（去可识别品牌串）
# 运行期日志过滤(cloudspace-log-filter.js) + 网关注入(access-proxy) 两层在运行时生效。
# 产物全部落在 /opt/app（与 cloudspace 原生布局一致，避免改它硬编码的绝对路径），
# 与 claw 自身的 /app 互不相干。build 时下载 core/frontend/mihomo/scripthub 四源，
# 洗白后与 claw 的运行时文件一起进最终镜像；claw 网关反代 /cloudspace → 网关内部 7861。
# ============================================================================

# ---- cloud-src：clone zhizhishu/cloudspace（CloudSpace 订阅栈唯一真源，不再 vendored 在 claw 仓 cloud/）----
# 与 fusion-src / claw-builder 同一套 clone-at-build 模式：脚本(rebrand/frontend-subpath/
# cirrus-rename)+网关注入层(access-proxy/state/log-filter)+start.sh+cover 全从这里取。
# ⚠️ 必须定义在引用它的 cloud-fetcher/cirrus-builder/scripthub stage 之前——buildx 不支持
#    forward --from(实测报 "cannot copy from stage cloud-src, needs to be defined before")。
FROM alpine/git AS cloud-src
ARG CLOUDSPACE_REF=main
WORKDIR /cloudspace
# cache-bust: commits API 随最新 commit 变、使下方 clone 层失效重拉（防 layer cache 锁死旧代码）
ADD https://api.github.com/repos/zhizhishu/cloudspace/commits/${CLOUDSPACE_REF} /tmp/.cloudspace-ref.json
RUN echo "cloudspace-clone-cachebust=2026-07-17-cover-wire-b1 (buildx ADD-url缓存不可靠,改RUN文本硬破clone层重拉main含__lock/login的renderCover接线)" \
    && git clone --depth 1 --branch "${CLOUDSPACE_REF}" \
        https://github.com/zhizhishu/cloudspace.git . \
    && rm -rf .git

# ---- Nebula(前端) + Cumulus(底核): 取 release 产物 → rebrand 洗白 → 子路径 re-host ----
FROM node:20-alpine AS cloud-fetcher
ARG HTTP_META_VERSION=1.1.0
# 前端子路径挂载前缀（须与运行期 CLOUDSPACE_MOUNT_PREFIX 一致；见 deploy/hf-allinone/start.sh）。
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

# 子路径 re-host：把前端 dist 里根绝对的静态资源路径(/index.js、/chunks、/css、/fonts、
# /images、icons、manifest)改写到 ${CLOUDSPACE_MOUNT_SUBPATH}/ 前缀下，并停用 PWA SW。
# 前端 API 走 hostAPI 同源基址(网关 bootstrap 注入)，不在此改写。anchor 漂移会 FAIL 构建。
COPY --from=cloud-src /cloudspace/scripts/frontend-subpath.js /opt/app/scripts/frontend-subpath.js
RUN node /opt/app/scripts/frontend-subpath.js --frontend /opt/app/frontend --prefix "${CLOUDSPACE_MOUNT_SUBPATH}"

RUN mkdir -p /opt/app/http-meta/meta \
    && curl -fsSL -o /opt/app/http-meta/http-meta.bundle.js \
        "https://github.com/xream/http-meta/releases/download/${HTTP_META_VERSION}/http-meta.bundle.js" \
    && curl -fsSL -o /opt/app/http-meta/meta/tpl.yaml \
        "https://github.com/xream/http-meta/releases/download/${HTTP_META_VERSION}/tpl.yaml"

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
    && rm -f /tmp/rebrand.js

# ---- 最终 all-in-one：libregroup/libresearch (Void Linux glibc) ----
# ---- fusion 源：clone fusionsearch-mcp（唯一真源，不再 vendored 在 claw 仓根）----
FROM alpine/git AS fusion-src
ARG FUSION_REF=main
WORKDIR /fusion
# cache-bust：commits API 响应体随 ${FUSION_REF} 最新 commit 变化，使下方 clone 层在源码
# 更新时必定失效重拉。否则 `git clone ... main` 指令字符串恒定，Docker layer cache 会把
# clone 锁死在旧 commit —— push 了新代码，build 却仍用旧源码（实测踩坑：三入口路由不更新）。
ADD https://api.github.com/repos/zhizhishu/fusionsearch-mcp/commits/${FUSION_REF} /tmp/.fusion-ref.json
RUN echo "fusion-clone-cachebust=2026-07-24-pplx-exit-pool-rotation (硬破clone层重拉 fusion main 549ce39: perplexity search_resilient resin出口池on-failure换出口)" \
    && git clone --depth 1 --branch "${FUSION_REF}" \
        https://github.com/zhizhishu/fusionsearch-mcp.git . \
    && rm -rf .git

FROM libregroup/libresearch:latest

WORKDIR /app

ENV NODE_ENV=production
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PATH=/usr/local/bin:$PATH
ENV GRANIAN_PROCESS_NAME=fusionsearch-libre
ENV PORT=3000

# curl：cloud/start.sh 的 restore/backup/wait/health 全靠它，libresearch base 无 curl、无包管理器、
# 只有 busybox wget(不跟随 GitHub 302 重定向、下载失败=BUILD_ERROR)。故在有 curl 的 cloud-fetcher(alpine)
# 阶段下载好静态 curl(amd64)、直接 COPY 单文件进来，绕开 wget、build 稳。仅 amd64(HF 与 GHCR 均 amd64)。
COPY --from=cloud-fetcher /opt/app/bin/curl /usr/local/bin/curl

# node 22 二进制 + 全局 npm/npx
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# fusion node 依赖（源来自 fusion-src clone）
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

# fusion 源码（来自 fusion-src clone；claw 独有的海洋入口 public/entry 单独 COPY 覆盖）
COPY --from=fusion-src /fusion/src ./src
COPY --from=fusion-src /fusion/public ./public
COPY --from=fusion-src /fusion/services ./services
COPY --from=fusion-src /fusion/deploy ./deploy
COPY public/entry ./public/entry
# entry/assets(glb/海面/wasm) 已是 git 普通 blob(commit d037a34 从 LFS 转, 均 <10MB HF 不 auto-LFS),
# 上面 COPY public/entry 已带真文件; 勿再从 GitHub media 端点 ADD 覆盖 —— 私有库该端点返回 131 字节
# LFS 指针会把真文件毁成坏指针(石头/海面不渲染的根因, 2026-07-17 移除)。

# clawemail 构建产物（dist + 生产 node_modules 含 better-sqlite3 原生模块）→ /app/mail
COPY --from=claw-builder /claw/dist /app/mail/dist
COPY --from=claw-builder /claw/node_modules /app/mail/node_modules
COPY --from=claw-builder /claw/package*.json /app/mail/

RUN mkdir -p /app/config /app/logs /app/mail/data \
    && chmod +x /app/deploy/hf-allinone/start.sh

# ==== CloudSpace（订阅栈）运行时文件 + 引擎 → /opt/app（cloudspace 原生布局，勿改）====
# cloud-fetcher 的 /opt/app 已含: 洗白后的 frontend/、cloudspace-core.bundle.js、
# http-meta/(bundle+tpl)、data/、scripts/(build 期脚本，下方清理)。
COPY --from=cloud-fetcher /opt/app /opt/app
# Cirrus(内核) 静态二进制 覆盖到 http-meta 运行时要求的文件名位置。
COPY --from=cloud-cirrus-builder /out/http-meta /opt/app/http-meta/meta/http-meta
# Stratus(Script-Hub) 装好依赖 + 洗白后的整目录。
COPY --from=cloud-scripthub /opt/app/scripthub /opt/app/scripthub
# 网关注入层(access-proxy，含子路径挂载改造) + 状态/日志过滤 + supervisor。
COPY --from=cloud-src /cloudspace/cloudspace-access-proxy.js /opt/app/cloudspace-access-proxy.js
COPY --from=cloud-src /cloudspace/cloudspace-state.js /opt/app/cloudspace-state.js
COPY --from=cloud-src /cloudspace/cloudspace-log-filter.js /opt/app/cloudspace-log-filter.js
COPY --from=cloud-src /cloudspace/start.sh /opt/app/start.sh
# 登录前海洋石头解锁封面(石头海浪 Three.js): login.html + cover.bundle.js + assets/。
# 网关 handleCoverRoute 从 __dirname/cover(=/opt/app/cover) 读静态资源, renderCover 模板化 login.html。
# 子路径挂载(/cloudspace)下资源路径由网关运行期按 CLOUDSPACE_MOUNT_PREFIX 重写(见 access-proxy 的
# renderCover / handleCoverRoute), 无需 build 期改写。运行期开关 CLOUDSPACE_COVER_ENABLED。
COPY --from=cloud-src /cloudspace/cover /opt/app/cover
RUN mkdir -p /opt/app/data \
    && chmod +x /opt/app/http-meta/meta/http-meta /opt/app/start.sh \
    && /opt/app/http-meta/meta/http-meta -v \
    && rm -f /opt/app/scripts/rebrand.js /opt/app/scripts/frontend-subpath.js

# 对外端口 = clawemail Space 原 app_port 3000（fusion node 监听；HF 会注入 PORT=3000）。
# 容器内：fusion node :3000(对外) / clawemail :3100(内部,MOUNT_MAIL=on 反代 /clawemail) /
#   CloudSpace 网关 :7861(内部,MOUNT_SUBSTORE=on 反代 /cloudspace) / core :3200 /
#   Cirrus(http-meta) :9876 / Stratus :9100+9101 / SearXNG :8080 / search2api :8000 / pplx :8001。
EXPOSE 3000

ENTRYPOINT []
CMD ["sh", "/app/deploy/hf-allinone/start.sh"]
