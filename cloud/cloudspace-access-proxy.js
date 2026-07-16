const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { URLSearchParams } = require("url");

const productName = process.env.CLOUDSPACE_PRODUCT_NAME || "CloudSpace";
const enabled = process.env.ACCESS_LOCK_ENABLED !== "false";
const listenPort = Number(process.env.ACCESS_LOCK_PORT || process.env.PORT || 3000);
const upstreamHost = process.env.ACCESS_LOCK_UPSTREAM_HOST || process.env.CLOUDSPACE_UPSTREAM_HOST || "127.0.0.1";
const upstreamPort = Number(process.env.ACCESS_LOCK_UPSTREAM_PORT || process.env.CLOUDSPACE_BACKEND_API_PORT || 3001);
const dataBasePath = process.env.CLOUDSPACE_DATA_BASE_PATH || "/opt/app/data";
const dataPath = process.env.ACCESS_LOCK_DATA_PATH || path.join(dataBasePath, "cloudspace-access.json");
const cookieName = process.env.ACCESS_LOCK_COOKIE_NAME || "cloudspace_access";
const initialPassword = process.env.ACCESS_LOCK_INITIAL_PASSWORD || process.env.ACCESS_LOCK_PASSWORD || "";
const backendPath = normalizeBackendPath(process.env.CLOUDSPACE_BACKEND_PATH || process.env.SUB_STORE_FRONTEND_BACKEND_PATH || "/2cXaAxRGfddmGz2yx1wA");
const upstreamTimeoutMs = positiveNumber(
  process.env.ACCESS_LOCK_UPSTREAM_TIMEOUT_MS || process.env.CLOUDSPACE_UPSTREAM_TIMEOUT_MS,
  300000
);
const requestTimeoutMs = positiveNumber(
  process.env.ACCESS_LOCK_REQUEST_TIMEOUT_MS || process.env.CLOUDSPACE_REQUEST_TIMEOUT_MS,
  upstreamTimeoutMs + 30000
);
const maxFrontendTransformBytes = positiveNumber(
  process.env.ACCESS_LOCK_MAX_FRONTEND_TRANSFORM_BYTES || process.env.CLOUDSPACE_MAX_FRONTEND_TRANSFORM_BYTES,
  2097152
);
const frontendCacheControl = process.env.ACCESS_LOCK_FRONTEND_CACHE_CONTROL || process.env.CLOUDSPACE_FRONTEND_CACHE_CONTROL || "no-store";
const apiCacheControl = process.env.ACCESS_LOCK_API_CACHE_CONTROL || process.env.CLOUDSPACE_API_CACHE_CONTROL || "no-store";
const cloudspaceConfigPath = process.env.CLOUDSPACE_CONFIG_PATH || "/__cloudspace/config.json";
const cloudspaceHealthPath = process.env.CLOUDSPACE_HEALTH_PATH || "/__cloudspace/health";
const publicHealthEnabled = process.env.CLOUDSPACE_PUBLIC_HEALTH !== "false";
const apiMaxConcurrent = positiveNumber(process.env.CLOUDSPACE_API_MAX_CONCURRENT || process.env.ACCESS_LOCK_API_MAX_CONCURRENT, 4);
const apiMaxBodyBytes = positiveNumber(process.env.CLOUDSPACE_API_MAX_BODY_BYTES || process.env.ACCESS_LOCK_API_MAX_BODY_BYTES, 8 * 1024 * 1024);
const cloudspaceJobsPath = normalizeBackendPath(process.env.CLOUDSPACE_JOBS_PATH || "/__cloudspace/jobs") || "/__cloudspace/jobs";
const jobStoreDir = process.env.CLOUDSPACE_JOB_DIR || path.join(dataBasePath, "cloudspace-jobs");
const jobEnabled = process.env.CLOUDSPACE_JOB_ENABLED !== "false";
const jobMaxConcurrent = positiveNumber(process.env.CLOUDSPACE_JOB_MAX_CONCURRENT, 2);
const jobMaxQueue = positiveNumber(process.env.CLOUDSPACE_JOB_MAX_QUEUE, 20);
const jobMaxBodyBytes = positiveNumber(process.env.CLOUDSPACE_JOB_MAX_BODY_BYTES, 64 * 1024 * 1024);
const jobResultMaxBytes = positiveNumber(process.env.CLOUDSPACE_JOB_RESULT_MAX_BYTES, 64 * 1024 * 1024);
const jobTimeoutMs = positiveNumber(process.env.CLOUDSPACE_JOB_TIMEOUT_MS, upstreamTimeoutMs);
const jobRetentionMs = positiveNumber(process.env.CLOUDSPACE_JOB_RETENTION_MS, 24 * 60 * 60 * 1000);
const httpMetaEnabled = process.env.HTTP_META_ENABLED !== "false";
const httpMetaHost = process.env.HTTP_META_HOST || "127.0.0.1";
const httpMetaPort = Number(process.env.HTTP_META_PORT || 9876);
const healthTimeoutMs = positiveNumber(process.env.CLOUDSPACE_HEALTH_TIMEOUT_MS, 2500);
const healthCacheMs = positiveNumber(process.env.CLOUDSPACE_HEALTH_CACHE_MS, 10000);

// Sub-path mount support. When the gateway is reverse-proxied behind another app at
// a prefix (e.g. claw forwards /cloud/* here WITHOUT stripping it), set
// CLOUDSPACE_MOUNT_PREFIX=/cloud. Incoming request URLs are normalized (prefix stripped)
// once at the top of the server so ALL internal routing/upstream logic stays root-relative
// and unchanged; every browser-facing absolute URL the gateway emits (redirects, the lock
// page form actions, and the frontend hostAPI base) is re-prefixed with it. The frontend's
// STATIC asset paths (/index.js, /chunks/, /css/, /fonts/, /images/) are handled separately
// at build time (scripts/frontend-subpath.js) because CSS/large-JS bodies are not transformed
// here. Empty (default) = mounted at root, fully backward compatible.
const mountPrefix = normalizeMountPrefix(process.env.CLOUDSPACE_MOUNT_PREFIX);
// Pre-login ocean/stone cover (石头海浪 Three.js unlock). The 690KB bundle + login.html
// hard-code root-absolute /cover/ and /__lock/ paths; under a sub-path mount those are
// rewritten to <mountPrefix>/... at serve time (renderCover / handleCoverRoute below), so
// the cover works both at root and under /cloud. The gateway serves these bodies itself, so
// unlike the proxied front-end (build-time frontend-subpath.js) no build step is needed.
// Set CLOUDSPACE_COVER_ENABLED=false to force the plain (inline-styled) lock screen instead.
const coverEnabled = process.env.CLOUDSPACE_COVER_ENABLED !== "false";

// Stratus 全服务器版: 作为同容器内的独立 Koa 服务并存于 CloudSpace 网关之后。
// 因为代理客户端(Surge/Loon/Clash 等)无法携带访问锁 cookie, Stratus 通过一条
// 加密公开路径放行(类似已发布订阅 /download), 安全性来自难以猜测的长前缀。
const scriptHubEnabled = process.env.SCRIPTHUB_ENABLED !== "false";
const scriptHubHost = process.env.SCRIPTHUB_HOST || "127.0.0.1";
const scriptHubPort = Number(process.env.SCRIPTHUB_PORT || 9100);
const scriptHubBetaEnabled = process.env.SCRIPTHUB_BETA_ENABLED !== "false";
const scriptHubBetaPort = Number(process.env.SCRIPTHUB_BETA_PORT || 9101);
const scriptHubPath = normalizeBackendPath(process.env.SCRIPTHUB_PUBLIC_PATH || "/sh-REPLACE_ME");
const scriptHubBetaPath = normalizeBackendPath(process.env.SCRIPTHUB_BETA_PUBLIC_PATH || "/shb-REPLACE_ME");
const scriptHubBaseUrl = process.env.SCRIPTHUB_BASE_URL || "";
const scriptHubBetaBaseUrl = process.env.SCRIPTHUB_BETA_BASE_URL || "";
const scriptHubTimeoutMs = positiveNumber(process.env.SCRIPTHUB_UPSTREAM_TIMEOUT_MS, upstreamTimeoutMs);
const scriptHubMaxBodyBytes = positiveNumber(process.env.SCRIPTHUB_MAX_BODY_BYTES, 16 * 1024 * 1024);
// Stratus 会执行脚本代码, 给放行通道加并发上限做纵深防御(0=不限)。
const scriptHubMaxConcurrent = positiveNumber(process.env.SCRIPTHUB_MAX_CONCURRENT, 16);
// 内置默认前缀(公开仓库可见); 仍在用默认值时启动期会发安全告警。
const scriptHubDefaultPath = "/sh-REPLACE_ME";
const scriptHubDefaultBetaPath = "/shb-REPLACE_ME";
const scriptHubTargets = [];
if (scriptHubEnabled && scriptHubPath) {
  scriptHubTargets.push({ prefix: scriptHubPath, port: scriptHubPort, label: "stable", baseUrl: scriptHubBaseUrl });
}
if (scriptHubEnabled && scriptHubBetaEnabled && scriptHubBetaPath && scriptHubBetaPath !== scriptHubPath) {
  scriptHubTargets.push({ prefix: scriptHubBetaPath, port: scriptHubBetaPort, label: "beta", baseUrl: scriptHubBetaBaseUrl });
}

let activeApiRequests = 0;
let activeScriptHubRequests = 0;
let activeJobs = 0;
let cachedHealth = null;
let cachedHealthAt = 0;
const jobs = new Map();
const jobQueue = [];

function nowIso() {
  return new Date().toISOString();
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBackendPath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

// Sub-path mount prefix: leading slash, no trailing slash (e.g. "/cloud"). Empty = root.
function normalizeMountPrefix(value) {
  let p = String(value || "").trim();
  if (!p || p === "/") return "";
  if (!p.startsWith("/")) p = `/${p}`;
  return p.replace(/\/+$/, "");
}

// Prefix a root-relative location/path with the mount prefix (no-op when unmounted).
function withMountPrefix(location) {
  if (!mountPrefix) return location;
  if (typeof location !== "string" || !location.startsWith("/")) return location;
  return `${mountPrefix}${location}`;
}

// Strip the mount prefix off an incoming request URL so all downstream routing/upstream
// logic operates on a root-relative path. Returns the normalized URL.
function stripMountPrefix(rawUrl) {
  if (!mountPrefix) return rawUrl;
  const u = rawUrl || "/";
  if (u === mountPrefix) return "/";
  if (u.startsWith(`${mountPrefix}/`)) return u.slice(mountPrefix.length);
  if (u.startsWith(`${mountPrefix}?`)) return `/${u.slice(mountPrefix.length)}`;
  return u; // not under the prefix (shouldn't happen via the front proxy) — leave as-is
}

function randomPassword() {
  return crypto.randomBytes(15).toString("base64url");
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("base64url");
}

function initialPasswordFingerprint(password) {
  if (!password) return "";
  return crypto.createHash("sha256").update(`cloudspace-access-initial-password:${password}`).digest("base64url");
}

function sign(secret, value) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function makeConfig(password, existing = {}, options = {}) {
  const passwordSalt = crypto.randomBytes(16).toString("base64url");
  return {
    version: 1,
    createdAt: existing.createdAt || nowIso(),
    updatedAt: nowIso(),
    passwordSalt,
    passwordHash: hashPassword(password, passwordSalt),
    sessionSecret: crypto.randomBytes(32).toString("base64url"),
    initialPasswordFingerprint: options.initialPasswordFingerprint || existing.initialPasswordFingerprint || ""
  };
}

function loadConfig() {
  const initialFingerprint = initialPasswordFingerprint(initialPassword);
  if (fs.existsSync(dataPath)) {
    const parsed = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    if (parsed && parsed.passwordHash && parsed.passwordSalt && parsed.sessionSecret) {
      if (initialPassword && parsed.initialPasswordFingerprint !== initialFingerprint) {
        const updated = makeConfig(initialPassword, parsed, { initialPasswordFingerprint: initialFingerprint });
        atomicWriteJson(dataPath, updated);
        console.log("[CLOUDSPACE ACCESS] Password reset from updated ACCESS_LOCK_INITIAL_PASSWORD.");
        return updated;
      }
      return parsed;
    }
  }

  const password = initialPassword || randomPassword();
  const config = makeConfig(password, {}, { initialPasswordFingerprint: initialFingerprint });
  atomicWriteJson(dataPath, config);

  if (initialPassword) {
    console.log("[CLOUDSPACE ACCESS] Initial password loaded from ACCESS_LOCK_INITIAL_PASSWORD.");
  } else {
    console.log(`[CLOUDSPACE ACCESS] Generated initial password: ${password}`);
    console.log("[CLOUDSPACE ACCESS] Change it from /__lock after logging in.");
  }

  return config;
}

let config = enabled ? loadConfig() : null;

function verifyPassword(password) {
  if (!config) return true;
  return safeEqual(hashPassword(password, config.passwordSalt), config.passwordHash);
}

function makeToken() {
  const payload = "access";
  return `${payload}.${sign(config.sessionSecret, payload)}`;
}

function verifyToken(token) {
  if (!config || !token) return false;
  const [payload, signature] = String(token).split(".");
  if (payload !== "access" || !signature) return false;
  return safeEqual(sign(config.sessionSecret, payload), signature);
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function isAuthenticated(req) {
  if (!enabled) return true;
  return verifyToken(parseCookies(req)[cookieName]);
}

function cookieOptions(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  const forwardedHost = String(req.headers["x-forwarded-host"] || req.headers.host || "").toLowerCase();
  const secure = forwardedProto === "https" || req.socket.encrypted || forwardedHost.endsWith(".hf.space");
  const configuredSameSite = String(process.env.ACCESS_LOCK_COOKIE_SAMESITE || "").trim().toLowerCase();
  const sameSite = configuredSameSite || (secure ? "none" : "lax");
  const normalizedSameSite = sameSite === "none" ? "None" : sameSite === "strict" ? "Strict" : "Lax";
  return `Path=/; HttpOnly; SameSite=${normalizedSameSite}${secure || normalizedSameSite === "None" ? "; Secure" : ""}`;
}

function setAuthCookie(res, req) {
  res.setHeader("Set-Cookie", `${cookieName}=${encodeURIComponent(makeToken())}; ${cookieOptions(req)}`);
}

function clearAuthCookie(res, req) {
  res.setHeader("Set-Cookie", `${cookieName}=; Max-Age=0; ${cookieOptions(req)}`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[ch]);
}

function htmlPage(req, message = "") {
  const loggedIn = isAuthenticated(req);
  const base = mountPrefix; // browser-facing form actions/links live under the mount prefix
  const next = new URL(req.url, "http://local").searchParams.get("next") || "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(productName)} Access</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #101820; color: #eef4f8; }
    main { width: min(420px, calc(100vw - 32px)); border: 1px solid rgba(255,255,255,.16); border-radius: 8px; padding: 24px; background: #17232d; box-shadow: 0 16px 50px rgba(0,0,0,.28); }
    h1 { margin: 0 0 16px; font-size: 22px; font-weight: 650; letter-spacing: 0; }
    p { margin: 0 0 16px; color: #b9c7d1; line-height: 1.5; }
    form { display: grid; gap: 12px; margin: 16px 0 0; }
    label { display: grid; gap: 6px; color: #d8e2e9; font-size: 14px; }
    input { min-height: 40px; border-radius: 6px; border: 1px solid rgba(255,255,255,.18); background: #0d141b; color: #fff; padding: 0 12px; font-size: 16px; }
    button, a.button { min-height: 40px; border: 0; border-radius: 6px; padding: 0 14px; background: #48c6a8; color: #08110f; font-weight: 700; cursor: pointer; text-decoration: none; display: inline-grid; place-items: center; }
    .secondary { background: #243543; color: #eef4f8; }
    .message { padding: 10px 12px; border-radius: 6px; background: rgba(72,198,168,.14); color: #b9ffe8; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; }
    hr { border: 0; border-top: 1px solid rgba(255,255,255,.14); margin: 22px 0; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(productName)} Access</h1>
    ${message ? `<p class="message">${escapeHtml(message)}</p>` : ""}
    ${loggedIn ? `
      <p>Access is unlocked. You can open ${escapeHtml(productName)} or change the access password here.</p>
      <div class="row">
        <a class="button" href="${base}/">Open ${escapeHtml(productName)}</a>
        <form method="post" action="${base}/__lock/logout"><button class="secondary" type="submit">Sign out</button></form>
      </div>
      <hr>
      <form method="post" action="${base}/__lock/password">
        <label>Current password<input name="currentPassword" type="password" autocomplete="current-password" required></label>
        <label>New password<input name="newPassword" type="password" autocomplete="new-password" minlength="8" required></label>
        <label>Confirm new password<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required></label>
        <button type="submit">Update password</button>
      </form>
    ` : `
      <p>Enter the access password to continue.</p>
      <form method="post" action="${base}/__lock/login">
        <input type="hidden" name="next" value="${escapeHtml(safeNext)}">
        <label>Access password<input name="password" type="password" autocomplete="current-password" autofocus required></label>
        <button type="submit">Unlock</button>
      </form>
    `}
  </main>
</body>
</html>`;
}

function sendHtml(res, status, body) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

function sendJson(res, status, value) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

// ---- Pre-login cover (石头海浪封面): public static assets + templated /__lock/login ----
const COVER_DIR = path.join(__dirname, "cover");
const COVER_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};
let coverTemplateCache = null;
// Load login.html once, rewriting its root-absolute paths for the sub-path mount: the cover
// bundle <script src="/cover/..."> and the password form action="/__lock/login" both live
// under the mount prefix that claw forwards here (mirrors htmlPage's `base = mountPrefix`).
// The hidden `next` value stays root-relative (the POST handler re-prefixes it via
// withMountPrefix). No-op at root. Drift-detecting: a login.html that drops these anchors
// warns loudly so an upstream cover change is caught instead of shipping a white screen.
function loadCoverTemplate() {
  if (coverTemplateCache != null) return coverTemplateCache;
  let tpl = fs.readFileSync(path.join(COVER_DIR, "login.html"), "utf8");
  if (mountPrefix) {
    const hadCoverSrc = tpl.includes('src="/cover/');
    const hadLockAction = tpl.includes('action="/__lock/');
    tpl = tpl
      .split('src="/cover/').join(`src="${mountPrefix}/cover/`)
      .split('action="/__lock/').join(`action="${mountPrefix}/__lock/`);
    if (!hadCoverSrc || !hadLockAction) {
      console.warn(
        `[CLOUDSPACE ACCESS] cover login.html sub-path anchors missing ` +
        `(bundle src=${hadCoverSrc}, lock form action=${hadLockAction}); the ocean cover may ` +
        `break under the "${mountPrefix}" mount — re-check cover/login.html paths.`
      );
    }
  }
  coverTemplateCache = tpl;
  return coverTemplateCache;
}
// Returns the templated cover login HTML, or null if the cover assets are absent
// (so callers can fall back to the plain htmlPage lock screen).
function renderCover(message, next) {
  if (!coverEnabled) return null;
  let tpl;
  try {
    tpl = loadCoverTemplate();
  } catch (_) {
    return null;
  }
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return tpl
    .split("__CLOUDSPACE_NEXT__").join(escapeHtml(safeNext))
    .split("__CLOUDSPACE_MESSAGE__").join(escapeHtml(message || ""));
}
// The cover bundle hard-codes a single root-absolute ASSET_BASE ("/cover/assets") from which
// every 3D asset URL (glb / waternormals / draco / basis) is derived. Under a sub-path mount
// rewrite it to "<mountPrefix>/cover/assets" so those fetches resolve through the prefix claw
// forwards here; cached after first read. It is the only text asset needing this — glb/jpg/
// wasm are binary and served byte-for-byte. Drift-detecting: a missing anchor warns loudly.
let coverBundleCache = null;
function readCoverBundle(file, cb) {
  if (coverBundleCache) { cb(null, coverBundleCache); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { cb(err); return; }
    let out = buf;
    if (mountPrefix) {
      const src = buf.toString("utf8");
      const anchor = "/cover/assets";
      if (src.includes(anchor)) {
        out = Buffer.from(src.split(anchor).join(`${mountPrefix}${anchor}`), "utf8");
      } else {
        console.warn(
          `[CLOUDSPACE ACCESS] cover.bundle.js ASSET_BASE anchor "${anchor}" not found; ` +
          `the ocean cover's 3D assets may 404 under the "${mountPrefix}" mount — re-check cover.src.js.`
        );
      }
    }
    coverBundleCache = out;
    cb(null, out);
  });
}
// Serve /cover/* publicly: the bundle + assets are fetched before the visitor is
// authenticated. login.html is NEVER served here — it only goes out templated via
// /__lock/login, so the raw __CLOUDSPACE_*__ placeholders never leak.
function handleCoverRoute(req, res) {
  if (!["GET", "HEAD"].includes(req.method)) return false;
  const pathname = new URL(req.url, "http://local").pathname;
  if (!pathname.startsWith("/cover/")) return false;
  let rel;
  try { rel = decodeURIComponent(pathname.slice("/cover/".length)); } catch (_) { rel = ""; }
  if (!rel || rel.includes("\0") || rel.endsWith("login.html")) { res.writeHead(404); res.end(); return true; }
  const file = path.normalize(path.join(COVER_DIR, rel));
  if (file !== COVER_DIR && !file.startsWith(COVER_DIR + path.sep)) { res.writeHead(403); res.end(); return true; }
  const send = (err, buf) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {
      "content-type": COVER_MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "public, max-age=604800, immutable"
    });
    if (req.method === "HEAD") { res.end(); return; }
    res.end(buf);
  };
  // cover.bundle.js needs the sub-path ASSET_BASE rewrite; everything else is served as-is.
  if (path.basename(file) === "cover.bundle.js") readCoverBundle(file, send);
  else fs.readFile(file, send);
  return true;
}

function safeJobId(value) {
  const id = String(value || "");
  return /^[a-zA-Z0-9_-]{8,80}$/.test(id) ? id : "";
}

function jobMetaFile(id) {
  return path.join(jobStoreDir, `${id}.json`);
}

function jobResultFile(id) {
  return path.join(jobStoreDir, `${id}.body`);
}

function ensureJobStore() {
  if (!jobEnabled) return;
  fs.mkdirSync(jobStoreDir, { recursive: true });
  for (const entry of fs.readdirSync(jobStoreDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const job = JSON.parse(fs.readFileSync(path.join(jobStoreDir, entry.name), "utf8"));
      if (!safeJobId(job.id)) continue;
      if (["queued", "running"].includes(job.status)) {
        job.status = "aborted";
        job.finishedAt = nowIso();
        job.error = "Gateway restarted before this job finished.";
        writeJob(job);
      }
      jobs.set(job.id, job);
    } catch (_) {}
  }
  cleanupOldJobs();
}

function writeJob(job) {
  if (!jobEnabled) return;
  fs.mkdirSync(jobStoreDir, { recursive: true });
  atomicWriteJson(jobMetaFile(job.id), job);
}

function deleteJob(id) {
  jobs.delete(id);
  for (const file of [jobMetaFile(id), jobResultFile(id)]) {
    try {
      fs.unlinkSync(file);
    } catch (_) {}
  }
}

function cleanupOldJobs() {
  if (!jobEnabled || jobRetentionMs <= 0) return;
  const cutoff = Date.now() - jobRetentionMs;
  for (const [id, job] of jobs.entries()) {
    if (["queued", "running"].includes(job.status)) continue;
    const finished = Date.parse(job.finishedAt || job.updatedAt || job.createdAt || 0);
    if (Number.isFinite(finished) && finished > 0 && finished < cutoff) deleteJob(id);
  }
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    ok: job.ok,
    method: job.method,
    path: job.path,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    statusCode: job.statusCode,
    responseBytes: job.responseBytes,
    error: job.error,
    resultUrl: job.status === "succeeded" || job.status === "failed_with_response" ? `${cloudspaceJobsPath}/${job.id}/result` : undefined
  };
}

function readRequestBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (maxBytes > 0 && total > maxBytes) {
        reject(new Error(`request body too large; max ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJsonBuffer(buffer) {
  if (!buffer || buffer.length === 0) return {};
  return JSON.parse(buffer.toString("utf8"));
}

function jobBodyBuffer(payload, headers) {
  if (typeof payload.bodyBase64 === "string") {
    return Buffer.from(payload.bodyBase64, "base64");
  }
  if (payload.body === undefined || payload.body === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(payload.body)) return payload.body;
  if (typeof payload.body === "string") {
    if (payload.bodyEncoding === "base64") return Buffer.from(payload.body, "base64");
    if (!headers["content-type"]) headers["content-type"] = "text/plain; charset=utf-8";
    return Buffer.from(payload.body, "utf8");
  }
  if (!headers["content-type"]) headers["content-type"] = "application/json";
  return Buffer.from(JSON.stringify(payload.body), "utf8");
}

function cleanJobHeaders(inputHeaders) {
  const out = {};
  const headers = inputHeaders && typeof inputHeaders === "object" ? inputHeaders : {};
  const blocked = new Set(["connection", "content-length", "cookie", "host", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "authorization"]);
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = String(rawName).toLowerCase();
    if (blocked.has(name)) continue;
    if (rawValue === undefined || rawValue === null) continue;
    out[name] = Array.isArray(rawValue) ? rawValue.map(String).join(", ") : String(rawValue);
  }
  return out;
}

function makeJob(payload) {
  const method = String(payload.method || "POST").toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    throw new Error(`Unsupported job method: ${method}`);
  }
  const rawPath = String(payload.path || "");
  if (!isApiPath(new URL(rawPath, "http://local").pathname)) {
    throw new Error("CloudSpace jobs may only target /api routes.");
  }
  const headers = cleanJobHeaders(payload.headers);
  const body = jobBodyBuffer(payload, headers);
  if (jobMaxBodyBytes > 0 && body.length > jobMaxBodyBytes) {
    throw new Error(`Job body too large; max ${jobMaxBodyBytes} bytes.`);
  }
  if (body.length > 0) headers["content-length"] = String(body.length);
  const id = crypto.randomBytes(12).toString("base64url");
  return {
    id,
    status: "queued",
    ok: false,
    method,
    path: rawPath,
    headers,
    bodyBase64: body.toString("base64"),
    bodyBytes: body.length,
    timeoutMs: positiveNumber(payload.timeoutMs, jobTimeoutMs),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function enqueueJob(job) {
  if (jobQueue.length >= jobMaxQueue) {
    throw new Error(`${productName} job queue is full; retry shortly.`);
  }
  jobs.set(job.id, job);
  jobQueue.push(job.id);
  writeJob(job);
  pumpJobQueue();
  return job;
}

function pumpJobQueue() {
  if (!jobEnabled) return;
  while (activeJobs < jobMaxConcurrent && jobQueue.length > 0) {
    const id = jobQueue.shift();
    const job = jobs.get(id);
    if (!job || job.status !== "queued") continue;
    activeJobs += 1;
    runJob(job).finally(() => {
      activeJobs = Math.max(0, activeJobs - 1);
      pumpJobQueue();
    });
  }
}

function runJob(job) {
  job.status = "running";
  job.startedAt = nowIso();
  job.updatedAt = job.startedAt;
  writeJob(job);

  return executeJobRequest(job)
    .then((result) => {
      fs.writeFileSync(jobResultFile(job.id), result.body);
      job.statusCode = result.statusCode;
      job.responseBytes = result.body.length;
      job.responseHeaders = result.headers;
      job.ok = result.statusCode >= 200 && result.statusCode < 400;
      job.status = job.ok ? "succeeded" : "failed_with_response";
      job.finishedAt = nowIso();
      job.updatedAt = job.finishedAt;
      delete job.bodyBase64;
      writeJob(job);
    })
    .catch((error) => {
      job.status = "failed";
      job.ok = false;
      job.error = error.message;
      job.finishedAt = nowIso();
      job.updatedAt = job.finishedAt;
      delete job.bodyBase64;
      writeJob(job);
    });
}

function executeJobRequest(job) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(job.bodyBase64 || "", "base64");
    const options = {
      hostname: upstreamHost,
      port: upstreamPort,
      method: job.method,
      path: upstreamPath(job.path),
      headers: {
        ...job.headers,
        host: `${upstreamHost}:${upstreamPort}`
      }
    };
    const upstreamReq = http.request(options, (upstreamRes) => {
      const chunks = [];
      let total = 0;
      upstreamRes.on("data", (chunk) => {
        total += chunk.length;
        if (jobResultMaxBytes > 0 && total > jobResultMaxBytes) {
          upstreamReq.destroy(new Error(`job response too large; max ${jobResultMaxBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      upstreamRes.on("end", () => {
        const headers = { ...upstreamRes.headers };
        delete headers["transfer-encoding"];
        resolve({ statusCode: upstreamRes.statusCode || 502, headers, body: Buffer.concat(chunks) });
      });
    });
    upstreamReq.setTimeout(job.timeoutMs, () => upstreamReq.destroy(new Error(`job upstream timeout after ${job.timeoutMs} ms`)));
    upstreamReq.on("error", reject);
    upstreamReq.end(body);
  });
}

function handleJobsRoute(req, res, url) {
  if (!url.pathname.startsWith(cloudspaceJobsPath)) return false;
  if (!jobEnabled) {
    sendJson(res, 404, { error: "jobs_disabled" });
    return true;
  }
  if (enabled && !isAuthenticated(req)) {
    sendJson(res, 401, { error: "locked" });
    return true;
  }

  cleanupOldJobs();
  const suffix = url.pathname.slice(cloudspaceJobsPath.length).replace(/^\/+/, "");
  const parts = suffix ? suffix.split("/") : [];

  if (req.method === "GET" && parts.length === 0) {
    const values = Array.from(jobs.values())
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 100)
      .map(publicJob);
    sendJson(res, 200, {
      productName,
      enabled: jobEnabled,
      active: activeJobs,
      queued: jobQueue.length,
      maxConcurrent: jobMaxConcurrent,
      maxQueue: jobMaxQueue,
      maxBodyBytes: jobMaxBodyBytes,
      resultMaxBytes: jobResultMaxBytes,
      jobs: values
    });
    return true;
  }

  if (req.method === "POST" && (parts.length === 0 || (parts.length === 1 && parts[0] === "api"))) {
    readRequestBuffer(req, jobMaxBodyBytes)
      .then(parseJsonBuffer)
      .then((payload) => enqueueJob(makeJob(payload)))
      .then((job) => sendJson(res, 202, { job: publicJob(job) }))
      .catch((error) => sendJson(res, error.message.includes("queue is full") ? 429 : 400, { error: "job_rejected", message: error.message }));
    return true;
  }

  const id = safeJobId(parts[0]);
  if (!id) {
    sendJson(res, 404, { error: "job_not_found" });
    return true;
  }
  const job = jobs.get(id);
  if (!job) {
    sendJson(res, 404, { error: "job_not_found" });
    return true;
  }

  if (req.method === "GET" && parts.length === 1) {
    sendJson(res, 200, { job: publicJob(job) });
    return true;
  }

  if (req.method === "GET" && parts.length === 2 && parts[1] === "result") {
    if (!fs.existsSync(jobResultFile(id))) {
      sendJson(res, 404, { error: "job_result_not_ready", job: publicJob(job) });
      return true;
    }
    const headers = { ...(job.responseHeaders || {}) };
    applyCacheHeaders(headers, "no-store");
    headers["content-length"] = String(fs.statSync(jobResultFile(id)).size);
    res.writeHead(job.statusCode || 200, headers);
    fs.createReadStream(jobResultFile(id)).pipe(res);
    return true;
  }

  if (req.method === "DELETE" && parts.length === 1) {
    if (["queued", "running"].includes(job.status)) {
      sendJson(res, 409, { error: "job_active", message: "Active jobs cannot be deleted." });
      return true;
    }
    deleteJob(id);
    sendJson(res, 200, { ok: true, deleted: id });
    return true;
  }

  sendJson(res, 404, { error: "job_not_found" });
  return true;
}

function redirect(res, location) {
  res.writeHead(303, { location: withMountPrefix(location), "cache-control": "no-store" });
  res.end();
}

function readForm(req, callback) {
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 65536) req.destroy();
  });
  req.on("end", () => callback(new URLSearchParams(body)));
}

function handleLockRoute(req, res) {
  const url = new URL(req.url, "http://local");

  if (req.method === "GET" && (url.pathname === "/__lock" || url.pathname === "/__lock/")) {
    sendHtml(res, 200, htmlPage(req));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/__lock/login") {
    if (isAuthenticated(req)) {
      sendHtml(res, 200, htmlPage(req));
    } else {
      const cover = renderCover("", url.searchParams.get("next") || "/");
      sendHtml(res, 200, cover != null ? cover : htmlPage(req));
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/__lock/status") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ authenticated: isAuthenticated(req), enabled }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/__lock/login") {
    readForm(req, (form) => {
      const next = form.get("next") || "/";
      if (!verifyPassword(form.get("password") || "")) {
        const cover = renderCover("Password is incorrect.", next);
        sendHtml(res, 401, cover != null ? cover : htmlPage(req, "Password is incorrect."));
        return;
      }
      setAuthCookie(res, req);
      redirect(res, next.startsWith("/") && !next.startsWith("//") ? next : "/");
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/__lock/logout") {
    clearAuthCookie(res, req);
    redirect(res, "/__lock/login");
    return true;
  }

  if (req.method === "POST" && url.pathname === "/__lock/password") {
    if (!isAuthenticated(req)) {
      redirect(res, `/__lock/login?next=${encodeURIComponent("/__lock")}`);
      return true;
    }
    readForm(req, (form) => {
      const currentPassword = form.get("currentPassword") || "";
      const newPassword = form.get("newPassword") || "";
      const confirmPassword = form.get("confirmPassword") || "";
      if (!verifyPassword(currentPassword)) {
        sendHtml(res, 400, htmlPage(req, "Current password is incorrect."));
        return;
      }
      if (newPassword.length < 8) {
        sendHtml(res, 400, htmlPage(req, "New password must be at least 8 characters."));
        return;
      }
      if (newPassword !== confirmPassword) {
        sendHtml(res, 400, htmlPage(req, "New password confirmation does not match."));
        return;
      }
      const passwordSalt = crypto.randomBytes(16).toString("base64url");
      config = {
        ...config,
        updatedAt: nowIso(),
        passwordSalt,
        passwordHash: hashPassword(newPassword, passwordSalt),
        sessionSecret: crypto.randomBytes(32).toString("base64url")
      };
      atomicWriteJson(dataPath, config);
      setAuthCookie(res, req);
      sendHtml(res, 200, htmlPage(req, "Password updated."));
    });
    return true;
  }

  return false;
}

function wantsHtml(req) {
  const accept = String(req.headers.accept || "");
  return accept.includes("text/html");
}

function isFrontendDocumentPath(pathname) {
  if (!pathname || pathname === "/") return true;
  if (pathname.startsWith("/__lock") || pathname.startsWith("/__cloudspace") || isApiPath(pathname)) return false;
  const basename = pathname.split("/").pop() || "";
  return !basename.includes(".") || basename.endsWith(".html") || basename.endsWith(".htm");
}

function isBrowserNavigation(req, url) {
  if (!["GET", "HEAD"].includes(req.method)) return false;
  const fetchMode = String(req.headers["sec-fetch-mode"] || "").toLowerCase();
  const fetchDest = String(req.headers["sec-fetch-dest"] || "").toLowerCase();
  return fetchMode === "navigate" || ["document", "iframe", "frame"].includes(fetchDest) || wantsHtml(req) || isFrontendDocumentPath(url.pathname);
}

function unauthorized(req, res) {
  const url = new URL(req.url, "http://local");
  if (isBrowserNavigation(req, url)) {
    redirect(res, `/__lock/login?next=${encodeURIComponent(req.url || "/")}`);
  } else {
    sendJson(res, 401, { error: "locked" });
  }
}

function protectCloudspaceRoute(req, res) {
  if (!enabled || isAuthenticated(req)) return false;
  const url = new URL(req.url, "http://local");
  if (!url.pathname.startsWith("/__cloudspace")) return false;
  if (publicHealthEnabled && req.method === "GET" && url.pathname === cloudspaceHealthPath) return false;
  unauthorized(req, res);
  return true;
}

function cleanHeaders(headers) {
  const out = { ...headers };
  for (const name of ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]) {
    delete out[name];
  }
  out.host = `${upstreamHost}:${upstreamPort}`;
  return out;
}

function isDownloadPath(rawPath) {
  return rawPath === "/download" || rawPath.startsWith("/download/") || rawPath.startsWith("/download?");
}

function upstreamPath(rawPath) {
  if (backendPath && (rawPath === "/api" || rawPath.startsWith("/api/") || rawPath.startsWith("/api?") || isDownloadPath(rawPath))) {
    return `${backendPath}${rawPath}`;
  }
  return rawPath;
}

function isApiPath(rawPath) {
  return rawPath === "/api" || rawPath.startsWith("/api/") || rawPath.startsWith("/api?");
}

function routeKind(req) {
  const url = new URL(req.url, "http://local");
  if (url.pathname.startsWith("/__lock")) return "lock";
  if (url.pathname.startsWith("/__cloudspace")) return "cloudspace";
  if (isApiPath(url.pathname)) return "api";
  return "frontend";
}

function cloudspaceConfig() {
  return {
    productName,
    backend: {
      // Browser-facing API base. Under a sub-path mount this is "<mountPrefix>/" so any
      // consumer that derives an API base from it targets "<mountPrefix>/api" (which the front
      // proxy forwards back here), not the site root. (The Sub-Store front-end itself pins its
      // axios baseURL via localStorage.hostAPI — see frontendBootstrapScript + the build-time
      // hostAPI pin in scripts/frontend-subpath.js — this keeps the self-describing config
      // accurate for any other consumer under the mount.)
      apiBase: withMountPrefix("/"),
      sameOrigin: true
    },
    access: {
      model: "one-password-same-origin",
      login: withMountPrefix("/__lock/login"),
      password: withMountPrefix("/__lock")
    },
    routes: {
      lock: withMountPrefix("/__lock"),
      health: withMountPrefix(cloudspaceHealthPath),
      config: withMountPrefix(cloudspaceConfigPath),
      api: withMountPrefix("/api"),
      jobs: withMountPrefix(cloudspaceJobsPath)
    },
    cirrus: {
      enabled: httpMetaEnabled,
      host: "127.0.0.1",
      port: httpMetaPort
    },
    jobs: {
      enabled: jobEnabled,
      maxConcurrent: jobMaxConcurrent,
      maxQueue: jobMaxQueue,
      maxBodyBytes: jobMaxBodyBytes,
      resultMaxBytes: jobResultMaxBytes
    },
    stratus: {
      enabled: scriptHubEnabled,
      betaEnabled: scriptHubBetaEnabled,
      routes: scriptHubTargets.map((t) => ({
        label: t.label,
        path: t.prefix,
        baseUrl: t.baseUrl || undefined
      }))
    }
  };
}

function healthProbe(options) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const req = http.request(options, (res) => {
      res.resume();
      res.on("end", () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 500, statusCode: res.statusCode, ms: Date.now() - startedAt });
      });
    });
    req.setTimeout(healthTimeoutMs, () => req.destroy(new Error(`timeout after ${healthTimeoutMs} ms`)));
    req.on("error", (error) => resolve({ ok: false, error: error.message, ms: Date.now() - startedAt }));
    req.end();
  });
}

async function buildHealth() {
  const now = Date.now();
  if (cachedHealth && now - cachedHealthAt < healthCacheMs) return cachedHealth;

  const [core, httpMeta, scriptHub] = await Promise.all([
    healthProbe({
      hostname: upstreamHost,
      port: upstreamPort,
      method: "GET",
      path: `${backendPath}/api/utils/env`
    }),
    httpMetaEnabled
      ? healthProbe({
          hostname: httpMetaHost,
          port: httpMetaPort,
          method: "GET",
          path: "/test"
        })
      : Promise.resolve({ ok: true, disabled: true }),
    scriptHubTargets.length
      ? healthProbe({
          hostname: scriptHubHost,
          port: scriptHubPort,
          method: "GET",
          path: "/"
        })
      : Promise.resolve({ ok: true, disabled: true })
  ]);

  const value = {
    productName,
    ok: Boolean(core.ok && httpMeta.ok),
    timestamp: nowIso(),
    gateway: {
      ok: true,
      routeModel: "single-container-unified-access-gateway",
      accessModel: "one-password-same-origin",
      uptimeSeconds: Math.round(process.uptime())
    },
    access: {
      enabled,
      authenticatedSessions: "cookie"
    },
    api: {
      ok: core.ok,
      active: activeApiRequests,
      maxConcurrent: apiMaxConcurrent,
      maxBodyBytes: apiMaxBodyBytes,
      upstream: `${upstreamHost}:${upstreamPort}`,
      probe: core
    },
    jobs: {
      enabled: jobEnabled,
      active: activeJobs,
      queued: jobQueue.length,
      maxConcurrent: jobMaxConcurrent,
      maxQueue: jobMaxQueue,
      maxBodyBytes: jobMaxBodyBytes,
      resultMaxBytes: jobResultMaxBytes
    },
    cirrus: {
      ok: httpMeta.ok,
      enabled: httpMetaEnabled,
      upstream: `${httpMetaHost}:${httpMetaPort}`,
      probe: httpMeta
    },
    stratus: {
      ok: scriptHub.ok,
      enabled: scriptHubEnabled,
      betaEnabled: scriptHubBetaEnabled,
      active: activeScriptHubRequests,
      maxConcurrent: scriptHubMaxConcurrent,
      routes: scriptHubTargets.map((t) => ({ label: t.label, upstream: `${scriptHubHost}:${t.port}` })),
      probe: scriptHub
    }
  };
  cachedHealth = value;
  cachedHealthAt = now;
  return value;
}

function handleCloudspaceRoute(req, res) {
  const url = new URL(req.url, "http://local");
  if (handleJobsRoute(req, res, url)) return true;

  if (req.method === "GET" && url.pathname === cloudspaceConfigPath) {
    sendJson(res, 200, cloudspaceConfig());
    return true;
  }

  if (req.method === "GET" && url.pathname === cloudspaceHealthPath) {
    buildHealth()
      .then((health) => sendJson(res, health.ok ? 200 : 503, health))
      .catch((error) => sendJson(res, 503, { ok: false, error: error.message, timestamp: nowIso() }));
    return true;
  }

  return false;
}

function frontendBootstrapScript() {
  const apiName = `${productName} Local`;
  // Same-origin backend base. Under a sub-path mount this is "${mountPrefix}/" so the
  // frontend (which sets axios baseURL = api.url with the trailing slash stripped, then
  // combines it with leading-slash paths like "/api/subs") issues requests to
  // "${mountPrefix}/api/..." — which the front proxy forwards back here.
  const hostApiUrl = mountPrefix ? `${mountPrefix}/` : "/";
  // 上游名以 base64 承载，避免明文真名出现在对外注入脚本里（查看页面源码只见编码串，不见真名）。
  const enc = (s) => Buffer.from(s, "utf8").toString("base64");
  const brandPairs = [
    [enc("Sub Store"), productName],
    [enc("Sub-Store"), productName],
    [enc("SubStore"), productName],
    [enc("sub-store"), "cloudspace"],
    [enc("sub.store"), "cloudspace.local"]
  ];
  const subDotStoreEnc = enc("sub.store");
  return `<script>
(() => {
  try {
    const desiredHostAPI = { current: ${JSON.stringify(apiName)}, apis: [{ name: ${JSON.stringify(apiName)}, url: ${JSON.stringify(hostApiUrl)} }] };
    const desiredHostAPIValue = JSON.stringify(desiredHostAPI);
    const cloudspaceName = ${JSON.stringify(productName)};
    const __dec = (b) => { try { return decodeURIComponent(escape(atob(b))); } catch (_) { try { return atob(b); } catch (__) { return ""; } } };
    const __bp = ${JSON.stringify(brandPairs)};
    const brandValue = (value) => { let s = String(value || ""); for (const p of __bp) { const from = __dec(p[0]); if (from) s = s.split(from).join(p[1]); } return s; };
    const syncCloudspaceBackend = () => {
      Storage.prototype.setItem.call(localStorage, "hostAPI", desiredHostAPIValue);
      Storage.prototype.setItem.call(localStorage, "backendConfigured", "true");
      Storage.prototype.setItem.call(localStorage, "magicPathConfigured", "true");
    };
    const shouldRewriteHostAPI = (value) => {
      try {
        const parsed = JSON.parse(value || "{}");
        if (!parsed.current || !Array.isArray(parsed.apis) || parsed.apis.length === 0) return true;
        return JSON.stringify(parsed).includes(__dec(${JSON.stringify(subDotStoreEnc)}));
      } catch (_) {
        return true;
      }
    };
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    const originalClear = Storage.prototype.clear;
    Storage.prototype.setItem = function (key, value) {
      if (key === "hostAPI" && shouldRewriteHostAPI(value)) value = desiredHostAPIValue;
      if (typeof value === "string") value = brandValue(value);
      return originalSetItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (this === localStorage && ["hostAPI", "backendConfigured", "magicPathConfigured"].includes(key)) {
        setTimeout(syncCloudspaceBackend, 0);
      }
      return originalRemoveItem.call(this, key);
    };
    Storage.prototype.clear = function () {
      const result = originalClear.call(this);
      if (this === localStorage) setTimeout(syncCloudspaceBackend, 0);
      return result;
    };
    syncCloudspaceBackend();
    window.addEventListener("storage", syncCloudspaceBackend);
    document.addEventListener("DOMContentLoaded", syncCloudspaceBackend);
    const brandAttributes = ["title", "aria-label", "placeholder", "alt", "value"];
    const brandNode = (root) => {
      if (!root || root.nodeType === Node.COMMENT_NODE) return;
      if (root.nodeType === Node.TEXT_NODE) {
        const next = brandValue(root.nodeValue);
        if (next !== root.nodeValue) root.nodeValue = next;
        return;
      }
      if (!root.querySelectorAll) return;
      const elements = [root, ...root.querySelectorAll("*")];
      for (const element of elements) {
        if (["SCRIPT", "STYLE", "TEXTAREA"].includes(element.tagName)) continue;
        for (const attr of brandAttributes) {
          if (element.hasAttribute && element.hasAttribute(attr)) {
            const current = element.getAttribute(attr);
            const next = brandValue(current);
            if (next !== current) element.setAttribute(attr, next);
          }
        }
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (parent && ["SCRIPT", "STYLE", "TEXTAREA"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const nodes = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
      for (const node of nodes) {
        const next = brandValue(node.nodeValue);
        if (next !== node.nodeValue) node.nodeValue = next;
      }
    };
    document.addEventListener("DOMContentLoaded", () => brandNode(document.body || document.documentElement));
    // Throttled, incremental branding: batch newly added subtrees and brand them when idle,
    // instead of re-walking the whole document on a 250ms timer (that froze the UI on large
    // pages, e.g. subscriptions with thousands of nodes, making buttons feel unclickable).
    let brandQueue = [];
    let brandScheduled = false;
    const scheduleIdle = window.requestIdleCallback
      ? (fn) => window.requestIdleCallback(fn, { timeout: 500 })
      : (fn) => setTimeout(fn, 50);
    const flushBrandQueue = () => {
      brandScheduled = false;
      const roots = brandQueue;
      brandQueue = [];
      for (const root of roots) {
        try { brandNode(root); } catch (_) {}
      }
    };
    const scheduleBrand = (root) => {
      if (root) brandQueue.push(root);
      if (brandScheduled) return;
      brandScheduled = true;
      scheduleIdle(flushBrandQueue);
    };
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) scheduleBrand(node);
        if (mutation.type === "characterData") scheduleBrand(mutation.target);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    // Keep the same-origin backend config pinned; no longer re-walk the whole DOM here.
    setInterval(() => {
      if (shouldRewriteHostAPI(localStorage.getItem("hostAPI")) || localStorage.getItem("backendConfigured") !== "true" || localStorage.getItem("magicPathConfigured") !== "true") {
        syncCloudspaceBackend();
      }
    }, 1000);
    document.title = ${JSON.stringify(productName)};
  } catch (_) {}
})();
</script>`;
}

function applyCloudspaceBranding(body) {
  return body
    .replaceAll("Sub Store", productName)
    .replaceAll("Sub-Store", productName)
    .replaceAll("SubStore", productName)
    .replaceAll("sub-store", "cloudspace")
    .replaceAll("sub.store", "cloudspace.local");
}

function shouldTransformFrontendResponse(req, upstreamRes) {
  if (req.method !== "GET") return false;
  const status = upstreamRes.statusCode || 200;
  if (status < 200 || status >= 300) return false;
  const contentType = String(upstreamRes.headers["content-type"] || "");
  return contentType.includes("text/html") || contentType.includes("javascript");
}

function applyCacheHeaders(headers, cacheControl) {
  if (!cacheControl || cacheControl === "pass") return headers;
  headers["cache-control"] = cacheControl;
  if (cacheControl.includes("no-store")) {
    delete headers.etag;
    delete headers["last-modified"];
  }
  return headers;
}

function responseHeaders(req, upstreamRes, options = {}) {
  const headers = { ...upstreamRes.headers };
  // Strip upstream engine identity headers (Server / X-Powered-By) so an
  // engine's own fingerprint never leaks past the brand-defense layer,
  // whatever the key casing the upstream used.
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower === "x-powered-by" || lower === "server") delete headers[key];
  }
  if (options.dropContentLength) delete headers["content-length"];
  if (options.frontend) applyCacheHeaders(headers, frontendCacheControl);
  if (isApiPath(req.url)) applyCacheHeaders(headers, apiCacheControl);
  return headers;
}

function transformFrontendBody(req, upstreamRes, body) {
  const contentType = String(upstreamRes.headers["content-type"] || "");
  if (contentType.includes("text/html")) {
    const script = frontendBootstrapScript();
    body = applyCloudspaceBranding(body);
    if (body.includes("<head>")) {
      return body.replace("<head>", `<head>${script}`);
    }
    if (body.includes("</head>")) {
      return body.replace("</head>", `${script}</head>`);
    }
    return `${script}${body}`;
  }

  if (contentType.includes("javascript")) {
    return applyCloudspaceBranding(body).replaceAll("https://cloudspace.local", "");
  }

  return body;
}

function pipeTransformedFrontend(req, res, upstreamRes) {
  const chunks = [];
  let totalBytes = 0;
  let passthrough = false;
  upstreamRes.on("data", (chunk) => {
    if (passthrough) {
      res.write(chunk);
      return;
    }

    totalBytes += chunk.length;
    if (maxFrontendTransformBytes > 0 && totalBytes > maxFrontendTransformBytes) {
      res.writeHead(upstreamRes.statusCode || 200, responseHeaders(req, upstreamRes, { frontend: true }));
      for (const buffered of chunks) res.write(buffered);
      chunks.length = 0;
      res.write(chunk);
      passthrough = true;
      return;
    }

    chunks.push(chunk);
  });
  upstreamRes.on("end", () => {
    if (passthrough) {
      res.end();
      return;
    }

    let body = Buffer.concat(chunks).toString("utf8");
    body = transformFrontendBody(req, upstreamRes, body);

    const headers = responseHeaders(req, upstreamRes, { frontend: true, dropContentLength: true });
    res.writeHead(upstreamRes.statusCode || 200, headers);
    res.end(body);
  });
}

function proxyHttp(req, res) {
  const kind = routeKind(req);
  if (kind === "api") {
    if (activeApiRequests >= apiMaxConcurrent) {
      sendJson(res, 429, {
        error: "busy",
        message: `${productName} is processing too many API requests; retry shortly.`,
        active: activeApiRequests,
        maxConcurrent: apiMaxConcurrent
      });
      return;
    }

    const contentLength = Number(req.headers["content-length"] || 0);
    if (apiMaxBodyBytes > 0 && contentLength > apiMaxBodyBytes) {
      sendJson(res, 413, { error: "request_too_large", maxBodyBytes: apiMaxBodyBytes });
      return;
    }
    activeApiRequests += 1;
  }

  let released = false;
  const release = () => {
    if (!released && kind === "api") {
      activeApiRequests = Math.max(0, activeApiRequests - 1);
      released = true;
    }
  };

  const options = {
    hostname: upstreamHost,
    port: upstreamPort,
    method: req.method,
    path: upstreamPath(req.url),
    headers: cleanHeaders(req.headers)
  };
  const upstreamReq = http.request(options, (upstreamRes) => {
    res.on("finish", release);
    res.on("close", release);
    if (shouldTransformFrontendResponse(req, upstreamRes)) {
      pipeTransformedFrontend(req, res, upstreamRes);
      return;
    }
    res.writeHead(upstreamRes.statusCode || 502, responseHeaders(req, upstreamRes));
    upstreamRes.pipe(res);
  });
  upstreamReq.setTimeout(upstreamTimeoutMs, () => {
    upstreamReq.destroy(new Error(`upstream timeout after ${upstreamTimeoutMs} ms`));
  });
  upstreamReq.on("error", (error) => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    const status = error.message.includes("upstream timeout") ? 504 : 502;
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end(`Upstream unavailable: ${error.message}\n`);
    release();
  });

  let bodyBytes = 0;
  let bodyRejected = false;
  req.on("data", (chunk) => {
    if (bodyRejected) return;
    bodyBytes += chunk.length;
    if (kind === "api" && apiMaxBodyBytes > 0 && bodyBytes > apiMaxBodyBytes) {
      bodyRejected = true;
      upstreamReq.destroy(new Error("request body too large"));
      if (!res.headersSent) sendJson(res, 413, { error: "request_too_large", maxBodyBytes: apiMaxBodyBytes });
      req.destroy();
      release();
      return;
    }
    upstreamReq.write(chunk);
  });
  req.on("end", () => {
    if (!bodyRejected) upstreamReq.end();
  });
  req.on("error", (error) => {
    upstreamReq.destroy(error);
    release();
  });
}

function matchScriptHubTarget(pathname) {
  for (const target of scriptHubTargets) {
    if (pathname === target.prefix || pathname.startsWith(`${target.prefix}/`)) {
      return target;
    }
  }
  return null;
}

function scriptHubForwardUrl(rawUrl, prefix) {
  let rest = rawUrl.slice(prefix.length);
  if (rest === "" || rest.charAt(0) === "?") rest = `/${rest}`;
  return rest;
}

function scriptHubHeaders(headers) {
  const out = { ...headers };
  for (const name of ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]) {
    delete out[name];
  }
  // 保留原始 Host, 让 Stratus 在未设置 BASE_URL 时也能拼出正确的对外链接。
  return out;
}

function proxyScriptHub(req, res, target) {
  if (scriptHubMaxConcurrent > 0 && activeScriptHubRequests >= scriptHubMaxConcurrent) {
    sendJson(res, 429, {
      error: "busy",
      message: "Stratus is processing too many requests; retry shortly.",
      active: activeScriptHubRequests,
      maxConcurrent: scriptHubMaxConcurrent
    });
    return;
  }

  activeScriptHubRequests += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeScriptHubRequests = Math.max(0, activeScriptHubRequests - 1);
  };
  res.on("finish", release);
  res.on("close", release);

  const options = {
    hostname: scriptHubHost,
    port: target.port,
    method: req.method,
    path: scriptHubForwardUrl(req.url, target.prefix),
    headers: scriptHubHeaders(req.headers)
  };
  const upstreamReq = http.request(options, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, responseHeaders(req, upstreamRes));
    upstreamRes.pipe(res);
  });
  upstreamReq.setTimeout(scriptHubTimeoutMs, () => {
    upstreamReq.destroy(new Error(`Stratus upstream timeout after ${scriptHubTimeoutMs} ms`));
  });
  upstreamReq.on("error", (error) => {
    release();
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    // 通用文案, 不回显内部 error.message。
    const status = error.message.includes("timeout") ? 504 : 502;
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end(status === 504 ? "Stratus timed out\n" : "Stratus temporarily unavailable\n");
  });

  let bodyBytes = 0;
  let bodyRejected = false;
  req.on("data", (chunk) => {
    if (bodyRejected) return;
    bodyBytes += chunk.length;
    if (scriptHubMaxBodyBytes > 0 && bodyBytes > scriptHubMaxBodyBytes) {
      bodyRejected = true;
      upstreamReq.destroy(new Error("request body too large"));
      if (!res.headersSent) sendJson(res, 413, { error: "request_too_large", maxBodyBytes: scriptHubMaxBodyBytes });
      req.destroy();
      return;
    }
    upstreamReq.write(chunk);
  });
  req.on("end", () => {
    if (!bodyRejected) upstreamReq.end();
  });
  req.on("error", (error) => upstreamReq.destroy(error));
}

function handleScriptHubRoute(req, res) {
  if (!scriptHubTargets.length) return false;
  const pathname = new URL(req.url, "http://local").pathname;
  const target = matchScriptHubTarget(pathname);
  if (!target) return false;
  proxyScriptHub(req, res, target);
  return true;
}

ensureJobStore();

const server = http.createServer((req, res) => {
  // Normalize the sub-path mount once: strip the prefix so every handler below sees a
  // root-relative URL. Outbound absolute URLs (redirects, lock form actions, hostAPI base)
  // are re-prefixed via withMountPrefix / the templates. No-op when unmounted.
  req.url = stripMountPrefix(req.url);
  if (enabled && handleLockRoute(req, res)) return;
  if (protectCloudspaceRoute(req, res)) return;
  if (handleCloudspaceRoute(req, res)) return;
  // Stratus 加密路径在访问锁之前放行, 让代理客户端无 cookie 也能拉取脚本/订阅。
  if (handleScriptHubRoute(req, res)) return;
  if (handleCoverRoute(req, res)) return;
  if (enabled && !isAuthenticated(req)) {
    const pathname = new URL(req.url, "http://local").pathname;
    // 放行订阅下载 URL: 客户端(Clash 等)无访问锁 cookie 也能拉取已发布的订阅
    if (!(isDownloadPath(pathname) && ["GET", "HEAD"].includes(req.method))) {
      unauthorized(req, res);
      return;
    }
  }
  proxyHttp(req, res);
});

server.on("upgrade", (req, socket, head) => {
  req.url = stripMountPrefix(req.url); // same sub-path normalization as HTTP requests
  if (enabled && !isAuthenticated(req)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const upstream = net.connect(upstreamPort, upstreamHost, () => {
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
    for (const [name, value] of Object.entries(req.headers)) {
      upstream.write(`${name}: ${value}\r\n`);
    }
    upstream.write("\r\n");
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
});

server.listen(listenPort, "0.0.0.0", () => {
  console.log(`[CLOUDSPACE ACCESS] ${enabled ? "enabled" : "disabled"} on 0.0.0.0:${listenPort}, upstream ${upstreamHost}:${upstreamPort}`);
  console.log(`[CLOUDSPACE ACCESS] upstream timeout ${upstreamTimeoutMs} ms, request timeout ${requestTimeoutMs} ms`);
  if (scriptHubTargets.length) {
    console.log(`[stratus] lanes: ${scriptHubTargets.map((t) => `${t.label} ${t.prefix} -> ${scriptHubHost}:${t.port}`).join(", ")} (max concurrent ${scriptHubMaxConcurrent || "unlimited"})`);
    const usingDefaultPrefix =
      scriptHubPath === scriptHubDefaultPath ||
      (scriptHubBetaEnabled && scriptHubBetaPath === scriptHubDefaultBetaPath);
    if (usingDefaultPrefix) {
      console.warn("[stratus][SECURITY] Stratus is still using a built-in default public path that is visible in the public repository. Anyone who knows it can reach this code-executing service WITHOUT the access password. Override SCRIPTHUB_PUBLIC_PATH / SCRIPTHUB_BETA_PUBLIC_PATH (and SCRIPTHUB_BASE_URL / SCRIPTHUB_BETA_BASE_URL) with your own long random values via Hugging Face Space Variables before relying on it.");
    }
  }
});

server.requestTimeout = requestTimeoutMs;
server.headersTimeout = Math.max(60000, requestTimeoutMs + 5000);
server.keepAliveTimeout = positiveNumber(process.env.ACCESS_LOCK_KEEP_ALIVE_TIMEOUT_MS, 5000);
