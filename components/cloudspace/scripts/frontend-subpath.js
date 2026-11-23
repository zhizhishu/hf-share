#!/usr/bin/env node
"use strict";
/*
 * frontend-subpath.js — build-time re-host of the prebuilt subscription front-end
 * (Nebula) under a sub-path prefix (e.g. /cloud) so it works when the CloudSpace
 * gateway is reverse-proxied behind another app instead of owning the site root.
 *
 * WHY (verified against the shipped dist, Vite build, PWA):
 *   The front-end is a Vite SPA whose asset references are ROOT-ABSOLUTE:
 *     - index.html: <script src="/index.js">, /favicon.*, /manifest*, /registerSW.js
 *     - index.js  : a preload helper `function(e){return"/"+e}` prepends "/" to every
 *                   chunk + css dep -> /chunks/*.js and /css/*.css (modulepreload links
 *                   AND stylesheet <link>s). CSS is the important one: css bodies are
 *                   NOT transformed by the gateway at runtime, so this must be baked in.
 *     - css/*.css : url(/fonts/...), url(/images/...)
 *     - chunks/*.js: "/images/...", "/fonts/..." string literals
 *   Inter-chunk imports are RELATIVE (import "./chunks/..") so they auto-adapt to the
 *   sub-path once index.js is loaded from <prefix>/index.js — only the absolute forms
 *   above need rewriting. API calls are NOT rewritten here: the front-end derives its
 *   axios baseURL from hostAPI.url (pinned to "<prefix>/" by the gateway bootstrap), so
 *   "/api/..." request paths already resolve to "<prefix>/api/...".
 *   The PWA service worker is DISABLED under a sub-path (its precache/scope assume root).
 *
 * Idempotent + drift-detecting: anchors that are neither found nor already-applied fail
 * the build loudly (like scripts/rebrand.js), so an upstream front-end format change is
 * caught at build time instead of shipping a white screen.
 *
 * Usage: node frontend-subpath.js --frontend <dir> --prefix /cloud
 */

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--frontend") out.frontend = argv[++i];
    else if (argv[i] === "--prefix") out.prefix = argv[++i];
  }
  return out;
}

function normalizePrefix(v) {
  let p = String(v || "").trim();
  if (!p || p === "/") return "";
  if (!p.startsWith("/")) p = `/${p}`;
  return p.replace(/\/+$/, "");
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const prefix = normalizePrefix(args.prefix);
  if (!args.frontend) {
    console.error("usage: node frontend-subpath.js --frontend <dir> --prefix /cloud");
    process.exit(2);
  }
  if (!fs.existsSync(args.frontend)) {
    console.error(`[subpath][FATAL] frontend dir not found: ${args.frontend}`);
    process.exit(1);
  }
  if (!prefix) {
    console.log("[subpath] empty prefix -> nothing to do (root mount).");
    return;
  }
  const name = prefix.replace(/^\//, ""); // "cloud"
  const dir = args.frontend;
  console.log(`[subpath] re-hosting front-end under "${prefix}/": ${dir}`);

  // Negative lookahead shared by the absolute-path rules: skip protocol-relative "//"
  // and anything already under the prefix (idempotency).
  const notDoneLA = `(?!/|${escapeRe(name)}/)`;

  const stats = { html: 0, base: 0, hostapi: 0, entryHelper: 0, cssUrl: 0, jsAsset: 0, manifest: 0, swDisabled: 0 };
  const files = walk(dir, []);

  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    const base = path.basename(f);

    // ---- PWA service worker: disable under sub-path (precache/scope assume root) ----
    if (base === "registerSW.js") {
      fs.writeFileSync(f, "/* CloudSpace: PWA service worker disabled under sub-path mount */\n");
      stats.swDisabled++;
      continue;
    }

    if (![".html", ".htm", ".js", ".mjs", ".css", ".json", ".webmanifest"].includes(ext)) continue;
    let s = fs.readFileSync(f, "utf8");
    let before = s;

    if (ext === ".html" || ext === ".htm") {
      // root-absolute src="/.." / href="/.." (index.js, icons, manifests, registerSW)
      const re = new RegExp(`(\\b(?:src|href)=")/${notDoneLA}`, "g");
      s = s.replace(re, `$1${prefix}/`);
      stats.html += (s.match(new RegExp(`(?:src|href)="${escapeRe(prefix)}/`, "g")) || []).length;

      // ---- SPA router base (history mode) ----
      // Verified against the shipped dist: the app creates its router with `history:ue()`
      // i.e. createWebHistory() called with NO base arg, so vue-router's normalizeBase falls
      // back to reading `<base href>` from the document. Without a <base>, the router base is
      // "/" and every history-mode route (/subs, /sync, ...) 404s when hosted at <prefix>/.
      // Inject <base href="<prefix>/"> (trailing slash required for correct relative + router
      // base resolution). All asset refs are root-absolute (<prefix>/...) so <base> does not
      // disturb them; ES-module specifiers resolve against the module URL, not <base>.
      if (/<base\s+href=/i.test(s)) {
        // idempotent: normalize any existing <base href="..."> to the prefix
        s = s.replace(/<base\s+href="[^"]*"\s*\/?>/i, `<base href="${prefix}/">`);
        stats.base++;
      } else if (/<head(\s[^>]*)?>/i.test(s)) {
        s = s.replace(/(<head(?:\s[^>]*)?>)/i, `$1<base href="${prefix}/">`);
        stats.base++;
      }

      // ---- SPA backend baseURL pin (same-origin) ----
      // The Sub-Store front-end derives its axios baseURL from localStorage.hostAPI, falling
      // back to a built-in default backend URL. The gateway's runtime JS branding rewrites
      // that default ("https://sub.store" -> "https://cloudspace.local" -> "") to an EMPTY
      // string, so if hostAPI is not already set the baseURL becomes "" and every API call hits
      // the site ROOT ("/api/...") — which under a sub-path mount lands on the front proxy's
      // root (no /api there), returning no data. Bake a tiny inline pin that runs before the
      // deferred app module and force-sets hostAPI to the same-origin backend at "<prefix>/",
      // so the baseURL is correct on the very first request, independent of the runtime
      // bootstrap-injection timing. (The runtime bootstrap sets the same thing; this guarantees
      // it even if that injection is ever bypassed.) No-op at root (empty prefix short-circuits
      // the whole script above).
      const pinMarker = "cloudspace-subpath-backend-pin";
      if (!s.includes(pinMarker)) {
        const pin = `<script>/*${pinMarker}*/(function(){try{var n="CloudSpace",d=JSON.stringify({current:n,apis:[{name:n,url:"${prefix}/"}]});localStorage.setItem("hostAPI",d);localStorage.setItem("backendConfigured","true");localStorage.setItem("magicPathConfigured","true");}catch(e){}})();</script>`;
        if (/<base\s+href="[^"]*"\s*\/?>/i.test(s)) {
          s = s.replace(/(<base\s+href="[^"]*"\s*\/?>)/i, `$1${pin}`);
          stats.hostapi++;
        } else if (/<head(\s[^>]*)?>/i.test(s)) {
          s = s.replace(/(<head(?:\s[^>]*)?>)/i, `$1${pin}`);
          stats.hostapi++;
        }
      }
    }

    if (ext === ".js" || ext === ".mjs") {
      // Vite entry preload helper: function(<p>){return"/"+<p>}  ->  return"<prefix>/"+<p>
      // (prepends prefix to every chunk/css dep). Param name is minifier-dependent.
      // Anchor keeps the quoted "/" literal: `return"` /  `"+<p>}`.
      const helperRe = /(function\(([A-Za-z_$][\w$]*)\)\{return")\/("\+\2\})/g;
      s = s.replace(helperRe, (_m, p1, _p, p3) => {
        stats.entryHelper++;
        return `${p1}${prefix}/${p3}`;
      });
      // Root-absolute static asset string literals in chunks: "/images/.." , '/fonts/..'
      const assetRe = new RegExp(`(["'])/${notDoneLA}(images|fonts|css|chunks)/`, "g");
      s = s.replace(assetRe, (_m, q, d) => { stats.jsAsset++; return `${q}${prefix}/${d}/`; });
    }

    if (ext === ".css") {
      // url(/fonts/..) url("/images/..) url('/..)
      const re = new RegExp(`(url\\((['"]?))/${notDoneLA}`, "g");
      s = s.replace(re, (_m, p1) => { stats.cssUrl++; return `${p1}${prefix}/`; });
    }

    if (ext === ".json" || ext === ".webmanifest") {
      // PWA manifest roots so an installed app opens under the sub-path.
      for (const key of ["start_url", "scope", "id"]) {
        const re = new RegExp(`("${key}"\\s*:\\s*")/${notDoneLA}"`, "g");
        s = s.replace(re, (_m, p1) => { stats.manifest++; return `${p1}${prefix}/"`; });
      }
    }

    if (s !== before) fs.writeFileSync(f, s);
  }

  // ---- drift / sanity assertions (END-STATE based, so a re-run is idempotent and still
  //      catches upstream format drift): require the prefixed forms present AND no bare
  //      root-absolute asset refs left behind. ----
  const indexHtml = path.join(dir, "index.html");
  const indexJs = path.join(dir, "index.js");
  const errs = [];

  if (fs.existsSync(indexHtml)) {
    const h = fs.readFileSync(indexHtml, "utf8");
    if (!h.includes(`src="${prefix}/index.js"`)) {
      errs.push(`index.html has no "${prefix}/index.js" entry ref (entry markup changed?)`);
    }
    // Router base: the history-mode SPA 404s on /subs etc. without a prefixed <base href>.
    if (!h.includes(`<base href="${prefix}/">`)) {
      errs.push(`index.html has no <base href="${prefix}/"> (SPA router base missing — /subs will 404; <head> markup changed?)`);
    }
    // Backend baseURL pin: without it the frontend's (branded-to-empty) default baseURL sends
    // API calls to the site root and no data loads under the mount.
    if (!h.includes("cloudspace-subpath-backend-pin") || !h.includes(`url:"${prefix}/"`)) {
      errs.push(`index.html has no hostAPI backend pin for "${prefix}/" (API calls will hit the site root; <head> markup changed?)`);
    }
  } else {
    errs.push("index.html not found in frontend dir");
  }
  if (fs.existsSync(indexJs)) {
    const j = fs.readFileSync(indexJs, "utf8");
    if (!j.includes(`return"${prefix}/"+`)) {
      errs.push("index.js preload helper not prefixed (`return\"/\"+<p>` anchor changed?)");
    }
  } else {
    errs.push("index.js not found in frontend dir");
  }

  // gather css + js bodies once
  const cssBody = files.filter((f) => f.toLowerCase().endsWith(".css")).map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const jsBody = files
    .filter((f) => { const e = f.toLowerCase(); return e.endsWith(".js") || e.endsWith(".mjs"); })
    .map((f) => fs.readFileSync(f, "utf8")).join("\n");

  if (cssBody) {
    if (!cssBody.includes(`url(${prefix}/`)) errs.push(`no url(${prefix}/...) found in css (expected prefixed /fonts /images)`);
    if (/url\((['"]?)\/(fonts|images)\//.test(cssBody)) errs.push("bare root-absolute url(/fonts|/images) still present in css");
  }
  if (jsBody) {
    if (!(jsBody.includes(`"${prefix}/images/`) || jsBody.includes(`"${prefix}/fonts/`))) {
      errs.push(`no "${prefix}/images|fonts" asset refs found in chunks (expected prefixed)`);
    }
    if (/(["'])\/(images|fonts)\//.test(jsBody)) errs.push("bare root-absolute /images|/fonts asset refs still present in chunks");
  }

  console.log(
    `[subpath] rewrites: html=${stats.html} base=${stats.base} hostapi=${stats.hostapi} entryHelper=${stats.entryHelper} ` +
    `cssUrl=${stats.cssUrl} jsAsset=${stats.jsAsset} manifest=${stats.manifest} swDisabled=${stats.swDisabled}`
  );

  if (errs.length) {
    console.error("[subpath][FATAL] front-end sub-path re-host failed its sanity checks:\n  - " + errs.join("\n  - "));
    console.error("Update scripts/frontend-subpath.js anchors against the new upstream front-end before shipping.");
    process.exit(1);
  }
  console.log("[subpath] done.");
}

main();
