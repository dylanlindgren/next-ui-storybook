// The instance bundle exposes each platform package under a namespace key.
// NAMESPACES maps a bare import to that key; the public names to re-export come
// from PLATFORM_EXPORTS, generated at build time by lexing the installed
// @servicenow/* packages (see scripts/generate-mega-names.mjs). Add an entry to
// NAMESPACES (and re-run the generator) if a component imports named bindings
// from another platform package. Components (now-button, etc.) are NOT here —
// they load their own module as side-effect/default imports.
//
// See plugins.js (snInstanceModules) and the single-instance note there.

import { PLATFORM_EXPORTS } from './mega-names.generated.js'

export const externalUrlFor = (request) =>
  `/uxasset/externals/${request}/index.jsdbx`

const NAMESPACES = {
  '@servicenow/ui-core': 'servicenowUiCore',
  '@servicenow/ui-renderer-snabbdom': 'servicenowUiRendererSnabbdom',
  'sn-translate': 'snTranslate',
}

export const MEGA_PACKAGES = Object.fromEntries(
  Object.entries(NAMESPACES).map(([pkg, namespace]) => {
    const gen = PLATFORM_EXPORTS[pkg]
    if (!gen) {
      throw new Error(
        `[sn-next-ui] no generated exports for ${pkg}. Run "pnpm gen:mega-names" ` +
          'to regenerate src/mega-names.generated.js.',
      )
    }
    return [pkg, { namespace, names: gen.names, hasDefault: gen.hasDefault }]
  }),
)
