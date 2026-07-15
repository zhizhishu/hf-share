#!/usr/bin/env node
"use strict";
/*
 * cloudspace-log-filter.js — runtime container-log sanitizer.
 *
 * start.sh routes the combined stdout/stderr of every child engine (the
 * subscription core, the Cirrus proxy engine / http-meta wrapper, and the Stratus
 * script lane) plus its own output through this line filter before anything reaches
 * the container log (e.g. the Hugging Face "Logs" panel, which can be visible to
 * others). Without it, those engines print their native logs straight through.
 *
 * Two jobs:
 *   1. Brand neutralization — rewrite upstream self-identification (mihomo,
 *      http-meta, Sub-Store, Script-Hub, clash.meta) to CloudSpace's own codenames,
 *      so logs never reveal what the product is assembled from. The build-time
 *      rebrand already scrubs the bundles; this is the RUNTIME safety net that also
 *      covers the un-rebranded http-meta wrapper and anything upstream adds later.
 *   2. Sensitive-data redaction — strip subscription / node data that the core logs
 *      verbosely and that cannot be silenced via env: remote URLs (subscription and
 *      flow links carry tokens), public IPs, and credentials (UUID / token / secret
 *      / password / public-key / service-role-key values). Loopback and private
 *      addresses are kept so logs stay useful for debugging the container itself.
 *
 * Line-oriented and fail-open: on any per-line error the original line is passed
 * through rather than dropped, so the filter can never silently swallow output.
 * Configurable via CLOUDSPACE_LOG_FILTER_* env (see flags below); start.sh disables
 * the whole pipe with CLOUDSPACE_LOG_FILTER_ENABLED=false.
 */

const readline = require("readline");

function flag(name, def) {
  const v = process.env[name];
  if (v === undefined) return def;
  return v === "1" || v.toLowerCase() === "true";
}

const BRAND_ENABLED = flag("CLOUDSPACE_LOG_FILTER_BRAND", true);
const REDACT_ENABLED = flag("CLOUDSPACE_LOG_FILTER_REDACT", true);
// Off by default: generic third-party client names (Clash/Surge/Loon/...) are not
// part of OUR identity and scrubbing them hurts log readability. Enable for maximum
// obfuscation via CLOUDSPACE_LOG_FILTER_SCRUB_CLIENTS=true.
const SCRUB_CLIENTS = flag("CLOUDSPACE_LOG_FILTER_SCRUB_CLIENTS", false);

// ---- brand rules: most specific first ----
const BRAND_RULES = [
  [/clash[.\-_ ]?meta/gi, "cirrus"],
  [/\bmihomo\b/gi, "cirrus"],
  [/http[\-_ ]?meta/gi, "cirrus"],
  [/\[META\b/g, "[Cirrus"], // http-meta wrapper bracket tags: [META FOLDER], [META] STARTED, ...
  [/\bsub[\-_ ]?store\b/gi, "CloudSpace"], // residual net; rebrand handles the bundle
  [/\bscript[\-_ ]?hub\b/gi, "Stratus"],
  [/script\.hub/gi, "stratus.local"],
];

// Generic proxy-client names — only applied when SCRUB_CLIENTS is on.
const CLIENT_RULES = [
  [/\bquantumult ?x\b/gi, "client"],
  [/\bsurge\b/gi, "client"],
  [/\bloon\b/gi, "client"],
  [/\bstash\b/gi, "client"],
  [/\begern\b/gi, "client"],
  [/\bclash\b/gi, "client"],
];

// ---- redaction helpers ----
function isLocalHost(host) {
  return (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.startsWith("127.")
  );
}

function isPrivateIPv4(ip) {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = +m[1];
  const b = +m[2];
  if (a > 255 || b > 255 || +m[3] > 255 || +m[4] > 255) return false; // not a real IP
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

const URL_RE = /\bhttps?:\/\/[^\s'"`)\]}>,]+/gi;
const IPV4_RE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
// IPv6 is only redacted when it clearly is one (contains "::" or a hex letter) so
// plain digit-colon sequences like timestamps (12:34:56) are never touched.
const IPV6_RE = /(?:[0-9a-f]{1,4})?(?::[0-9a-f]{0,4}){2,7}/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// `key: value` / `"key":"value"` secrets — allows the JSON closing quote between
// the key and the separator so dumped config objects are covered too.
const SECRET_KV_RE =
  /\b(token|password|passwd|pwd|secret|psk|uuid|public[\-_ ]?key|private[\-_ ]?key|api[\-_ ]?key|apikey|service[\-_ ]?role[\-_ ]?key|authorization|auth|obfs[\-_ ]?password|age-secret-key)\b("?\s*[:=]\s*)("?)([^\s",'`]+)/gi;
// Stratus script-lane secret path prefixes (/sh-<token>, /shb-<token>): they gate the
// script lanes ahead of the access lock, so they must not sit in a possibly-public log.
const LANE_PATH_RE = /\/shb?-[A-Za-z0-9_-]{6,}/g;

function redactUrl(line) {
  return line.replace(URL_RE, (url) => {
    try {
      const u = new URL(url);
      if (isLocalHost(u.hostname)) return url; // keep internal loopback URLs
      return `[redacted-url:${u.protocol}//…]`;
    } catch {
      return "[redacted-url]";
    }
  });
}

function redactIPv4(line) {
  return line.replace(IPV4_RE, (ip) => (isPrivateIPv4(ip) ? ip : "[redacted-ip]"));
}

function looksPublicIPv6(ip) {
  const low = ip.toLowerCase();
  if (!low.includes("::") && !/[a-f]/.test(low)) return false; // digit-only -> timestamp etc.
  if (low === "::1") return false;
  if (low.startsWith("fe80")) return false; // link-local
  if (low.startsWith("fc") || low.startsWith("fd")) return false; // unique-local
  return true;
}

function redactIPv6(line) {
  return line.replace(IPV6_RE, (ip) => (looksPublicIPv6(ip) ? "[redacted-ip]" : ip));
}

function redactSecrets(line) {
  let out = line.replace(UUID_RE, "[redacted-uuid]");
  out = out.replace(SECRET_KV_RE, (_m, key, sep, quote) => `${key}${sep}${quote}[redacted]`);
  return out;
}

function redactLanePaths(line) {
  return line.replace(LANE_PATH_RE, "[redacted-path]");
}

function sanitize(line) {
  let out = line;
  if (BRAND_ENABLED) {
    for (const [re, rep] of BRAND_RULES) out = out.replace(re, rep);
    if (SCRUB_CLIENTS) for (const [re, rep] of CLIENT_RULES) out = out.replace(re, rep);
  }
  if (REDACT_ENABLED) {
    out = redactUrl(out);
    out = redactIPv4(out);
    out = redactIPv6(out);
    out = redactSecrets(out);
    out = redactLanePaths(out);
  }
  return out;
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  let out;
  try {
    out = sanitize(line);
  } catch {
    out = line; // fail-open: never drop a line
  }
  try {
    process.stdout.write(out + "\n");
  } catch {
    /* downstream closed */
  }
});
rl.on("close", () => process.exit(0));
process.stdin.on("error", () => process.exit(0));
process.stdout.on("error", () => process.exit(0));
