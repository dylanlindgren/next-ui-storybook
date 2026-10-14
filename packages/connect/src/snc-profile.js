import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_SNC_PROFILE, KEYCHAIN_SERVICE } from './constants.js'

const defaultDeps = {
  platform: process.platform,
  readConfigFile: () => readFileSync(join(homedir(), '.snc', 'config.json'), 'utf8'),
  readKeychainPassword: (profile) =>
    execFileSync(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', profile, '-w'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15000,
      },
    ),
}

export function normalizeInstanceUrl(host) {
  const trimmed = host.trim().replace(/\/+$/, '')
  const target = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const url = new URL(target)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username || url.password || url.search || url.hash || url.pathname !== '/'
  ) {
    throw new Error('Instance URL must be an HTTP(S) origin without embedded credentials.')
  }
  return url.origin
}

export function resolveSncProfileAuth(profile = DEFAULT_SNC_PROFILE, deps = {}) {
  if (typeof profile !== 'string' || !profile.trim()) {
    throw new Error('The snc profile name must be a non-empty string.')
  }
  const { platform, readConfigFile, readKeychainPassword } = { ...defaultDeps, ...deps }
  if (platform !== 'darwin') {
    throw new Error(
      'Using an snc profile for credentials is only supported on macOS. ' +
      'Set SN_INSTANCE, SN_USER and SN_PASS on other platforms.',
    )
  }

  let config
  try {
    config = JSON.parse(readConfigFile())
  } catch {
    throw new Error('Could not read or parse the snc config (~/.snc/config.json).')
  }
  const profiles = config?.profiles
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
    throw new Error('The snc config (~/.snc/config.json) does not contain a profiles object.')
  }
  const entry = Object.hasOwn(profiles, profile) ? profiles[profile] : undefined
  if (!entry || typeof entry !== 'object') {
    throw new Error(`snc profile "${profile}" was not found in ~/.snc/config.json.`)
  }
  const loginmethod = entry.loginmethod ?? 'basic'
  if (loginmethod !== 'basic') {
    throw new Error(
      `snc profile "${profile}" uses the "${loginmethod}" login method; only "basic" is supported.`,
    )
  }
  if (
    typeof entry.host !== 'string' || !entry.host.trim() ||
    typeof entry.username !== 'string' || !entry.username.trim()
  ) {
    throw new Error(`snc profile "${profile}" is missing a host or username in ~/.snc/config.json.`)
  }

  let target
  try {
    target = normalizeInstanceUrl(entry.host)
  } catch {
    throw new Error(`snc profile "${profile}" has an invalid instance URL.`)
  }
  let raw
  try {
    raw = readKeychainPassword(profile)
  } catch {
    throw new Error(
      `Could not read the password for snc profile "${profile}" from the macOS Keychain ` +
      `(service "${KEYCHAIN_SERVICE}", account "${profile}").`,
    )
  }
  let secret
  try {
    secret = JSON.parse(raw)
  } catch {
    // JSON.parse errors can include the secret itself.
    throw new Error(`The Keychain item for snc profile "${profile}" is not valid password JSON.`)
  }
  if (typeof secret?.password !== 'string' || secret.password === '') {
    throw new Error(`The Keychain item for snc profile "${profile}" does not contain a password value.`)
  }
  return {
    ok: true,
    source: 'snc',
    profile,
    loginmethod,
    target,
    user: entry.username,
    pass: secret.password,
  }
}
