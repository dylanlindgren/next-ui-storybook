// Core constants for the Vite plugins. Pure data — no node- or browser-only
// imports. Manager/preview-specific constants (panel ids, event channels,
// default themes) live in the Storybook addon, not here.

// Instance table the theme lookup reads: sys_id to themeId, name to label.
export const THEME_TABLE = 'sys_ux_theme'

// Dev-server route the preview fetches to discover themes. A dev-server
// middleware (see plugins.js, snThemeLookup) uses the shared instance connection
// when supplied, otherwise `now-sdk query`.
export const THEME_LOOKUP_ROUTE = '/__sn-next-ui/themes'

// Project component source, relative to the consumer root. The scss + jsx
// plugins scope to this directory.
export const DEFAULT_COMPONENT_SRC_DIR = 'src/now-ui'

// Leave profile selection to the integration (connect defaults to snc "default").
export const DEFAULT_PROFILE = null