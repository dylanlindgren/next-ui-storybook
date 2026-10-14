// Public API for @dylanlindgren/next-ui-storybook-vite.
//
// `snNextUiPlugins({ mode })` is the one-call entry both consumers use:
//   - the Storybook addon calls it with mode: 'dev' in its viteFinal hook
//   - the build package calls it with mode: 'build' for the deployable artifact
// The individual plugins and helpers are also exported for advanced wiring.

import {
  snSnabbdomJsx,
  snInstanceModules,
  snScssAsString,
  snPlatformAssetBundleFormat,
  snThemeLookup,
  snDedupPlugin,
  snHotPatchPlugin,
  snBundleAnalysisPlugin,
  snJsxPragmaEsbuildPlugin,
} from './plugins.js'

export {
  snSnabbdomJsx,
  snInstanceModules,
  snScssAsString,
  snPlatformAssetBundleFormat,
  snThemeLookup,
  snDedupPlugin,
  snHotPatchPlugin,
  snBundleAnalysisPlugin,
  snJsxPragmaEsbuildPlugin,
} from './plugins.js'
export { PatchManager } from './patch-manager.js'
export { externalUrlFor, MEGA_PACKAGES } from './mega-tables.js'
export { exists, readJson } from './fs-utils.js'
export {
  THEME_TABLE,
  THEME_LOOKUP_ROUTE,
  DEFAULT_COMPONENT_SRC_DIR,
  DEFAULT_PROFILE,
} from './constants.js'

// Compose the ordered plugin set for a given mode. The plugins are returned
// `enforce: 'pre'` so the caller can `unshift`/prepend them ahead of Vite's own.
//
//   mode  'dev'   — instance modules loaded from the instance at runtime,
//                   SCSS→string (unminified), and the theme-lookup dev-server
//                   middleware. A component or style edit triggers a full page
//                   reload.
//   mode  'build' — instance modules left external, SCSS→string (minified).
//                   No theme-lookup middleware.
export function snNextUiPlugins({
  mode = 'dev',
  componentSrcDir,
  projectRoot,
  profile,
  connection,
  excludePackages = [],
  patchRules,
} = {}) {
  if (mode !== 'dev' && mode !== 'build') {
    throw new Error(`[sn-next-ui] snNextUiPlugins: invalid mode "${mode}" (expected 'dev' or 'build')`)
  }
  if (!componentSrcDir) {
    throw new Error('[sn-next-ui] snNextUiPlugins requires a componentSrcDir')
  }
  if (!projectRoot) {
    throw new Error('[sn-next-ui] snNextUiPlugins requires a projectRoot')
  }

  const plugins = [
    snDedupPlugin({ projectRoot, excludePackages }),
    snSnabbdomJsx({ componentSrcDir }),
    snInstanceModules({ mode, projectRoot }),
    snScssAsString({ componentSrcDir, projectRoot, mode }),
    snPlatformAssetBundleFormat({ mode }),
  ]

  // Hot-patch plugin is only added when the caller supplies rules — no-op
  // otherwise so there's no overhead from an empty PatchManager.
  if (patchRules && Object.keys(patchRules).length > 0) {
    plugins.push(snHotPatchPlugin({ patchRules }))
  }

  // The theme-lookup middleware only makes sense against a running dev server.
  if (mode === 'dev') {
    plugins.push(snThemeLookup({ profile, connection }))
  }

  return plugins
}
