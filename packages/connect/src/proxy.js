import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_SNC_PROFILE } from './constants.js'
import { normalizeInstanceUrl, resolveSncProfileAuth } from './snc-profile.js'

// Resolve the instance connection. Returns `ok` plus a password-free summary
// for the manager panel, and (when ok) the secret bits needed for the auth
// header.
export function resolveSncConnection({ profile, env = process.env } = {}, profileDeps = {}) {
  if (env.SN_INSTANCE || env.SN_USER || env.SN_PASS) return fromEnvConnection(env)
  const selectedProfile = profile || env.SN_PROFILE || DEFAULT_SNC_PROFILE
  try {
    return resolveSncProfileAuth(selectedProfile, profileDeps)
  } catch (error) {
    return {
      ok: false,
      source: 'snc',
      profile: selectedProfile,
      reason: error.message,
    }
  }
}

function fromEnvConnection(env) {
  const target = env.SN_INSTANCE
  const user = env.SN_USER
  const pass = env.SN_PASS
  if (!target || !user || !pass) {
    return {
      ok: false,
      source: 'env',
      reason: 'Incomplete environment credentials. Set SN_INSTANCE, SN_USER and SN_PASS together.',
    }
  }
  try {
    return {
      ok: true,
      source: 'env',
      loginmethod: 'basic',
      target: normalizeInstanceUrl(target),
      user,
      pass,
    }
  } catch {
    return {
      ok: false,
      source: 'env',
      reason: 'SN_INSTANCE must be a valid HTTP(S) instance origin without embedded credentials.',
    }
  }
}

// Optional project-level path prefixes (from now.config.json) are merged with
// the required platform endpoints below when building Vite proxy entries.
function readSdkProxyPrefixes(projectRoot) {
  try {
    const nowConfig = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'now.config.json'), 'utf8'),
    )
    return nowConfig?.development?.proxy?.proxies ?? []
  } catch {
    return []
  }
}

// Build the Vite server.proxy map from a resolved connection. Returns
// { proxy, status }; `status` is a password-free summary for the panel, and
// `proxy` is undefined when the connection isn't usable.
export function buildProxy({ conn, projectRoot }) {
  const status = {
    proxyEnabled: false,
    source: conn.source,
    profile: conn.profile,
    target: conn.target,
    user: conn.user,
    loginmethod: conn.loginmethod,
    reason: conn.reason,
  }

  if (!conn.ok) {
    console.warn(
      `[sn-next-ui] instance proxy disabled — ${conn.reason}\n` +
      '            The Next Experience runtime, components, and theme all load from ' +
      'the instance, so nothing will render until this is resolved.',
    )
    return { proxy: undefined, status }
  }

  const configured = readSdkProxyPrefixes(projectRoot)
  // All over the same authed HTTP proxy: /uxasset and /uxta.
  const httpPrefixes = Array.from(new Set([...configured, '/uxasset', '/uxta', '/api', '/$uxappimmutables.do']))


  // Origin header keeps Glide's CORS policy happy (set to the instance URL);
  // changeOrigin rewrites the Host header to match.
  const headers = {
    Authorization: `Basic ${Buffer.from(`${conn.user}:${conn.pass}`).toString('base64')}`,
    origin: conn.target,
  }

  // Intercept ServiceNow session-timeout redirects. When a session expires,
  // the instance returns a 302 to /login.do. In a dev-server context the
  // browser follows the redirect inside a fetch/XHR, gets the login HTML as
  // a "successful" 200, and the component silently fails. Rewriting to 401
  // lets the component (or developer tooling) handle unauthenticated state
  // explicitly instead of chasing an infinite redirect loop.
  function sessionTimeoutInterceptor(proxyServer) {
    // Attach once per proxy target config; Vite/http-proxy will invoke this
    // configure hook as each proxy entry is initialized.
    proxyServer.on('proxyRes', (proxyRes) => {
      if (proxyRes.statusCode !== 302) return
      const location = proxyRes.headers['location'] ?? ''
      if (location.includes('login.do') || location.includes('/login')) {
        proxyRes.statusCode = 401
        delete proxyRes.headers['location']
      }
    })
  }

  const proxy = {}
  for (const prefix of httpPrefixes) {
    // Use the same authenticated upstream behavior for all HTTP routes.
    proxy[prefix] = {
      target: conn.target,
      changeOrigin: true,
      secure: true,
      headers,
      configure: sessionTimeoutInterceptor,
    }
  }
  // The AMB realtime channel is a websocket.
  proxy['/amb'] = {
    target: conn.target,
    changeOrigin: true,
    secure: true,
    ws: true,
    headers,
    configure: sessionTimeoutInterceptor,
  }

  status.proxyEnabled = true
  status.prefixes = [...httpPrefixes, '/amb']
  return { proxy, status }
}
