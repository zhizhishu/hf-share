/*
 * Build the CloudSpace cover bundle: cover.src.js -> cover.bundle.js (IIFE, minified).
 *
 * Three.js + its example modules are bundled in (no CDN). Because the build deps live
 * outside this folder (kept in .artifacts/ to avoid committing node_modules), we use
 * esbuild's JS API with `nodePaths` so bare imports like "three" resolve regardless of
 * where cover.src.js sits in the tree.
 *
 * Usage (from repo root):
 *   npm --prefix .artifacts/frontend i three@0.184.0 esbuild@0.24.2
 *   node cover/build.mjs
 * Override the deps location with COVER_NODE_MODULES=/path/to/node_modules.
 */
import { pathToFileURL, fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"
import { existsSync, statSync } from "node:fs"

const here = dirname(fileURLToPath(import.meta.url))
const nm = process.env.COVER_NODE_MODULES
  ? resolve(process.env.COVER_NODE_MODULES)
  : resolve(here, "..", ".artifacts", "frontend", "node_modules")

if (!existsSync(join(nm, "esbuild")) || !existsSync(join(nm, "three"))) {
  console.error(
    `[cover build] three + esbuild not found under:\n  ${nm}\n` +
    `Install them first, e.g.:\n  npm --prefix .artifacts/frontend i three@0.184.0 esbuild@0.24.2\n` +
    `or set COVER_NODE_MODULES to a node_modules that contains three + esbuild.`
  )
  process.exit(1)
}

const esbuild = await import(pathToFileURL(join(nm, "esbuild", "lib", "main.js")).href)
const outfile = join(here, "cover.bundle.js")

await esbuild.build({
  entryPoints: [join(here, "cover.src.js")],
  bundle: true,
  format: "iife",
  minify: true,
  target: "es2019",
  legalComments: "none",
  nodePaths: [nm],
  outfile,
  logLevel: "info",
})

const kb = (statSync(outfile).size / 1024).toFixed(1)
console.log(`[cover build] wrote ${outfile} (${kb} KB)`)
