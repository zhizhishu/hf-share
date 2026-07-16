# CloudSpace Pre-Login Cover — Integration Guide

A self-contained WebGL landing page for the CloudSpace access lock: a glowing crystal
floating over a Three.js ocean (mouse-tracked, UnrealBloom glow, camera dolly intro).
**Clicking the crystal** gracefully reveals a password panel whose `<form>` is a real
native `POST /__lock/login`. Ported from `vertex/web/components/public/ocean-landing.tsx`,
rebranded to CloudSpace, framework-free (no React/Next), Three.js bundled locally (no CDN).

> Scope: this folder is a drop-in static product. **The gateway wiring (routes, templating)
> is yours to add in `cloudspace-access-proxy.js`.** This doc gives the exact contract,
> recommended routes, MIME/caching, and the rebuild command. Nothing here touches the proxy
> or Dockerfile.

---

## 1. Files in this folder

| File | Bytes | Role | Ship to image? |
|---|---:|---|:--:|
| `login.html` | 18,613 | The cover page **template**. Served (with placeholder substitution) at `GET /__lock/login`. | **Yes** |
| `cover.bundle.js` | 690,839 | Three.js + scene + interactions, esbuild IIFE, minified, no CDN. | **Yes** |
| `assets/intro_compressed.glb` | 697,340 | The crystal model (DRACO + KTX2/basis compressed). | **Yes** |
| `assets/waternormals.jpg` | 248,813 | Ocean normal map for `Water`. | **Yes** |
| `assets/draco/draco_decoder.wasm` | 192,420 | DRACO geometry decoder (glb requires `KHR_draco_mesh_compression`). | **Yes** |
| `assets/draco/draco_wasm_wrapper.js` | 58,572 | DRACO worker bootstrap. | **Yes** |
| `assets/basis/basis_transcoder.js` | 67,080 | KTX2/basis transcoder (glb requires `KHR_texture_basisu`). | **Yes** |
| `assets/basis/basis_transcoder.wasm` | 472,914 | KTX2/basis transcoder wasm. | **Yes** |
| `cover.src.js` | 11,434 | **Source** for the bundle. Rebuild input only. | optional |
| `build.mjs` | 1,790 | Rebuild script (esbuild). | optional |
| `README-INTEGRATION.md` | — | This doc. | no |

**Total runtime payload the browser fetches** (html + bundle + 6 assets): **~2.33 MB**
(glb is **681 KB**, well under the 3 MB worry line). All highly compressible — see §5 for caching/gzip.

**Recommended location in the image:** copy the whole folder to **`/opt/app/cover/`**, i.e.
`cover/login.html` → `/opt/app/cover/login.html`, `cover/assets/...` → `/opt/app/cover/assets/...`.
You only need the 8 "Yes" files at runtime; `cover.src.js` / `build.mjs` are build-time only.

Dockerfile add (next to the existing `COPY cloudspace-access-proxy.js ...` lines):

```dockerfile
COPY cover /opt/app/cover
```

(Or copy only the runtime files if you prefer to keep `cover.src.js`/`build.mjs` out of the image.)

---

## 2. Password form contract (this is the load-bearing part)

`login.html` contains exactly one real, no-JS-safe form:

```html
<form class="cover-form" method="post" action="/__lock/login">
  <input type="hidden" name="next" value="__CLOUDSPACE_NEXT__">
  <input ... name="password" type="password" autocomplete="current-password" required>
  <button type="submit">解锁 Unlock</button>
</form>
```

- **action** = `/__lock/login`, **method** = `post` — identical to the proxy's current login form
  (`cloudspace-access-proxy.js` `htmlPage()` / handler at `POST /__lock/login`). No backend change needed.
- Fields submitted: **`password`** and **`next`** — exactly the two fields the existing
  `POST /__lock/login` handler reads (`form.get("password")`, `form.get("next")`).
- Submit is a **native form POST** (no `fetch`), so the browser follows the proxy's
  `Set-Cookie` + 302 redirect with zero cookie/redirect edge cases.

### Two placeholders the gateway must substitute when returning the HTML

| Placeholder (literal text in `login.html`) | Replace with | Notes |
|---|---|---|
| `__CLOUDSPACE_NEXT__` | `escapeHtml(safeNext)` | `safeNext` = the proxy's already-validated next path (must start with `/`, not `//`). Sits inside `value="..."`. |
| `__CLOUDSPACE_MESSAGE__` | `escapeHtml(message)` or **`""`** when there is none | Sits inside `<p id="cover-error">…</p>`. **When empty the page hides the element via CSS `:empty`**, and the JS leaves the panel closed. When non-empty, the JS auto-opens the password panel on load so the user sees the error and can retry. |

Use the proxy's existing `escapeHtml()` (line ~228) for both. Both are simple global string
replacements — no template engine needed.

The JS reads these from the DOM only; the **contract is entirely in the HTML**, so if you ever
change the panel markup keep the `name="next"` / `name="password"` fields, the
`action="/__lock/login"`, and the `__CLOUDSPACE_NEXT__` / `__CLOUDSPACE_MESSAGE__` tokens.

---

## 3. Gateway routes to add

Dispatch order in `cloudspace-access-proxy.js` is (line ~1362):

```
handleLockRoute → protectCloudspaceRoute → handleCloudspaceRoute → handleScriptHubRoute → [auth gate] → proxyHttp
```

You need **two** things:

### 3a. Serve `/cover/*` statically AND publicly (before the auth gate)

The bundle + assets are fetched while the visitor is **not yet authenticated**, so they must be
allowed through the lock (the auth gate at line ~1368 would otherwise 401 them — `*.js/.glb/.wasm`
are non-navigation requests and get a 401 JSON, not a redirect). Add a public static handler and
call it before the gate (e.g. right after `handleScriptHubRoute`, which is likewise pre-gate):

```js
const COVER_DIR = path.join(__dirname, "cover");
const COVER_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".mjs":  "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",          // important: basis/draco wasm
  ".glb":  "model/gltf-binary",
  ".jpg":  "image/jpeg",
  ".png":  "image/png",
};
function handleCoverRoute(req, res) {
  if (!["GET", "HEAD"].includes(req.method)) return false;
  const url = new URL(req.url, "http://local");
  if (!url.pathname.startsWith("/cover/")) return false;
  // Do NOT serve login.html here (it must only go through the templated /__lock/login).
  const rel = decodeURIComponent(url.pathname.slice("/cover/".length));
  if (!rel || rel.includes("\0") || rel.endsWith("login.html")) { res.writeHead(404); res.end(); return true; }
  const file = path.normalize(path.join(COVER_DIR, rel));
  if (!file.startsWith(COVER_DIR)) { res.writeHead(403); res.end(); return true; } // path-traversal guard
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {
      "content-type": COVER_MIME[path.extname(file)] || "application/octet-stream",
      // static immutable assets — cache hard so the ~2.3 MB isn't re-fetched every visit
      "cache-control": "public, max-age=604800, immutable",
    });
    if (req.method === "HEAD") { res.end(); return; }
    res.end(buf);
  });
  return true;
}
```

Then in the request handler:

```js
const server = http.createServer((req, res) => {
  if (enabled && handleLockRoute(req, res)) return;
  if (handleCoverRoute(req, res)) return;          // <-- add: public /cover/* assets
  if (protectCloudspaceRoute(req, res)) return;
  ...
```

> Note `ACCESS_LOCK_FRONTEND_CACHE_CONTROL=no-store` only affects the proxied frontend transform,
> not this new route, so the `cache-control` above wins for `/cover/*`.

### 3b. Make `GET /__lock/login` (and the failed-login re-render) serve the cover template

Inside `handleLockRoute`, replace the two places that currently emit `htmlPage(...)` for the
**logged-out login** view with the templated cover. Suggested helper:

```js
let coverTemplateCache = null;
function renderCover(message, safeNext) {
  if (coverTemplateCache == null) {
    coverTemplateCache = fs.readFileSync(path.join(__dirname, "cover", "login.html"), "utf8");
  }
  return coverTemplateCache
    .split("__CLOUDSPACE_NEXT__").join(escapeHtml(safeNext || "/"))
    .split("__CLOUDSPACE_MESSAGE__").join(escapeHtml(message || ""));
}
```

- **`GET /__lock/login`** (line ~662): if the user is already authenticated, keep the existing
  `htmlPage(req)` (it shows the "unlocked / change password" panel). If **not** authenticated,
  return `sendHtml(res, 200, renderCover("", safeNext))`, where `safeNext` is derived exactly like
  `htmlPage()` does (`?next=` validated to start with `/`).
- **`POST /__lock/login`** failure branch (line ~677): replace
  `sendHtml(res, 401, htmlPage(req, "Password is incorrect."))` with
  `sendHtml(res, 401, renderCover("Password is incorrect.", safeNext))` (carry the same `next`).
  Success path is unchanged (`setAuthCookie` + redirect to `next`).

`GET /__lock` (the management page) and the password-change flow can stay on `htmlPage()` — the
cover is only the **logged-out unlock** screen. The unauthenticated redirect already points browsers
to `/__lock/login?next=...` (line ~753), so no other route needs touching.

> If `coverTemplateCache` worries you for hot-reload, just `fs.readFileSync` each call (the file is tiny).

---

## 4. Rebuild command (esbuild)

Build deps are kept out of git in `.artifacts/frontend` (the repo `.gitignore` ignores `.artifacts/`).

```bash
# from repo root
npm --prefix .artifacts/frontend i three@0.184.0 esbuild@0.24.2
node cover/build.mjs
# -> writes cover/cover.bundle.js  (IIFE, minified, ~675 KB)
```

`build.mjs` calls esbuild's JS API with `nodePaths` so the bare `import "three"` in
`cover.src.js` resolves even though `node_modules` lives in a sibling tree. Override the deps
location with `COVER_NODE_MODULES=/path/to/node_modules node cover/build.mjs`.

Equivalent raw esbuild (if you co-locate `node_modules` next to `cover.src.js`):

```bash
esbuild cover/cover.src.js --bundle --format=iife --minify --target=es2019 \
  --legal-comments=none --outfile=cover/cover.bundle.js
```

To rebuild **inside the Docker build** instead of committing `cover.bundle.js`, add a builder
stage that runs the two commands above and `COPY --from` the resulting `cover/`. The committed
`cover.bundle.js` already works, so this is optional.

---

## 5. Notes, caveats, and honest risk flags

- **Why basis/KTX2 is included (540 KB):** `intro_compressed.glb` declares
  `extensionsRequired: [KHR_draco_mesh_compression, KHR_mesh_quantization, KHR_texture_basisu]`.
  GLTFLoader **throws** without a KTX2Loader, so the basis transcoder is fetched at runtime to
  decode the model's 4 textures — even though the cover overrides the crystal material afterward.
  *Optional optimization (not done, flagged):* re-export the glb stripped of textures
  (`gltf-transform prune`/drop images + remove `KHR_texture_basisu`) to drop the 540 KB basis pair.
  It needs a DRACO-capable re-encode and risks geometry changes, so I left the faithful path. Say
  the word and I can attempt it.
- **glb size:** 681 KB — fine (< 3 MB). No lighter-stone swap needed.
- **Caching matters:** with `cache-control: public, max-age=..., immutable` on `/cover/*`, the
  ~2.3 MB is a first-visit-only cost. Enabling gzip/br on `.js/.wasm/.glb/.jpg` (glb/jpg are
  already fairly dense; wasm/js compress well) is worth it if your edge doesn't already.
- **Fonts:** the vertex page used licensed HG fonts. I **did not** copy them — the cover uses a
  system font stack (`Inter`/`Segoe UI`/system-ui). No font files, no license exposure.
- **No-JS / no-WebGL fallback:** progressive enhancement — without JS the loader is skipped and the
  password panel shows directly over a CSS ocean gradient (form still works). If WebGL init throws,
  the JS catches it, reveals the page, and the form is reachable via the top-right "解锁" button and
  the hero CTA (both are `[data-cover-open]`, in addition to the crystal hotspot).
- **Crystal click = a projected transparent hotspot**, not a raycast against the glass mesh
  (raycasting thin/transparent geometry is flaky). The JS projects the crystal's world center to
  screen each frame and keeps a clickable circle over it. Robust, but if you ever move the crystal
  in `cover.src.js`, the hotspot follows automatically (it reads the live gem position).
- **CSP:** the proxy currently sets **no** Content-Security-Policy, so the one inline
  `<script>`/`<style>` and the wasm/blob-worker decoders work as-is. If you add a CSP later, allow
  `script-src 'unsafe-inline' 'wasm-unsafe-eval'` (or nonce the inline tags), `style-src 'unsafe-inline'`,
  and `worker-src blob:` / `child-src blob:` (DRACO & KTX2 spawn blob-URL workers).
- **login.html must only be served templated** at `/__lock/login`. The `/cover/*` static handler in
  §3a explicitly 404s `login.html` so the raw `__CLOUDSPACE_*__` placeholders never leak.

---

## 6. What was verified locally (evidence)

- **esbuild build succeeds:** `cover/cover.bundle.js` written, **674.6 KB** (690,839 bytes), three +
  all example modules (`Water`, `GLTFLoader`, `DRACOLoader`, `KTX2Loader`, `EffectComposer`,
  `RenderPass`, `UnrealBloomPass`) inlined; `node --check` parses clean.
- **A throwaway static server mimicking the gateway** (`/__lock/login` templated, `/cover/*` static)
  served all 8 runtime files with **HTTP 200** and correct byte sizes.
- **Templating contract** verified: both placeholders replaced, hidden `next` field receives the
  value, empty message → empty `#cover-error` element, form `method=post action=/__lock/login`,
  `password` field present, bundle referenced as `/cover/cover.bundle.js`.
- **DOM wiring** verified headlessly (jsdom): boot does not throw; panel starts closed; clicking a
  `[data-cover-open]` trigger opens it; close button closes it; injecting a message auto-opens the
  panel and shows the error text. (Headless has no WebGL, so the scene render itself was not
  exercised — that's the maintainer's real-browser visual check.)
- **Final visual** (crystal render, glow, dolly, ocean, click-to-unlock feel) is best confirmed in a
  real browser with WebGL; the structure and contract above are what the gateway needs.
