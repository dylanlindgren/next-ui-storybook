// Public API for @dylanlindgren/sn-next-ui-connect.
//
// This package is the connection boundary used by local dev integrations
// (for example, the Storybook preset) to:
// 1) resolve instance auth from SN_* overrides or snc profiles/macOS Keychain,
// 2) build an authenticated Vite proxy map for instance-backed assets/APIs.
//
// Keep this module as a thin, stable barrel so consumers can import from one
// place without depending on internal file layout.

// Resolve a usable ServiceNow connection descriptor and build the Vite
// `server.proxy` config from it.
export { resolveSncConnection, buildProxy } from './proxy.js'

// Export keychain constants so callers can reference/log the expected lookup
// targets when diagnosing credential resolution issues.
export {
	KEYCHAIN_SERVICE,
	KEYCHAIN_ACCOUNT,
	DEFAULT_SNC_PROFILE,
} from './constants.js'
