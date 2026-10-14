import path from 'node:path'
import { createRequire } from 'node:module'
import { loadEnv } from 'vite'

import {
  snNextUiPlugins,
  DEFAULT_COMPONENT_SRC_DIR,
  DEFAULT_PROFILE,
  snJsxPragmaEsbuildPlugin
} from '@dylanlindgren/next-ui-storybook-vite'
import { resolveSncConnection, buildProxy } from '@dylanlindgren/next-ui-storybook-connect'

import { renderPreviewHead } from './src/preview-head.js'
import { DEFAULT_THEMES } from './src/constants.js'

// ---------------------------------------------------------------------------
// Storybook 10 preset for ServiceNow Next Experience UI components.
// Dev-time only — an instance-backed local development preset. The deployable build
// (@dylanlindgren/sn-next-ui-build) runs the same core plugins in 'build' mode.
//
// Consumer .storybook/main.mjs needs just framework + stories + one addon entry:
//
//   addons: [{ name: '@dylanlindgren/storybook-addon-sn-next-ui', options: {
//     componentSrcDir: 'src/now-ui',   // default; scss/jsx plugins scope here
//   }}]
// Profile and themes are configured via environment (SN_PROFILE) or
// discovered from the instance.
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url)

// NOTE: Storybook auto-loads the manager panel (./manager) and preview
// annotations (./preview) from this package's `exports` map. Don't also register
// them here via managerEntries/previewAnnotations, or each imports twice
// ("Identifier 'preview_*' has already been declared").

function resolveOptions(options) {
  const configDir = options.configDir
  if (!configDir) {
    throw new Error('[sn-next-ui] could not determine configDir from Storybook options')
  }
  const projectRoot = path.resolve(configDir, '..')
  const componentSrcDir = path.resolve(
    projectRoot,
    options.componentSrcDir ?? DEFAULT_COMPONENT_SRC_DIR,
  )
  const profile = process.env.SN_PROFILE ?? options.profile ?? DEFAULT_PROFILE
  return { projectRoot, componentSrcDir, profile }
}

function readOptionalDependencyNames(projectRoot) {
  try {
    const pkg = JSON.parse(
      require('node:fs').readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    )
    const optional = new Set(Object.keys(pkg?.optionalDependencies ?? {}))
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
      for (const name of Object.keys(pkg?.[section] ?? {})) {
        optional.delete(name)
      }
    }
    return [...optional]
  } catch {
    return []
  }
}

function readComponentActionMap(projectRoot) {
  try {
    const manifest = JSON.parse(
      require('node:fs').readFileSync(path.join(projectRoot, 'now-ui.json'), 'utf8'),
    )
    const actionMap = {}

    for (const [componentName, config] of Object.entries(manifest?.components ?? {})) {
      const names = (config?.actions ?? [])
        .map((entry) => entry?.action ?? entry?.name)
        .filter((name) => typeof name === 'string' && name.length > 0)
      if (names.length > 0) actionMap[componentName] = Array.from(new Set(names))
    }

    return actionMap
  } catch {
    return {}
  }
}

function isInstancePackageName(name) {
  if (/^@(servicenow|devsnc)\//.test(name)) return true
  return name === 'sn-translate'
}

// Resolve the connection + proxy once per project/profile. Reading the keychain
// can prompt for access, so memoizing keeps it to one prompt per dev session
// (shared by viteFinal and previewHead).
const _connCache = new Map()
function getConnection(profile, projectRoot) {
  const key = JSON.stringify([projectRoot, profile])
  if (_connCache.has(key)) return _connCache.get(key)
  const env = { ...loadEnv('development', projectRoot, ''), ...process.env }
  const conn = resolveSncConnection({ profile, env })
  const built = { ...buildProxy({ conn, projectRoot }), conn }
  _connCache.set(key, built)
  return built
}

function isLoopbackHost(host) {
  if (host == null || host === false) return true
  if (host === true) return false
  if (typeof host !== 'string') return false
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

export async function viteFinal(viteConfig, options) {
  const { projectRoot, componentSrcDir, profile } = resolveOptions(options)
  const { conn, proxy } = getConnection(profile, projectRoot)

  viteConfig.plugins = viteConfig.plugins ?? []
  // unshift so these enforce:'pre' plugins run before Vite's own.
  viteConfig.plugins.unshift(
    ...snNextUiPlugins({ mode: 'dev', componentSrcDir, projectRoot, profile, connection: conn }),
  )

  // Don't pre-bundle instance-provided modules.
  // The dep optimizer runs before runtime module loading and may try to resolve
  // these from local node_modules (warning on packages that only exist on the
  // instance, e.g. @servicenow/glide). @servicenow/ui-mega is always resolved
  // from the instance; other packages use optionalDependencies as the gate,
  // so real deps like @servicenow/ui-core and @servicenow/ui-renderer-lit stay
  // pre-bundled and their CJS-only runtime deps get discovered normally.
  const optionalDeps = readOptionalDependencyNames(projectRoot)
  const instanceOptionalDeps = optionalDeps.filter(isInstancePackageName)
  viteConfig.optimizeDeps = viteConfig.optimizeDeps ?? {}
  viteConfig.optimizeDeps.exclude = Array.from(
    new Set([
      ...(viteConfig.optimizeDeps.exclude ?? []),
      ...instanceOptionalDeps,
      '@servicenow/ui-mega',
    ]),
  )
  // The dep-scanner has to parse JSX-in-.js while crawling dependencies.
  // Set BOTH config paths for cross-version compatibility:
  // - Vite 7+ (Rolldown): optimizeDeps.rolldownOptions.moduleTypes
  // - Vite 6 and earlier (esbuild): optimizeDeps.esbuildOptions.loader
  // For files under componentSrcDir this really is parse-only — snSnabbdomJsx
  // performs the actual transform, and the pre-bundler never touches local
  // project source anyway. But some @servicenow/@devsnc packages ship vendor
  // .js files containing raw JSX too (e.g. now-icon's cache.js), and THOSE do
  // get swept into this esbuild pre-bundle pass, which runs independently of
  // the Vite plugin pipeline (snSnabbdomJsx never sees them). Without a
  // jsxFactory override esbuild defaults to React.createElement, which is
  // undefined at runtime here ("React is not defined") — so point it at the
  // same pragma names snSnabbdomJsx uses, and prepend the import esbuild
  // would otherwise never add via a plugin (see snJsxPragmaEsbuildPlugin).
  viteConfig.optimizeDeps.rolldownOptions = {
    ...(viteConfig.optimizeDeps.rolldownOptions ?? {}),
    moduleTypes: {
      ...(viteConfig.optimizeDeps.rolldownOptions?.moduleTypes ?? {}),
      '.js': 'jsx',
    },
  }
  viteConfig.optimizeDeps.esbuildOptions = {
    ...(viteConfig.optimizeDeps.esbuildOptions ?? {}),
    loader: {
      ...(viteConfig.optimizeDeps.esbuildOptions?.loader ?? {}),
      '.js': 'jsx',
    },
    jsx: 'transform',
    jsxFactory: '__snRenderer.createElement',
    jsxFragment: '__snRenderer.Fragment',
    plugins: [
      ...(viteConfig.optimizeDeps.esbuildOptions?.plugins ?? []),
      snJsxPragmaEsbuildPlugin(),
    ],
  }

  if (proxy) {
    viteConfig.server = viteConfig.server ?? {}
    const allowRemoteProxy = process.env.SN_NEXT_UI_ALLOW_REMOTE_PROXY === 'true'
    if (!allowRemoteProxy) {
      if (!isLoopbackHost(viteConfig.server.host)) {
        console.warn(
          '[sn-next-ui] credentialed instance proxy is forcing server.host=127.0.0.1. ' +
            'Set SN_NEXT_UI_ALLOW_REMOTE_PROXY=true only if you intentionally want remote access.',
        )
      }
      // Keep the dev proxy local-only by default so the Basic-auth header cannot
      // be relayed from other machines on the network.
      viteConfig.server.host = '127.0.0.1'
    }
    viteConfig.server.proxy = { ...(viteConfig.server.proxy ?? {}), ...proxy }
  }

  return viteConfig
}

export async function previewHead(head, options) {
  const { projectRoot, profile } = resolveOptions(options)
  const { status } = getConnection(profile, projectRoot)
  const actionMap = readComponentActionMap(projectRoot)

  // Expose the password-free connection summary + default themes to the
  // preview iframe (read by ./preview.js, then relayed to the manager panel).
  // The preview discovers and merges the instance's live themes after boot.
  const bootData = JSON.stringify({ status, themes: DEFAULT_THEMES, actionMap })
  const statusScript = `\n<script>window.__SN_NEXT_UI__ = ${bootData};</script>\n`

  return `${head}\n${renderPreviewHead(DEFAULT_THEMES[0])}${statusScript}`
}

export async function staticDirs(entry = [], options) {
  // Serve snComponentLoader.dev.js at the preview-iframe root. It's resolved
  // directly from @servicenow/cli (a dependency of this addon) so we never
  // redistribute ServiceNow's loader ourselves.
  let loaderFile
  try {
    loaderFile = require.resolve(
      '@servicenow/cli/dist/webpack-config-shared-component-folder/snComponentLoader.dev.js',
    )
  } catch (err) {
    throw new Error(
      '[sn-next-ui] Could not resolve snComponentLoader.dev.js from @servicenow/cli. ' +
        'It ships as a dependency of this addon — try reinstalling. ' +
        `Original error: ${err.message}`,
    )
  }

  return [...entry, { from: loaderFile, to: '/snComponentLoader.dev.js' }]
}
