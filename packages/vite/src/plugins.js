import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { transformWithEsbuild } from 'vite'
import postcss from 'postcss'
import autoprefixer from 'autoprefixer'

import { MEGA_PACKAGES, externalUrlFor } from './mega-tables.js'
import { THEME_TABLE, THEME_LOOKUP_ROUTE } from './constants.js'
import remMultiplier from './postcss-rem-multiplier.js'
import { resolveDedupAliases } from './dedup.js'
import { PatchManager } from './patch-manager.js'
import { ScssWorkerPool } from './scss-worker/worker-pool.js'
import { createNodeFileImporter } from './scss-worker/node-file-importer.js'

// ---------------------------------------------------------------------------
// The Vite plugins that make a ServiceNow Next Experience component project
// work under @storybook/web-components-vite (dev) and the Vite build (build).
// Each plugin takes a `mode` of 'dev' | 'build':
//
//   dev   — bundle the project's OWN component source locally and load
//           everything under @servicenow/* and @devsnc/* from the instance over
//           the dev proxy (the snInstanceModules virtual-module trick). A
//           component or style edit triggers a full page reload.
//   build — produce a deployable artifact: @servicenow/* and @devsnc/* are left
//           as EXTERNAL bare imports for the platform's runtime loader to
//           resolve, and the compiled CSS is minified.
//
// === Single-instance constraint — do not break this (dev) ===
// Everything under @servicenow/* and @devsnc/* must resolve to the one copy the
// instance provides, loaded from its exact runtime URL with no query string.
// Loading any of it a second time, or from a different URL, breaks the components
// at runtime. The `new Function('u','return import(u)')` trick below exists
// precisely so Vite's import-analysis never sees — and never rewrites/appends
// `?import` to — that URL.
// ---------------------------------------------------------------------------

// Require scoped to THIS package, for core's own deps (e.g. cssnano), loaded
// lazily so dev never pays for them.
const require = createRequire(import.meta.url)

// Build a `require` scoped to the consumer project so peer deps (e.g. `sass`)
// resolve from the consumer's node_modules, not this package's.
const requireFrom = (projectRoot) =>
  createRequire(path.join(projectRoot, 'package.json'))

// So the CSS we compile matches a real platform component build even when now.config.json
// omits these keys (the SDK defaults the multiplier OFF and uses this var name).
const DEFAULT_BROWSERS = [
  'chrome >= 87',
  'firefox ESR',
  'firefox >= 85',
  'edge >=87',
  'safari >= 13.1',
]
const DEFAULT_REM_MULTIPLIER_VAR = '--now-rem-multiplier-from-root'

function readSdkBuild(projectRoot) {
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'now.config.json'), 'utf8'),
    )
    return cfg?.build ?? {}
  } catch {
    return {}
  }
}

// Resolve every @servicenow/* and @devsnc/* import.
//
//   dev   — to a virtual module that loads it from the INSTANCE at runtime and
//           re-exports it. Platform packages are pulled from the shared instance
//           bundle; everything else loads its own module. Loaded via
//           `new Function('u','return import(u)')` so the `import(u)` lives in a
//           string the Vite import-analysis lexer never sees (a normal dynamic
//           import would be rewritten with `?import`, loading a second copy and
//           breaking the single-instance constraint).
//   build — left EXTERNAL, but the bare specifier is rewritten to the platform's
//           runtime asset URL (/uxasset/externals/<pkg>/index.jsdbx). The browser
//           loads the deployed module directly and follows these import URLs; a
//           BARE specifier would not resolve (there is no import map at runtime),
//           so the module — and the custom element it registers — would never
//           load. No virtual module is emitted.
// Unscoped packages the instance provides via the mega bundle, just like
// @servicenow/ui-core. They are NOT served standalone (their individual
// /uxasset/externals/<pkg>/index.jsdbx returns a "Failed to load" stub) — the
// platform rewrites the import to the mega bundle at serve time — so we must
// treat them as instance modules in BOTH dev and build, never bundle our own
// copy (sn-translate, e.g., references `process`, undefined in the browser).
// Each must also appear in NAMESPACES (mega-tables.js) so its named exports are
// re-exported in dev.
const PLATFORM_BARE_PACKAGES = ['sn-translate']

function packageNameFromSpecifier(source) {
  if (!source) return null
  if (source.startsWith('@')) {
    const parts = source.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null
  }
  const [name] = source.split('/')
  return name || null
}

function readInstanceOptionalDependencies(projectRoot) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    )
    return new Set(Object.keys(pkg?.optionalDependencies ?? {}))
  } catch {
    return new Set()
  }
}

// Is this import specifier provided by the instance (so we externalise it rather
// than bundle it)? UI Mega is always instance-provided; other scoped packages
// and the bare packages above are gated by optionalDependencies.
export function isInstanceModule(source, optionalDependencies) {
  const pkg = packageNameFromSpecifier(source)
  if (source === '@servicenow/ui-mega') return true
  if (!pkg || !optionalDependencies?.has(pkg)) return false
  if (/^@(servicenow|devsnc)\//.test(source)) return true
  return PLATFORM_BARE_PACKAGES.some((p) => source === p || source.startsWith(`${p}/`))
}

export function snInstanceModules({ mode = 'dev', projectRoot } = {}) {
  const PREFIX = '\0sn-instance:'
  const megaUrl = JSON.stringify(externalUrlFor('@servicenow/ui-mega'))
  return {
    name: 'sn-instance-modules',
    enforce: 'pre',
    resolveId(source) {
      // Read on each resolve so edits to package.json are respected without
      // requiring a full process restart.
      const optionalDependencies = readInstanceOptionalDependencies(projectRoot)
      if (!isInstanceModule(source, optionalDependencies)) return null
      // Build: external, rewritten to the platform's runtime asset URL so the
      // import statement in the output resolves on the instance.
      if (mode === 'build') return { id: externalUrlFor(source), external: true }
      return PREFIX + source
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null
      const pkg = id.slice(PREFIX.length)
      const platform = MEGA_PACKAGES[pkg]
      const lines = [
        `const __import = new Function('u', 'return import(u)');`,
        `const __origin = new URL(import.meta.url).origin;`,
      ]
      if (pkg === '@servicenow/ui-mega') {
        lines.push(`const __ns = await __import(__origin + ${megaUrl});`)
        for (const namespace of new Set(
          Object.values(MEGA_PACKAGES).map(({ namespace }) => namespace),
        )) {
          lines.push(`export const ${namespace} = __ns[${JSON.stringify(namespace)}];`)
        }
        lines.push(`export default __ns;`)
      } else if (platform) {
        // Platform package: pull its namespace out of the shared instance bundle.
        lines.push(`const __mega = await __import(__origin + ${megaUrl});`)
        lines.push(`const __ns = __mega[${JSON.stringify(platform.namespace)}];`)
        // Re-export each public name straight from the instance namespace.
        for (const name of platform.names) {
          lines.push(`export const ${name} = __ns[${JSON.stringify(name)}];`)
        }
        if (platform.hasDefault) {
          lines.push(`export default __ns["default"] ?? __ns;`)
        }
      } else {
        // Component / other instance package: load its own module (registers
        // custom elements as a side effect; default re-exported if present).
        const url = JSON.stringify(externalUrlFor(pkg))
        lines.push(`const __ns = await __import(__origin + ${url});`)
        lines.push(`export default __ns && (__ns.default ?? __ns);`)
      }
      return lines.join('\n') + '\n'
    },
  }
}

// The ServiceNow platform serves each component asset two ways: standalone (as a
// real ES module) and inlined into a page's content bundle. For the inline path,
// it splits the module on `/*__ESM_BODY_START__*/` … `/*__ESM_BODY_END__*/`
// markers — hoisting the imports above the marker out, and wrapping the body in a
// classic IIFE — then rebinds each `import * as ns` to a `window.__TECTONIC__*`
// global. A bundle WITHOUT these markers gets its raw `import` left inside the
// IIFE ("Cannot use import statement outside a module"); a bundle whose imports
// have default/named bindings (`import x, { y } from …`) can't be rebound to a
// namespace global. In build mode we post-process each entry chunk to match: 
// every external import becomes `import * as <ns>`, its original bindings are re-created 
// from the namespace just inside the body, and the body is wrapped in the markers.
// This mirrors the platform's asset inlining contract (hoist imports + wrap body markers).
const MARKER_BODY_START = '/*__ESM_BODY_START__*/'
const MARKER_BODY_END = '/*__ESM_BODY_END__*/'

// Pull the leading run of `import …` statements off the top of a chunk. Rollup
// emits every import first, each terminated by `;`. Runs on minified output too
// (imports concatenated on one line), so the statement ends at its `;` rather
// than a newline. Returns { imports, body }.
function splitLeadingImports(code) {
  const stmtRe = /^\s*import\b[\s\S]*?(?:from\s*(['"])[^'"]+\1|(['"])[^'"]+\2)\s*;/
  const imports = []
  let rest = code
  for (;;) {
    const m = rest.match(stmtRe)
    if (!m || m.index !== 0) break
    imports.push(m[0].trim())
    rest = rest.slice(m[0].length)
  }
  return { imports, body: rest }
}

// Parse one import statement into { url, namespace, def, named:[{imported,local}] }.
function parseImport(stmt) {
  const fromM = stmt.match(/from\s*(['"])([^'"]+)\1\s*;?\s*$/)
  if (!fromM) {
    const sideM = stmt.match(/^import\s*(['"])([^'"]+)\1/)
    return { url: sideM ? sideM[2] : null, namespace: null, def: null, named: [] }
  }
  const url = fromM[2]
  const bindPart = stmt.slice(stmt.indexOf('import') + 6, stmt.lastIndexOf('from')).trim()
  const nsM = bindPart.match(/^\*\s*as\s+([A-Za-z_$][\w$]*)$/)
  if (nsM) return { url, namespace: nsM[1], def: null, named: [] }
  const named = []
  const braceM = bindPart.match(/\{([^}]*)\}/)
  if (braceM) {
    for (const raw of braceM[1].split(',')) {
      const p = raw.trim()
      if (!p) continue
      const asM = p.match(/^(.+?)\s+as\s+(.+)$/)
      named.push(asM ? { imported: asM[1].trim(), local: asM[2].trim() } : { imported: p, local: p })
    }
  }
  const defPart = bindPart.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim()
  return { url, namespace: null, def: defPart || null, named }
}

// Rewrite a chunk into the platform asset-compatible format (see comment above).
export function platformAssetBundleFormat(code) {
  if (code.includes(MARKER_BODY_START)) return code // already in the right shape
  const { imports, body } = splitLeadingImports(code)
  if (imports.length === 0) return code

  const importLines = []
  const rebinds = []
  let n = 0
  for (const stmt of imports) {
    const { url, namespace, def, named } = parseImport(stmt)
    if (!url) {
      importLines.push(stmt)
      continue
    }
    if (namespace) {
      importLines.push(stmt) // already `import * as ns` — leave it
      continue
    }
    if (!def && named.length === 0) {
      importLines.push(stmt) // side-effect import — keep, no binding to rebind
      continue
    }
    const ns = `__sn_ext_${n++}`
    importLines.push(`import * as ${ns} from "${url}";`)
    // Default import interops to the module's default (or the namespace itself).
    if (def) rebinds.push(`const ${def} = ${ns}.default ?? ${ns};`)
    for (const { imported, local } of named) rebinds.push(`const ${local} = ${ns}.${imported};`)
  }

  return [
    importLines.join('\n'),
    MARKER_BODY_START,
    rebinds.join('\n'),
    body.replace(/\s*$/, ''),
    MARKER_BODY_END,
    '',
  ]
    .filter((s) => s !== '')
    .join('\n')
}

// Vite/Rollup plugin wrapping platformAssetBundleFormat. Build mode only: rewrites
// each emitted entry chunk so the deployed asset works both standalone and when
// the platform inlines it into a page content bundle.
//
// This runs in `generateBundle`, NOT `renderChunk`, because Vite's minifier runs
// in a `renderChunk` after all user plugins and would strip the marker comments.
// generateBundle is the last hook, so the markers (and our namespace rebindings)
// survive into the emitted asset.
export function snPlatformAssetBundleFormat({ mode = 'dev' } = {}) {
  return {
    name: 'sn-platform-asset-bundle-format',
    enforce: 'post',
    generateBundle(_options, bundle) {
      if (mode !== 'build') return
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk' && file.isEntry) {
          file.code = platformAssetBundleFormat(file.code)
        }
      }
    },
  }
}

// Components do `import styles from './index.scss'` and hand the result to
// `styles:` as a string. We compile the project's .scss to a CSS string here
// (returning `export default "<css>"`) using the project's OWN installed sass
// (compileString). This deliberately bypasses Vite's built-in sass worker, which
// only supports the modern-compiler API (sass >= 1.70) — SDK projects can pin an
// older sass, and bumping it (or adding sass-embedded) would alter the SDK
// `build`. Scoped to the component source dir PLUS any @servicenow/@devsnc
// package's own .scss under node_modules: those packages ship raw source
// (package.json "module") with the same `import styles from './_x.scss'`
// pattern, and hit it whenever they aren't resolved as instance modules (i.e.
// not listed in the consumer's optionalDependencies) — Vite's built-in CSS
// handling has no default export for plain .scss, so without this they fail
// with "does not provide an export named 'default'". Storybook's own CSS is
// untouched either way.
//
// After the sass compile we run the same PostCSS pass the SDK's webpack style
// loader does, so the CSS matches a real platform component build: autoprefixer
// (always, targeting build.browsers) and — only when build.style.enableRemMultiplier
// is set in now.config.json — the rem-to-rem multiplier. In `build` mode we also run
// cssnano (matching the SDK, which minifies); in `dev` we skip minification to
// keep the emitted CSS readable.
// Shared by snScssAsString and snSnabbdomJsx to recognize a @servicenow/@devsnc
// package's own source under node_modules, as opposed to the project's
// componentSrcDir or an unrelated third-party dependency.
const VENDOR_PACKAGE_SCOPE_RE = /[\\/]node_modules[\\/](@servicenow|@devsnc)[\\/]/

// Nearest ancestor `node_modules` directory for `file`, so sass can resolve a
// bare `@import '@servicenow/sass-kit/host'` the way Node resolution would
// (pnpm gives each package its own local node_modules with its declared deps
// symlinked in). Returns null if `file` isn't under any node_modules.
function nearestNodeModulesDir(file) {
  const parts = file.split(path.sep)
  const idx = parts.lastIndexOf('node_modules')
  return idx === -1 ? null : parts.slice(0, idx + 1).join(path.sep)
}
export function snScssAsString({ componentSrcDir, projectRoot, mode = 'dev' }) {
  // Resolve project .scss to a \0-prefixed virtual module whose id carries no
  // ".scss" substring (path is hex-encoded), so Vite's core `vite:css`
  // transform — which matches on the .scss extension — never touches it. We
  // compile it ourselves in `load`.
  const PREFIX = '\0sn-scss:'
  const idForFile = (file) => PREFIX + Buffer.from(file).toString('hex')
  let compileString
  // Content-hash cache: filePath → { hash: string, css: string }. Persists
  // across incremental rebuilds in watch mode so unchanged files skip
  // recompilation entirely.
  const cache = new Map()
  // Worker pool for parallel sass compilation. Initialised lazily on first use.
  let pool
  function getPool() {
    if (!pool) pool = new ScssWorkerPool({ projectRoot })
    return pool
  }
  // Lazily built once per session from now.config.json's `build` block (read
  // once — changing now.config.json needs a restart, same as the proxy).
  let processor
  function getProcessor() {
    if (processor) return processor
    const build = readSdkBuild(projectRoot)
    const style = build.style ?? {}
    const plugins = [
      autoprefixer({ overrideBrowserslist: build.browsers ?? DEFAULT_BROWSERS, grid: true }),
    ]
    if (style.enableRemMultiplier) {
      plugins.push(remMultiplier(style.multiplierCssVarName ?? DEFAULT_REM_MULTIPLIER_VAR))
    }
    // Build artifacts are minified to match the SDK's cssnano pass.
    if (mode === 'build') {
      const cssnano = require('cssnano')
      plugins.push(cssnano({ preset: 'default' }))
    }
    processor = postcss(plugins)
    return processor
  }
  return {
    name: 'sn-scss-as-string',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!source.endsWith('.scss')) return null
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      })
      const file = resolved?.id.split('?')[0]
      if (!file) return null
      if (!file.startsWith(componentSrcDir) && !VENDOR_PACKAGE_SCOPE_RE.test(file)) return null
      return idForFile(file)
    },
    async load(id) {
      if (!id.startsWith(PREFIX)) return null
      const file = Buffer.from(id.slice(PREFIX.length), 'hex').toString('utf8')
      const source = fs.readFileSync(file, 'utf8')

      // Skip recompilation when the source content hasn't changed.
      const hash = createHash('sha256').update(source).digest('hex')
      const cached = cache.get(file)
      if (cached?.hash === hash) {
        this.addWatchFile(file)
        return { code: `export default ${JSON.stringify(cached.css)}`, map: null }
      }

      // Compile SCSS → CSS. Try the worker pool first; fall back to the main
      // thread if the pool fails (e.g. on first-run errors or missing workers).
      // loadPaths includes the file's own node_modules (when present) so a
      // vendor package's bare `@import '@servicenow/sass-kit/host'` resolves
      // against that package's own installed deps, same as Node resolution would.
      const nodeModulesDir = nearestNodeModulesDir(file)
      const loadPaths = nodeModulesDir
        ? [path.dirname(file), nodeModulesDir]
        : [path.dirname(file)]
      let css
      try {
        css = await getPool().compile(source, file, {
          loadPaths,
          url: pathToFileURL(file),
          quietDeps: true
        })
      } catch {
        if (!compileString) {
          compileString = requireFrom(projectRoot)('sass').compileString
        }
        ;({ css } = compileString(source, {
          loadPaths,
          importers: [createNodeFileImporter(file)],
          url: pathToFileURL(file),
          quietDeps: true
        }))
      }

      // Apply the SDK's PostCSS pass (autoprefixer + optional rem multiplier,
      // plus cssnano in build) so the compiled CSS matches what `snc
      // ui-component` would emit. `from` is set for accurate plugin diagnostics;
      // sourcemaps are off (we emit a string).
      const { css: out } = await getProcessor().process(css, { from: file, map: false })
      cache.set(file, { hash, css: out })
      this.addWatchFile(file)
      return { code: `export default ${JSON.stringify(out)}`, map: null }
    },
    // On a .scss edit, invalidate the cache entry AND our virtual module (so
    // `load` recompiles the CSS) and trigger a full page reload.
    handleHotUpdate(ctx) {
      const file = ctx.file
      if (!file.endsWith('.scss')) return
      if (!file.startsWith(componentSrcDir) && !VENDOR_PACKAGE_SCOPE_RE.test(file)) return
      cache.delete(file)
      const mod = ctx.server.moduleGraph.getModuleById(idForFile(file))
      if (mod) ctx.server.moduleGraph.invalidateModule(mod)
      ctx.server.ws.send({ type: 'full-reload' })
      return []
    },
    closeBundle() {
      pool?.terminate()
      pool = null
    },
  }
}

// Compile the project's snabbdom JSX (classic pragma) for .js component source.
// We do the transform AND the factory import in one plugin instead of Vite's
// `esbuild`/`jsxInject` option, because Vite only injects jsxInject for
// .jsx/.tsx ids (jsxExtensionsRE) — never for .js — so the factory would be
// referenced but never imported. The renderer namespace is imported from
// @servicenow/ui-mega and resolved by snInstanceModules to the instance bundle.
//
// Also scoped to vendor @servicenow/@devsnc package source, same rationale as
// snScssAsString: some SDK packages ship .js files with raw JSX (e.g.
// now-icon's cache.js) using the same unwritten classic-pragma convention as
// this plugin, and hit this per-file transform whenever Vite's dev-server
// requests them directly rather than through the dependency pre-bundler (see
// snJsxPragmaEsbuildPlugin for the pre-bundler's own path through this same gap).
//
// A component edit triggers a full page reload: we don't make the module
// self-accepting, so Vite reloads the page rather than re-executing a module
// that would re-call createCustomElement on an already-registered tag.
export function snSnabbdomJsx({ componentSrcDir }) {
  const RENDERER = '__snRenderer'
  const FACTORY = `${RENDERER}.createElement`
  const FRAGMENT = `${RENDERER}.Fragment`
  return {
    name: 'sn-snabbdom-jsx',
    enforce: 'pre',
    async transform(code, id) {
      const file = id.split('?')[0]
      if (!/\.jsx?$/.test(file)) return null
      if (!file.startsWith(componentSrcDir) && !VENDOR_PACKAGE_SCOPE_RE.test(file)) return null
      const result = await transformWithEsbuild(code, id, {
        loader: 'jsx',
        jsx: 'transform',
        jsxFactory: FACTORY,
        jsxFragment: FRAGMENT,
        sourcemap: true,
      })
      // Prepending the renderer import shifts the map down one line.
      if (
        !result.code.includes(`${RENDERER}.createElement`) &&
        !result.code.includes(`${RENDERER}.Fragment`)
      ) {
        return { code: result.code, map: result.map }
      }
      const inject =
        `import { servicenowUiRendererSnabbdom as ${RENDERER} } from '@servicenow/ui-mega';`
      const map = result.map
      if (map && typeof map === 'object') map.mappings = ';' + map.mappings
      return { code: `${inject}\n${result.code}`, map }
    },
  }
}

// Vite's dev-server dependency pre-bundler (`optimizeDeps`) sweeps every
// @servicenow/@devsnc package reachable from a bare import and bundles it with
// its own esbuild pass — separate from, and blind to, the Vite plugin
// pipeline above. It never runs snSnabbdomJsx's `transform` hook, only
// whatever `optimizeDeps.esbuildOptions` the caller configures. So a package
// like now-icon, whose `cache.js` has raw JSX with no per-file pragma import
// (same classic-pragma convention as the rest of the SDK, meant to be wired
// up by the platform's own webpack build), gets its JSX compiled by esbuild's
// DEFAULT `React.createElement`/`React.Fragment` pragma — undefined at
// runtime — instead of ours, throwing "React is not defined".
//
// This is a plain esbuild plugin, for `optimizeDeps.esbuildOptions.plugins`
// — NOT esbuild's `inject` option. `inject` looked like the natural fit (it's
// exactly what snSnabbdomJsx does per-file: auto-import a pragma binding
// wherever it's referenced), but Vite's dependency SCANNER — the lightweight
// esbuild pass it runs first just to enumerate what needs pre-bundling —
// blanket-marks virtually every resolved path external, and esbuild refuses
// to treat an `inject`-listed file as external at the same time, so it always
// throws ("The injected path ... cannot be marked as external") regardless of
// where the shim file lives. Prepending the import as file content in onLoad
// sidesteps that: during the scan phase these files are simply never loaded
// (they're external, so onLoad never fires — no conflict), and during the
// real pre-bundle pass onLoad fires normally and the prepended import
// resolves through snInstanceModules to the instance's @servicenow/ui-mega
// bundle. A no-op for files that don't actually
// contain JSX.
export function snJsxPragmaEsbuildPlugin() {
  const PRAGMA_IMPORT =
    "import { servicenowUiRendererSnabbdom as __snRenderer } from '@servicenow/ui-mega';\n"
  return {
    name: 'sn-jsx-pragma',
    setup(build) {
      build.onLoad({ filter: /[\\/]node_modules[\\/](@servicenow|@devsnc)[\\/].*\.jsx?$/ }, async (args) => {
        const contents = await fs.promises.readFile(args.path, 'utf8')
        return { contents: PRAGMA_IMPORT + contents, loader: 'jsx' }
      })
    },
  }
}

// Dev-server endpoint backing the preview's boot-time theme discovery. It
// uses the supplied connection, or `now-sdk query` for standalone SDK callers.
// Responds at THEME_LOOKUP_ROUTE with
// `{ result: [{ sys_id, name }] }` or `{ error }` on failure.
// Dev-only — there is no build-time equivalent.
export function snThemeLookup({ profile, connection }) {
  let cachedRecords
  let bootError
  let bootPromise

  function sortThemes(records) {
    return [...records].sort((a, b) =>
      String(a?.name ?? '').localeCompare(String(b?.name ?? ''), undefined, {
        sensitivity: 'base',
      }),
    )
  }

  async function queryThemes() {
    if (connection) {
      if (!connection.ok) throw new Error(connection.reason)
      const url = new URL(`/api/now/table/${THEME_TABLE}`, connection.target)
      url.searchParams.set('sysparm_fields', 'sys_id,name')
      const response = await fetch(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${connection.user}:${connection.pass}`).toString('base64')}`,
          Accept: 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      })
      if (!response.ok) {
        throw new Error(`Instance theme lookup failed (HTTP ${response.status}).`)
      }
      const body = await response.json()
      if (!Array.isArray(body?.result)) {
        throw new Error('Instance theme lookup returned an invalid theme list.')
      }
      return sortThemes(body.result)
    }
    return new Promise((resolve, reject) => {
      const args = [
        'now-sdk',
        'query',
        THEME_TABLE,
        '--query', '',
        '-o', 'json',
      ]
      if (profile) args.push('--profile', profile)

      execFile(
        'pnpm',
        args,
        { timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            const detail = String(stderr || err.message).trim()
            return reject(
              new Error(
                err.code === 'ENOENT'
                  ? 'pnpm not found on PATH (needed to run now-sdk theme lookup).'
                  : `now-sdk theme lookup failed: ${detail}`,
              ),
            )
          }

          // now-sdk prints a JSON payload to stdout, but
          // guard against any leading/trailing noise before parsing.
          const text = String(stdout)
          const start = text.indexOf('{')
          const end = text.lastIndexOf('}')
          let body
          try {
            body = JSON.parse(text.slice(start, end + 1))
          } catch {
            return reject(new Error('Could not parse the theme list returned by now-sdk.'))
          }

          const records = Array.isArray(body.records)
            ? body.records
            : (Array.isArray(body.result) ? body.result : [])
          resolve(sortThemes(records))
        },
      )
    })
  }

  function bootLoadThemes() {
    if (!bootPromise) {
      bootPromise = queryThemes()
        .then((records) => {
          cachedRecords = records
          bootError = undefined
          return records
        })
        .catch((err) => {
          bootError = String(err?.message || err)
          cachedRecords = undefined
          throw err
        })
    }
    return bootPromise
  }

  return {
    name: 'sn-theme-lookup',
    configureServer(server) {
      // One lookup per dev-server boot. The theme list is effectively static,
      // so requests can serve from memory instead of shelling out every time.
      bootLoadThemes().catch((err) => {
        console.warn(`[sn-next-ui] theme lookup bootstrap failed: ${String(err?.message || err)}`)
      })

      server.middlewares.use(THEME_LOOKUP_ROUTE, async (_req, res) => {
        const fail = (status, error) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error }))
        }

        if (!cachedRecords && bootPromise) {
          try {
            await bootPromise
          } catch {
            // fall through to the structured error response below
          }
        }

        if (!cachedRecords) {
          return fail(502, bootError || 'Theme lookup cache is unavailable.')
        }

        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ result: cachedRecords }))
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Dependency deduplication plugin.
//
// pnpm installs packages at precise versions, which means a component project
// that pulls in many @servicenow/* packages can end up with several versions of
// the same transitive dependency all bundled into the output. This plugin scans
// node_modules/.pnpm, finds packages installed at more than one version, and
// wires up Vite resolve.alias entries that point every version to the highest
// installed one. The result: a single copy per package in the bundle.
//
// `excludePackages` lists package names that must NOT be deduplicated — use
// this when a package has intentional API-breaking version splits and mixing
// versions would break runtime behaviour.
// ---------------------------------------------------------------------------
export function snDedupPlugin({ projectRoot, excludePackages = [] } = {}) {
  return {
    name: 'sn-dedup',
    enforce: 'pre',
    async config() {
      const { aliases, dedupedPackages } = resolveDedupAliases({ projectRoot, excludePackages })
      if (dedupedPackages.length > 0) {
        console.log(
          `[sn-next-ui] dedup: aliasing ${dedupedPackages.length} packages to their latest installed version`,
        )
      }
      return { resolve: { alias: aliases } }
    },
  }
}

// ---------------------------------------------------------------------------
// Hot code patch plugin.
//
// Applies user-defined code patches to npm package files as Vite loads them.
// Useful for fixing broken third-party dependencies without forking packages:
// add missing exports, replace incorrect imports, or remove problematic code.
//
// `patchRules` is a plain object keyed by package-relative path
// (the part of the file path after `node_modules/`). Each rule may have:
//   replacePattern + replaceWith  — global regex replace
//   prependCode                   — insert code before the file
//   appendCode                    — insert code after the file
//   applyToVersions               — semver range; patch is skipped outside it
//
// Call patchManager.printStats() after a build to audit which rules matched.
// ---------------------------------------------------------------------------
export function snHotPatchPlugin({ patchRules } = {}) {
  const manager = new PatchManager(patchRules ?? {})
  return {
    name: 'sn-hot-patch',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0]
      if (!/\.(jsx?|tsx?)$/.test(file)) return null
      const patched = manager.applyPatch(file, code)
      return patched != null ? { code: patched } : null
    },
    // Expose the manager so callers can call manager.printStats() after a build.
    get patchManager() {
      return manager
    },
  }
}

// ---------------------------------------------------------------------------
// Bundle duplicate analysis plugin (opt-in, build mode only).
//
// After bundling, inspects every module ID in the output and reports packages
// that appear at more than one version — the ones adding dead weight to the
// bundle. Add the reported names to `excludePackages` in snDedupPlugin to
// keep them separate, or let snDedupPlugin collapse them to a single version.
//
// This plugin is NOT included in snNextUiPlugins(). Add it manually to your
// Vite config when you want a one-off audit:
//
//   plugins: [...snNextUiPlugins({ ... }), snBundleAnalysisPlugin()]
// ---------------------------------------------------------------------------
export function snBundleAnalysisPlugin() {
  return {
    name: 'sn-bundle-analysis',
    enforce: 'post',
    generateBundle(_options, bundle) {
      // name → { versions: Map<version, { modules: number, bytes: number }> }
      const packages = new Map()

      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        for (const [moduleId, mod] of Object.entries(chunk.modules ?? {})) {
          // Extract name and version from pnpm's virtual-store path.
          // Examples:
          //   …/.pnpm/lodash@4.17.21/node_modules/lodash/…
          //   …/.pnpm/@scope+pkg@1.2.3/node_modules/@scope/pkg/…
          const m = moduleId.match(
            /node_modules[\/]\.pnpm[\/](@?[^@\/]+(?:\+[^@\/]+)?)@([^\/_(]+)/,
          )
          if (!m) continue
          const name = m[1].replace(/\+/g, '/') // @scope+pkg → @scope/pkg
          const version = m[2]

          let pkg = packages.get(name)
          if (!pkg) {
            pkg = { versions: new Map() }
            packages.set(name, pkg)
          }
          let vInfo = pkg.versions.get(version)
          if (!vInfo) {
            vInfo = { modules: 0, bytes: 0 }
            pkg.versions.set(version, vInfo)
          }
          vInfo.modules++
          vInfo.bytes += mod.renderedLength ?? 0
        }
      }

      // Filter to packages present at more than one version.
      const duplicates = []
      for (const [name, { versions }] of packages) {
        if (versions.size < 2) continue
        const versionList = Array.from(versions.entries())
          .map(([v, info]) => ({ version: v, modules: info.modules, bytes: info.bytes }))
          .sort((a, b) => b.bytes - a.bytes)
        const overhead =
          versionList.reduce((s, v) => s + v.bytes, 0) - versionList[0].bytes
        duplicates.push({ name, versions: versionList, overhead })
      }

      if (duplicates.length === 0) {
        console.log('[sn-next-ui] bundle analysis: no duplicate packages detected')
        return
      }

      const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`
      duplicates.sort((a, b) => b.overhead - a.overhead)
      console.log(
        `\n[sn-next-ui] bundle analysis: ${duplicates.length} package(s) with duplicate versions\n`,
      )
      for (const { name, versions, overhead } of duplicates.slice(0, 10)) {
        console.log(`  ${name}  (overhead ~${kb(overhead)})`)
        for (const { version, modules, bytes } of versions) {
          console.log(
            `    ${version.padEnd(14)} ${String(modules).padStart(4)} modules  ${kb(bytes)}`,
          )
        }
      }
      if (duplicates.length > 10) {
        console.log(`  … and ${duplicates.length - 10} more`)
      }
      console.log()
    },
  }
}
