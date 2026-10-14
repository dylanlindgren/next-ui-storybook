// Build-time generator for src/mega-names.generated.js.
//
// snInstanceModules re-exports each platform package (@servicenow/ui-core, the
// snabbdom renderer) from the shared instance bundle by emitting a virtual module
// with static named exports (`export const X = __ns["X"]`). Those names must be
// known when the virtual module source is generated, but the runtime namespace
// only exists in the browser.
//
// Why we lex the INSTANCE bundle (not the npm package): the public npm registry
// caps @servicenow/ui-core at the Vancouver release (24.1.1), which predates
// APIs newer instances ship. The instance's own @servicenow/ui-mega bundle is the
// authoritative, current export surface — exactly what we re-export at runtime —
// so we read the names straight from it.
//
// The instance must be supplied by whoever runs the generator (there is no
// default — the bundle is specific to a platform version, and we error out if
// none is given rather than guessing). In priority order:
//   1. a CLI argument:  pnpm gen:mega-names https://my-instance.service-now.com
//   2. SN_MEGA_URL (a full index.jsdbx URL) or SN_INSTANCE (a host) — from the
//      package root's .env or the environment
// The accepted value is a full index.jsdbx URL or just a host/base URL. The
// fetch is unauthenticated — uxasset externals are served without login — so
// point at an instance whose bundle is reachable that way.
//
// Run via `pnpm gen:mega-names`; also runs on `prepack`. On failure it throws
// and leaves the existing generated file untouched.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

// Inlined (not imported from mega-tables.js) so this generator doesn't trigger
// that module's MEGA_PACKAGES construction, which throws when the generated file
// is missing a NAMESPACES entry we are about to add (chicken-and-egg on first run).
const externalUrlFor = (request) => `/uxasset/externals/${request}/index.jsdbx`

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')

// Public namespace alias each platform package is exposed under in the mega
// bundle's final `export { … <var> as <alias> }` statement.
const NAMESPACES = {
  '@servicenow/ui-core': 'servicenowUiCore',
  '@servicenow/ui-renderer-snabbdom': 'servicenowUiRendererSnabbdom',
  'sn-translate': 'snTranslate',
}

// First non-flag CLI argument, if any.
const cliInstance = () => process.argv.slice(2).find((a) => !a.startsWith('-'))

// Accept a full index.jsdbx URL as-is; otherwise treat the value as a host/base
// URL and append the mega-bundle path.
function buildMegaUrl(hostOrUrl) {
  if (/\/index\.jsdbx(\?|$)/.test(hostOrUrl)) return hostOrUrl
  const base = /^https?:\/\//.test(hostOrUrl) ? hostOrUrl : `https://${hostOrUrl}`
  return base.replace(/\/$/, '') + externalUrlFor('@servicenow/ui-mega')
}

// Resolve the mega bundle URL from the highest-priority source available:
// CLI arg → SN_MEGA_URL env var → SN_INSTANCE env var. Throws if none is set,
// because there is no sensible default — the bundle is instance-specific.
function resolveMegaUrl(env) {
  const explicit = cliInstance() ?? env.SN_MEGA_URL ?? env.SN_INSTANCE
  if (explicit) return buildMegaUrl(explicit)
  throw new Error(
    'No instance specified. Provide one of:\n' +
      '  • an argument:  pnpm gen:mega-names https://my-instance.service-now.com\n' +
      '  • SN_MEGA_URL (full index.jsdbx URL) or SN_INSTANCE (host) in .env / the environment',
  )
}

// Fetch the raw bundle source text. The uxasset endpoint is public (no auth),
// so this works against any reachable instance without credentials.
async function fetchBundle(url) {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`fetch ${url} failed with HTTP ${res.status} ${res.statusText}`)
  }
  return res.text()
}

// Map a public namespace alias to the internal var esbuild assigned it in the
// bundle's final `export { … X as servicenowUiCore }`. esbuild minifies each
// namespace object to a short local variable (e.g. `e2`), so we look up the
// alias to find that variable name before parsing its exports.
// Returns null if the alias is absent (caller treats that as a fatal error).
function aliasVar(src, alias) {
  const m = src.match(new RegExp(`([A-Za-z_$][\\w$]*)\\s+as\\s+${alias}\\b`))
  return m ? m[1] : null
}

// Parse the keys of an esbuild export map `ee(VAR,{ name:()=>x, "n2":()=>y })`.
// Values are always `()=>localBinding` (an identifier), never object literals,
// so a simple brace match is unambiguous.
//
// We use a depth-counter brace walk rather than a regex to find the closing `}`
// because the bundle is minified and the export map may span many characters.
// Once we have the body string, we match each key with its getter arrow to
// collect the exported names. Keys that are valid identifiers appear unquoted;
// keys with special characters (e.g. "default") are double-quoted.
function exportNames(src, varName) {
  const open = src.indexOf(`ee(${varName},{`)
  if (open === -1) return null
  const start = src.indexOf('{', open)
  let depth = 0
  let i = start
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) break
  }
  const body = src.slice(start + 1, i)
  const names = []
  const re = /(?:([A-Za-z_$][\w$]*)|"([^"]+)")\s*:\s*\(\)\s*=>/g
  let mm
  while ((mm = re.exec(body))) names.push(mm[1] ?? mm[2])
  return names
}

// Best-effort version from the package's `{name:"<pkg>",version:"<x>"}` marker
// that esbuild inlines when bundling npm packages. Falls back to 'instance' if
// the marker is absent (e.g. the bundle was stripped of metadata), since the
// version is informational only and not required for the generated file to work.
function versionFor(src, pkg) {
  const m = src.match(
    new RegExp(`name:"${pkg.replace(/[/@-]/g, '\\$&')}",version:"([^"]+)"`),
  )
  return m ? m[1] : 'instance'
}

async function main() {
  // Merge the package root's .env (all keys) with the environment, so
  // SN_MEGA_URL / SN_INSTANCE / SN_PROFILE can live in a .env file.
  const env = { ...loadEnv('development', pkgRoot, ''), ...process.env }
  const url = resolveMegaUrl(env)
  console.log(`Fetching mega bundle: ${url}`)
  const src = await fetchBundle(url)

  // For each platform package, locate its namespace variable in the bundle,
  // parse out every exported name, and record whether a `default` export is
  // present. `default` is stored separately (hasDefault) rather than in the
  // names array because snInstanceModules emits it as `export default` rather
  // than a named binding, and the generated file must not use `default` as an
  // identifier in `export const default = …` (which is a syntax error).
  const result = {}
  for (const [pkg, alias] of Object.entries(NAMESPACES)) {
    const v = aliasVar(src, alias)
    if (!v) throw new Error(`Could not find "${alias}" alias in the mega bundle for ${pkg}.`)
    const names = exportNames(src, v)
    if (!names?.length) {
      throw new Error(`No exports parsed for ${pkg} (alias ${alias}, var ${v}).`)
    }
    const hasDefault = names.includes('default')
    result[pkg] = {
      version: versionFor(src, pkg),
      hasDefault,
      names: names.filter((n) => n !== 'default'),
    }
    console.log(`  ${pkg}@${result[pkg].version}: ${result[pkg].names.length} names, hasDefault=${hasDefault}`)
  }

  const body =
    '// AUTO-GENERATED by scripts/generate-mega-names.mjs — do not edit by hand.\n' +
    '// Re-export surface of the @servicenow/* platform packages, lexed from an\n' +
    '// instance\'s @servicenow/ui-mega bundle (the authoritative, current surface;\n' +
    '// the public npm package is frozen at Vancouver and misses newer APIs).\n' +
    '// Regenerate with `pnpm gen:mega-names`.\n\n' +
    'export const PLATFORM_EXPORTS = ' +
    JSON.stringify(result, null, 2) +
    '\n'

  const outPath = path.join(pkgRoot, 'src', 'mega-names.generated.js')
  fs.writeFileSync(outPath, body)
  console.log(`Wrote ${path.relative(pkgRoot, outPath)}`)
}

main().catch((err) => {
  console.error(`[gen:mega-names] ${err.message}`)
  process.exit(1)
})
