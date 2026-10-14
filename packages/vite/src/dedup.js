import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findMonorepoRoot } from './find-monorepo-root.js'
import { KNOWN_DEV_DEPENDENCIES } from './known-dev-dependencies.js'

// Matches pnpm's .pnpm virtual-store directory names. Examples:
//   lodash@4.17.21                →  scope: undefined, local: 'lodash',    version: '4.17.21'
//   @scope+pkg@1.2.3              →  scope: '@scope',   local: 'pkg',       version: '1.2.3'
//   lodash@4.17.21_chai@4.3.0    →  (peer suffix stripped) version: '4.17.21'
const PNPM_DIR_RE = /^(?:(@[^+]+)\+)?([^@]+)@([^_@(]+)/

function parsePnpmDir(dirName) {
  const m = dirName.match(PNPM_DIR_RE)
  if (!m) return null
  const [, scope, local, version] = m
  return { name: scope ? `${scope}/${local}` : local, version, dirName }
}

// Compare two version strings numerically, segment by segment. Returns positive
// when a > b, negative when a < b, zero when equal. Pre-release strings (any
// non-numeric segment) sort below a plain numeric one.
function compareVersions(a, b) {
  const parts = (v) =>
    v.split(/[.\-+]/).map((s) => (/^\d+$/.test(s) ? parseInt(s, 10) : s))
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x - y
    } else if (typeof x !== typeof y) {
      return typeof x === 'number' ? 1 : -1 // numeric > string (release > pre-release)
    } else {
      if (x < y) return -1
      if (x > y) return 1
    }
  }
  return 0
}

// Scan node_modules/.pnpm for packages installed at more than one version and
// return a map of name → { version, absolutePath } for the highest version.
// Packages in KNOWN_DEV_DEPENDENCIES or excludePackages are skipped.
function scanDuplicatePackages(monorepoRoot, excludePackages) {
  const pnpmDir = join(monorepoRoot, 'node_modules', '.pnpm')
  if (!existsSync(pnpmDir)) return new Map()

  const skip = new Set([...KNOWN_DEV_DEPENDENCIES, ...(excludePackages ?? [])])

  // name → [{ version, absolutePath }]
  const all = new Map()

  for (const dirName of readdirSync(pnpmDir)) {
    const parsed = parsePnpmDir(dirName)
    if (!parsed) continue
    const { name, version, dirName: dir } = parsed
    if (skip.has(name)) continue

    const absolutePath = join(pnpmDir, dir, 'node_modules', name)
    if (!existsSync(absolutePath)) continue

    const list = all.get(name) ?? []
    list.push({ version, absolutePath })
    all.set(name, list)
  }

  // Only return packages that have more than one installed version — those are
  // the ones that actually create duplicate bundle overhead.
  const duplicates = new Map()
  for (const [name, versions] of all) {
    if (versions.length < 2) continue
    const best = versions.reduce((a, b) =>
      compareVersions(a.version, b.version) > 0 ? a : b,
    )
    duplicates.set(name, best)
  }

  return duplicates
}

// Read a package's "exports" map, if it has one. Packages that declare one
// (e.g. @vitest/utils) resolve sub-path imports to arbitrary files (`./display`
// → `dist/display.js`) rather than a same-named file on disk, so their
// sub-paths can't be aliased by simple string concatenation.
function readPackageExports(absolutePath) {
  try {
    const pkg = JSON.parse(readFileSync(join(absolutePath, 'package.json'), 'utf8'))
    return typeof pkg.exports === 'object' && pkg.exports !== null ? pkg.exports : null
  } catch {
    return null
  }
}

// Pick the file a conditional exports entry resolves to, e.g.
// `{ types: '...', default: './dist/display.js' }` → `./dist/display.js`.
// Recurses into nested condition objects, preferring the conditions an ESM
// import would match.
function resolveExportsTarget(entry) {
  if (typeof entry === 'string') return entry
  if (!entry || typeof entry !== 'object') return null
  for (const key of ['import', 'module', 'browser', 'default', 'require', 'node']) {
    if (key in entry) {
      const resolved = resolveExportsTarget(entry[key])
      if (resolved) return resolved
    }
  }
  return null
}

// Build Vite-compatible alias entries that redirect every installed version of
// a duplicate package to its latest, so the bundle contains only one copy.
//
// Returns:
//   aliases         — array of { find: RegExp, replacement: string } objects
//                     ready for Vite's resolve.alias. Covers bare imports
//                     (`import 'pkg'`) and sub-path imports (`import 'pkg/sub'`).
//   dedupedPackages — names of packages that received aliases (useful for logging).
// Read the project's devDependency names. These are build/test tools that are
// never imported by component source at runtime, so they have no place in the
// bundle and should not receive dedup aliases.
function readDevDependencyNames(projectRoot) {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
    return Object.keys(pkg?.devDependencies ?? {})
  } catch {
    return []
  }
}

export function resolveDedupAliases({ projectRoot, excludePackages = [] } = {}) {
  const root = findMonorepoRoot(projectRoot) ?? projectRoot
  const devDeps = readDevDependencyNames(projectRoot)
  const duplicates = scanDuplicatePackages(root, [...excludePackages, ...devDeps])

  const aliases = []
  const dedupedPackages = []

  for (const [name, { absolutePath }] of duplicates) {
    // Escape regex metacharacters in the package name (e.g. `@` in scoped names).
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    // Bare import: `import 'lodash'`
    aliases.push({
      find: new RegExp(`^${escaped}$`),
      replacement: absolutePath,
    })

    const exportsMap = readPackageExports(absolutePath)
    if (exportsMap) {
      // Sub-paths resolve through the package's own exports map, not the
      // filesystem — alias each declared literal sub-path (e.g. `./display`)
      // straight to its resolved target file. Wildcard patterns (`./*`) can't
      // be resolved statically, so they're left unaliased and fall through to
      // normal resolution.
      for (const [key, entry] of Object.entries(exportsMap)) {
        if (key === '.' || key.includes('*')) continue
        const target = resolveExportsTarget(entry)
        if (!target) continue
        const subpath = key.replace(/^\.\//, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        aliases.push({
          find: new RegExp(`^${escaped}/${subpath}$`),
          replacement: join(absolutePath, target),
        })
      }
    } else {
      // Sub-path import: `import 'lodash/cloneDeep'`
      aliases.push({
        find: new RegExp(`^${escaped}(\\/.*)`),
        replacement: `${absolutePath}$1`,
      })
    }

    dedupedPackages.push(name)
  }

  return { aliases, dedupedPackages }
}
