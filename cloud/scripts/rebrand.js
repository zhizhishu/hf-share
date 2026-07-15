#!/usr/bin/env node
"use strict";
/*
 * rebrand.js — build-time surgical rebrand of the bundled upstream core + frontend.
 *
 * WHY: CloudSpace ships an upstream subscription core + front-end fetched as compiled
 * release artifacts at Docker build time. We want the product to present only as
 * "CloudSpace" and to NOT leak the upstream "Sub-Store" identity to users or to anyone
 * scanning the image / API responses — WITHOUT breaking the core, because some
 * "Sub-Store" strings are FUNCTIONAL identifiers the core relies on:
 *   - SUB_STORE_* env var names (the core reads process.env.SUB_STORE_*)
 *   - cache/storage keys (#sub-store, .sub-store-*, x-sub-store-share-age-public-key)
 *   - gist sync identity descriptions ("Sub-Store Artifacts Repository",
 *     "Auto Generated Sub-Store Backup") — changing them loses the existing sync gist
 *   - the script-visible Platform field ("Sub-Store") that community scripts may check
 * Those are KEPT. Only user-visible / scan-visible self-identification is rewritten.
 *
 * The HTTP X-Powered-By header is handled OUTSIDE this script via the env var
 * SUB_STORE_X_POWERED_BY=CloudSpace (set in the Dockerfile) — no byte edit needed.
 *
 * Idempotent + drift-detecting: if an expected source string is absent AND its
 * replacement is also absent, the upstream format changed -> reported as DRIFT and
 * the script exits non-zero so the image build FAILS LOUDLY rather than silently
 * shipping an un-rebranded core.
 *
 * Usage:
 *   node rebrand.js --core <core-bundle.js> --frontend <frontend-dir>
 * Either flag may be omitted to skip that target.
 */

const fs = require("fs");
const path = require("path");

const PRODUCT = "CloudSpace"; // user-visible product name (unchanged)
const CORE_CODENAME = "cumulus"; // 底核 internal codename (logger prefix)
const SCRIPT_CODENAME = "stratus"; // Script-Hub internal codename (logs / sentinel host)
const SCRIPT_SENTINEL_HOST = "stratus.local"; // replaces the internal magic host script.hub

/* ---- core bundle rules: surgical, literal, anchored. Order: specific first. ---- */
const CORE_RULES = [
  // notify titles "🌍 Sub-Store ..." — emoji is \u{1F30D} (escaped text) in the bundle
  { find: "\\u{1F30D} Sub-Store", repl: "\\u{1F30D} " + PRODUCT, what: "notify titles" },
  // version banner: emit string + its parser regex (must change as a pair)
  { find: "Sub-Store -- v", repl: PRODUCT + " -- v", what: "version banner (emit)" },
  { find: "Sub-Store\\s+--\\s+v", repl: PRODUCT + "\\s+--\\s+v", what: "version banner (parser regex)" },
  // push fallback title default: title||"Sub-Store"  (leaves G1/Platform/X-Powered-By consts)
  { find: 'title||"Sub-Store"', repl: 'title||"' + PRODUCT + '"', what: "push fallback title" },
  // download filename prefixes: sub-store_data_ / _subscription_ / _collection_ / _file_
  { find: "sub-store_", repl: "cloudspace_", what: "download filename prefixes" },
  // internal logger name + its log-line parser regex (pair) -> [cumulus]
  // Anchor on the stable string literal, NOT the minified logger-class variable:
  // upstream re-minifies every release (was `new Q1(...)`, now `new em(...)`), so a
  // var-name anchor drifts on each bump. The quoted "sub-store" appears exactly once
  // (the logger construction `new <var>("sub-store")`), so `("sub-store")` uniquely and
  // stably targets it regardless of the surrounding minified name.
  { find: '("sub-store")', repl: '("' + CORE_CODENAME + '")', what: "logger name" },
  { find: "\\[sub-store\\]", repl: "\\[" + CORE_CODENAME + "\\]", what: "log parser regex" },
  // gist error/notify/log LABELS only ("找不到 Sub-Store Gist" etc.) — NOT a matching key
  // (the gist is matched by wl/G1 below, which we keep). Washing this hides it from logs.
  { find: "Sub-Store Gist", repl: PRODUCT + " Gist", what: "gist log/error labels" },
  // X-Powered-By default literal: the runtime header is already overridden by env
  // SUB_STORE_X_POWERED_BY=CloudSpace, but wash the on-disk default too for a clean bundle.
  { find: 'X_POWERED_BY")||"Sub-Store"', repl: 'X_POWERED_BY")||"' + PRODUCT + '"', what: "X-Powered-By default" },
];

// Functional identifiers that MUST survive rebrand (confirmed by usage analysis).
// Asserted present after rewrite; their loss fails the build.
const CORE_KEEP = [
  // gist artifact storage KEY assignment `<var>="Sub-Store"` (used as load(KEY) /
  // {[KEY]:{content}}). Anchor on `="Sub-Store"` not the minified const name — it was
  // G1, is now Y1, and re-minifies each release; `="Sub-Store"` uniquely matches this
  // assignment (the other capitalized "Sub-Store" uses are `||"..."` / `:"..."` / labels).
  '="Sub-Store"',
  "Sub-Store Artifacts Repository", // gist sync identity (locate existing gist)
  "Auto Generated Sub-Store Backup", // gist backup desc
  'Platform:"Sub-Store"', // script-visible platform field (community-script compat)
];

function countOccurrences(hay, needle) {
  if (needle === "") return 0;
  return hay.split(needle).length - 1;
}

function rebrandCore(corePath) {
  console.log("[rebrand] core: " + corePath);
  let src = fs.readFileSync(corePath, "utf8");
  let changed = 0;
  const drift = [];
  for (const rule of CORE_RULES) {
    const n = countOccurrences(src, rule.find);
    if (n > 0) {
      src = src.split(rule.find).join(rule.repl);
      changed += n;
      console.log("  [ok]   " + rule.what + ": " + n + " replaced");
    } else if (countOccurrences(src, rule.repl) > 0) {
      console.log("  [skip] " + rule.what + ": already rebranded (idempotent)");
    } else {
      drift.push(rule.what + "  (anchor: " + rule.find + ")");
      console.log("  [DRIFT] " + rule.what + ": anchor NOT FOUND and not already rebranded");
    }
  }
  // assert functional identifiers survived
  const lost = [];
  for (const keep of CORE_KEEP) {
    if (countOccurrences(src, keep) === 0) lost.push(keep);
  }
  fs.writeFileSync(corePath, src);
  // transparency: show what capitalized "Sub-Store" remains (should be KEEP-list only)
  const residual = countOccurrences(src, "Sub-Store");
  console.log("  core: " + changed + " replacements; residual 'Sub-Store' (kept identifiers) = " + residual);
  if (lost.length) {
    console.error("  [FATAL] functional identifier(s) lost during rebrand: " + lost.join(", "));
  }
  return { drift, lost };
}

const FRONTEND_TEXT_EXT = new Set([".js", ".html", ".json", ".webmanifest", ".css", ".txt", ".vue"]);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function rebrandFrontend(frontendDir) {
  console.log("[rebrand] frontend: " + frontendDir);
  const files = walk(frontendDir, []);
  let total = 0;
  let touched = 0;
  let gzRemoved = 0;
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    // drop precompressed variants so served bytes match the rebranded plain files
    if (ext === ".gz" || ext === ".br") {
      fs.unlinkSync(f);
      gzRemoved++;
      continue;
    }
    if (!FRONTEND_TEXT_EXT.has(ext)) continue;
    let s = fs.readFileSync(f, "utf8");
    // Only capitalized display forms; leaves lowercase sub-store-* (cache keys) and
    // sub-store-org (upstream org slug in URLs) physically intact but product-hidden.
    const n = countOccurrences(s, "Sub-Store") + countOccurrences(s, "SubStore");
    if (n === 0) continue;
    s = s.split("Sub-Store").join(PRODUCT).split("SubStore").join(PRODUCT);
    fs.writeFileSync(f, s);
    total += n;
    touched++;
  }
  console.log("  frontend: " + total + " replacements across " + touched + " files; removed " + gzRemoved + " precompressed (.gz/.br)");
  return total;
}

/* ===================== Script-Hub (codename: Stratus) =====================
 * Script-Hub is cloned at build time and bundled to run internally behind the
 * CloudSpace gateway. Like the core, only USER/SCAN-visible self-identification is
 * washed; the internal request-routing host "script.hub" is renamed to a neutral
 * sentinel (stratus.local) — it is purely internal (service.js synthesizes it and
 * rewrites it to the real base URL in output; clients never send it), so renaming it
 * coordinated across service.js + scriptMap + all served scripts is transparent and
 * drives `grep script.hub` to zero. The served UI files script-hub*.js are renamed to
 * stratus*.js and the scriptMap keys updated to match.
 *
 * RESIDUAL (intentionally kept — functional remote dependency): the rewrite parsers
 * embed raw.githubusercontent.com/Script-Hub-Org/Script-Hub/main/scripts/*.js URLs
 * into generated client modules; those are fetched from GitHub by the proxy client at
 * runtime, so they must keep pointing at the upstream repo.
 */
const SCRIPT_TEXT_EXT = new Set([".js", ".json", ".html", ".txt", ".vue", ".mjs", ".cjs"]);

const SCRIPT_RULES = [
  // ---- display self-identification: blanket "Script Hub" (title/h1/footer/notify
  // titles/console logs/error bodies/JS_NAME) -> product. Disjoint from the hyphenated
  // "Script-Hub" in the functional remote /scripts/ URLs, which are kept. ----
  { find: "Script Hub", repl: PRODUCT, what: "display name 'Script Hub'" },
  { find: "const NAME = `script-hub`", repl: "const NAME = `" + SCRIPT_CODENAME + "`", what: "app NAME (console/log)" },
  // ---- package metadata (washed post-install; node_modules already resolved) ----
  { find: '"name": "script-hub"', repl: '"name": "' + SCRIPT_CODENAME + '"', what: "package.json name" },
  { find: '"script-hub": "file:"', repl: '"' + SCRIPT_CODENAME + '": "file:"', what: "package.json self-dep" },
  // ---- upstream repo identity in DISPLAY links + favicon (functional /scripts/ raw URLs are NOT touched) ----
  { find: "https://github.com/Script-Hub-Org/Script-Hub", repl: "https://github.com/zhizhishu/cloudspace", what: "github display links + wiki" },
  { find: "raw.githubusercontent.com/Script-Hub-Org/Script-Hub/main/assets", repl: "raw.githubusercontent.com/zhizhishu/cloudspace/main/assets", what: "favicon asset URLs" },
  // ---- misc visible strings ----
  { find: "script-hub/1.0.0", repl: "cloudspace/1.0.0", what: "default User-Agent" },
  { find: "ScriptHub通知", repl: "Stratus通知", what: "notification pref key (self-contained)" },
  // ---- internal routing sentinel host: regex-escaped form FIRST, then plain (disjoint bytes) ----
  { find: "script\\.hub", repl: SCRIPT_SENTINEL_HOST.replace(".", "\\."), what: "magic host (regex form)" },
  { find: "script.hub", repl: SCRIPT_SENTINEL_HOST, what: "magic host (plain form)" },
  // ---- scriptMap file keys (kept in sync with the file rename below) ----
  { find: "'./script-hub.beta.js'", repl: "'./" + SCRIPT_CODENAME + ".beta.js'", what: "scriptMap key (beta)" },
  { find: "'./script-hub.js'", repl: "'./" + SCRIPT_CODENAME + ".js'", what: "scriptMap key" },
];

// served UI files renamed on disk to match the scriptMap key rewrite above
const SCRIPT_FILE_RENAMES = [
  { from: "script-hub.beta.js", to: SCRIPT_CODENAME + ".beta.js" },
  { from: "script-hub.js", to: SCRIPT_CODENAME + ".js" },
];

// files that must still exist (and be requireable) after the rebrand — startup smoke
const SCRIPT_REQUIRED = [
  "service.js",
  "scriptMap.js",
  SCRIPT_CODENAME + ".js",
  SCRIPT_CODENAME + ".beta.js",
  "Rewrite-Parser.js",
  "Rewrite-Parser.beta.js",
  "rule-parser.js",
  "rule-parser.beta.js",
  "script-converter.js",
  "script-converter.beta.js",
];

// installed deps / VCS must never be rewritten or scanned (slow + could match a rule
// inside an unrelated dependency). Only our own first-party scripthub files are washed.
const SCRIPT_SKIP_DIR = /[\\/](node_modules|\.git|\.pnpm)[\\/]/;

function rebrandScripthub(dir) {
  console.log("[rebrand] scripthub (Stratus): " + dir);
  const files = walk(dir, []).filter(f => !SCRIPT_SKIP_DIR.test(f));
  const ruleTotals = new Map(SCRIPT_RULES.map(r => [r.what, 0]));
  let touched = 0;
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!SCRIPT_TEXT_EXT.has(ext)) continue;
    let s = fs.readFileSync(f, "utf8");
    let fileChanged = false;
    for (const rule of SCRIPT_RULES) {
      const n = countOccurrences(s, rule.find);
      if (n > 0) {
        s = s.split(rule.find).join(rule.repl);
        ruleTotals.set(rule.what, ruleTotals.get(rule.what) + n);
        fileChanged = true;
      }
    }
    if (fileChanged) {
      fs.writeFileSync(f, s);
      touched++;
    }
  }
  // drift: a rule whose anchor was found nowhere AND whose replacement is also absent
  // everywhere means upstream changed shape -> fail loudly.
  const drift = [];
  const allText = walk(dir, [])
    .filter(f => !SCRIPT_SKIP_DIR.test(f) && SCRIPT_TEXT_EXT.has(path.extname(f).toLowerCase()))
    .map(f => fs.readFileSync(f, "utf8"))
    .join("\n");
  for (const rule of SCRIPT_RULES) {
    if (ruleTotals.get(rule.what) === 0 && countOccurrences(allText, rule.repl) === 0) {
      drift.push(rule.what + "  (anchor: " + rule.find + ")");
      console.log("  [DRIFT] " + rule.what + ": anchor NOT FOUND and not already rebranded");
    } else {
      console.log("  [ok]   " + rule.what + ": " + ruleTotals.get(rule.what) + " replaced");
    }
  }
  // rename served UI files on disk to match scriptMap key rewrite
  for (const r of SCRIPT_FILE_RENAMES) {
    const from = path.join(dir, r.from);
    const to = path.join(dir, r.to);
    if (fs.existsSync(from)) {
      fs.renameSync(from, to);
      console.log("  [rename] " + r.from + " -> " + r.to);
    } else if (!fs.existsSync(to)) {
      drift.push("file rename source missing: " + r.from);
      console.log("  [DRIFT] expected served file not found: " + r.from);
    }
  }
  // assert required runtime files survived
  const missing = SCRIPT_REQUIRED.filter(n => !fs.existsSync(path.join(dir, n)));
  // residual transparency
  const residualName = countOccurrences(allText, "script-hub") + countOccurrences(allText, "Script Hub") + countOccurrences(allText, "ScriptHub");
  const residualHost = countOccurrences(allText, "script.hub");
  console.log("  scripthub: touched " + touched + " files; residual name-forms=" + residualName + " (functional remote /scripts/ URLs), residual host 'script.hub'=" + residualHost);
  return { drift, missing };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--core") out.core = argv[++i];
    else if (argv[i] === "--frontend") out.frontend = argv[++i];
    else if (argv[i] === "--scripthub") out.scripthub = argv[++i];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.core && !args.frontend && !args.scripthub) {
    console.error("usage: node rebrand.js [--core <core-bundle.js>] [--frontend <frontend-dir>] [--scripthub <scripthub-dir>]");
    process.exit(2);
  }
  let drift = [];
  let lost = [];
  let missing = [];
  if (args.core) {
    if (!fs.existsSync(args.core)) {
      console.error("[FATAL] core bundle not found: " + args.core);
      process.exit(1);
    }
    const r = rebrandCore(args.core);
    drift = drift.concat(r.drift);
    lost = lost.concat(r.lost);
  }
  if (args.frontend) {
    if (!fs.existsSync(args.frontend)) {
      console.error("[FATAL] frontend dir not found: " + args.frontend);
      process.exit(1);
    }
    rebrandFrontend(args.frontend);
  }
  if (args.scripthub) {
    if (!fs.existsSync(args.scripthub)) {
      console.error("[FATAL] scripthub dir not found: " + args.scripthub);
      process.exit(1);
    }
    const r = rebrandScripthub(args.scripthub);
    drift = drift.concat(r.drift);
    missing = missing.concat(r.missing);
  }
  if (missing.length) {
    console.error("[FATAL] scripthub rebrand left required runtime file(s) missing: " + missing.join(", "));
    process.exit(1);
  }
  if (lost.length) {
    console.error("[FATAL] rebrand removed functional identifier(s); aborting build.");
    process.exit(1);
  }
  if (drift.length) {
    console.error("[FATAL] upstream format drift — these anchors were not found:\n  - " + drift.join("\n  - "));
    console.error("Update scripts/rebrand.js anchors against the new upstream artifact before shipping.");
    process.exit(1);
  }
  console.log("[rebrand] done.");
}

main();
