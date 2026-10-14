import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

// A Sass FileImporter that resolves bare package specifiers — e.g.
// `@import '@servicenow/sass-kit/host'` inside a vendor component's SCSS —
// the way Node's own require() resolution would: walk up from the *importing
// file's own directory* through each ancestor's node_modules.
//
// This matters under pnpm: each package gets its own isolated node_modules
// with only its declared deps symlinked in, so `@servicenow/sass-kit`'s
// dependency on `@servicenow/sass-global` lives in sass-kit's node_modules,
// not the top-level project's or the component's that imported sass-kit. A
// single flat `loadPaths` list can't represent that — resolution has to be
// relative to whichever file is doing the importing at each step, exactly
// like `context.containingUrl` gives us here.
//
// Dart Sass applies its normal partial/extension resolution (_name.scss,
// name.scss, name/_index.scss…) to whatever file: URL we return, so we only
// need to locate the package directory, not the exact file.
//
// Bare identifiers that aren't real installed packages (e.g. `@import
// 'theme'` meaning a same-directory partial) are left alone — we return null
// whenever nothing resolves, so Sass's own relative/loadPath resolution
// still applies as it does when this importer isn't consulted.
const SPECIFIER_RE = /^(@[^/]+\/[^/]+|[^/]+)(\/.*)?$/

// `rootFile` is the entry stylesheet's own path — used as the starting point
// for imports written directly in the root stylesheet, where
// `context.containingUrl` may not yet be populated.
export function createNodeFileImporter(rootFile) {
  return {
    findFileUrl(url, context) {
      // Skip relative/absolute paths, home-relative, and anything with a URI
      // scheme (file:, sass:, https:, ...) — let Sass's own resolution handle those.
      if (/^[./~]/.test(url) || /^[a-z][\w+.-]*:/i.test(url)) return null

      const match = url.match(SPECIFIER_RE)
      if (!match) return null
      const [, pkg, sub] = match

      const containingFile = context?.containingUrl
        ? fileURLToPath(context.containingUrl)
        : rootFile
      if (!containingFile) return null

      let dir = path.dirname(containingFile)
      for (;;) {
        const candidate = path.join(dir, 'node_modules', pkg)
        if (fs.existsSync(candidate)) {
          // Resolve the real (pnpm store) location so subsequent imports from
          // *within* that package walk up through ITS OWN node_modules, not
          // the importer's — this is what lets multi-hop chains
          // (sass-kit -> sass-global) resolve correctly.
          const real = fs.realpathSync(candidate)
          const target = sub ? path.join(real, sub) : path.join(real, 'index')
          return pathToFileURL(target)
        }
        const parent = path.dirname(dir)
        if (parent === dir) return null
        dir = parent
      }
    },
  }
}
