// Shared constants for the Storybook manager panel/toolbar and preview iframe.
// Keep this module data-only: manager.js and preview.js are browser bundles,
// so they cannot import node-only code from the core plugin package.
//
// NOTE: THEME_LOOKUP_ROUTE is intentionally duplicated in the core package.
// The browser-side preview cannot import the node-side server middleware, so
// both sides define the same route string as a stable wire contract.

export const ADDON_ID = 'sn-next-ui'
export const PANEL_ID = `${ADDON_ID}/panel`
export const TOOL_ID = `${ADDON_ID}/toolbar`
export const THEME_GLOBAL = 'snTheme'

// Preview to manager: current connection status + resolved theme list. Re-emits
// after preview boot when live themes are merged in.
export const EVENT_STATUS = `${ADDON_ID}/status`
// Manager to preview: re-emit status (panel/toolbar mounted after preview boot).
export const EVENT_REQUEST_STATUS = `${ADDON_ID}/request-status`

// Dev-server endpoint the preview calls to retrieve themes. The core middleware
// serves this from its boot-time in-memory cache.
export const THEME_LOOKUP_ROUTE = '/__sn-next-ui/themes'

// Initial fallback theme payload used before the preview loads live themes.
// Live instance themes are fetched and merged after boot.
export const DEFAULT_THEMES = [
  {
    name: 'Polaris',
    appConfigSysId: 'e42a5af4c700201072b211d4d8c2607c',
    themeId: '31bf91ae07203010e03948f78ad30095',
  },
]

// Build the instance theme stylesheet URL for /$uxappimmutables.do.
// Query parameters are emitted verbatim (no percent-encoding changes) because
// the platform expects this exact request shape.
export function themeHref(theme) {
  const query = [
    'sysparm_request_type=ux_theme',
    `sysparm_app_config_sys_id=${theme.appConfigSysId}`,
    `themeId=${theme.themeId}`,
    `sysparm_use_cache_buster=false`,
    'deviceAdaptiveStyles=true',
  ].join('&')
  return `/$uxappimmutables.do?${query}`
}
