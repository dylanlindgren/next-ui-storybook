import { themeHref } from './constants.js'

// Render the <head> markup injected into the Storybook preview iframe. That way
// the instance Next Experience runtime is ready before any story renders:
//
//   1. A `process`/`global` shim — some instance bundles reference these Node
//      globals; define them before any module runs.
//   2. The instance theme stylesheet (served via the /$uxappimmutables.do endpoint),
//      tagged with a stable id so the preview decorator can swap its href when
//      the active theme changes.
//   3. snComponentLoader.dev.js (served at the iframe root from the @servicenow/cli
//      package via Storybook's staticDirs). The polyfills it can fetch are NOT
//      served: the loader only requests them on browsers lacking native Custom
//      Elements / Shadow DOM / ES6 templates, and Storybook dev targets modern
//      browsers, where it fetches none.
//   4. The Next Experience runtime bootstrap, imported from the instance over
//      the /uxasset proxy — this boots the runtime so components can render.
//
// The instance Next Experience packages the component imports are loaded on
// demand by the snInstanceModules plugin.

export const THEME_LINK_ID = 'sn-next-ui-theme'
export const SHELL_STYLE_ID = 'sn-next-ui-shell'

// Base dev-shell CSS: full-height reset, the
// default Next Experience body type/background (driven by the instance theme's CSS custom
// properties), and the `.sn-tooltip` styles components portal into <body>.
const SHELL_CSS = `
html,
body {
  height: 100%;
  margin: 0;
  padding: 0;
}

body {
  font-family: "Source Sans Pro", "Helvetica Neue", Arial;
  font-size: 13px;
  line-height: 1.42857;
  background-color: RGB(var(--now-color_background--primary, 255, 255, 255));
}

.sn-tooltip {
  align-items: center;
  background-color: rgba(0, 0, 0, .8);
  border-radius: 2px;
  color: rgba(255, 255, 255, 1);
  display: inline-flex;
  font: 12px "Source Sans Pro", "Helvetica Neue", Helvetica, Arial, sans-serif;
  height: auto;
  justify-content: center;
  max-width: 320px;
  padding: 8px;
  text-align: center;
  z-index: 1070;
  position: absolute;
  visibility: hidden;
  white-space: normal;
  left: 0;
  top: 0;
}
`

export function renderPreviewHead(theme) {
  const href = themeHref(theme)
  return `
<script>
  window.global = window.global || window
  window.process = window.process || { env: { NODE_ENV: 'development' } }
</script>

<style id="${SHELL_STYLE_ID}">${SHELL_CSS}</style>

<link id="${THEME_LINK_ID}" data-sn-theme="${escapeAttr(theme.name)}" rel="stylesheet" href="${escapeAttr(href)}" />

<script type="text/javascript" src="/snComponentLoader.dev.js"></script>
<script type="text/javascript">
  // Boots the loader (dispatches WebComponentsReady and resolves the readiness
  // promise). On a modern browser it fetches no polyfills, so polyfillBaseUrl is
  // never hit — we intentionally don't serve a /scripts/polyfills/ dir.
  window.__snComponentLoaderReady = snComponentLoader.load([], {
    polyfillBaseUrl: '/scripts/polyfills/',
  })
</script>

<script type="module">
  import '/uxasset/externals/@devsnc/library-uxf/index.jsdbx'
</script>
`
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
