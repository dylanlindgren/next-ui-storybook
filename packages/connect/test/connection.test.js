import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

import {
  resolveSncConnection,
  buildProxy,
  KEYCHAIN_SERVICE,
  KEYCHAIN_ACCOUNT,
  DEFAULT_SNC_PROFILE,
} from '../src/index.js'

const config = {
  profiles: {
    default: { host: 'https://dev.example.com/', username: 'admin', loginmethod: 'basic' },
    other: { host: 'other.example.com', username: 'bob' },
    sso: { host: 'https://sso.example.com', username: 'sue', loginmethod: 'oauth' },
  },
}

function deps(overrides = {}) {
  return {
    platform: 'darwin',
    readConfigFile: () => JSON.stringify(config),
    readKeychainPassword: () => '{"password":"test-password"}',
    ...overrides,
  }
}

test('defaults to the snc default profile and uses its alias as the Keychain account', () => {
  const accounts = []
  const conn = resolveSncConnection({ env: {} }, deps({
    readKeychainPassword: (profile) => {
      accounts.push(profile)
      return '{"password":"test-password"}'
    },
  }))
  assert.deepEqual(conn, {
    ok: true,
    source: 'snc',
    profile: 'default',
    loginmethod: 'basic',
    target: 'https://dev.example.com',
    user: 'admin',
    pass: 'test-password',
  })
  assert.deepEqual(accounts, ['default'])
  assert.equal(KEYCHAIN_SERVICE, 'snc')
  assert.equal(KEYCHAIN_ACCOUNT, 'default')
  assert.equal(DEFAULT_SNC_PROFILE, 'default')
})

test('selects explicit profiles before SN_PROFILE, with null selecting the environment/default', () => {
  const readers = deps()
  assert.equal(resolveSncConnection({ profile: 'other', env: { SN_PROFILE: 'default' } }, readers).profile, 'other')
  assert.equal(resolveSncConnection({ env: { SN_PROFILE: 'other' } }, readers).profile, 'other')
  assert.equal(resolveSncConnection({ profile: null, env: {} }, readers).profile, 'default')
  assert.equal(resolveSncConnection({ profile: '', env: {} }, readers).profile, 'default')
  assert.equal(resolveSncConnection({ profile: 'other', env: {} }, readers).target, 'https://other.example.com')
})

test('environment credentials override profiles without reading config or Keychain on any platform', () => {
  const conn = resolveSncConnection({
    profile: 'missing',
    env: { SN_INSTANCE: 'override.example.com/', SN_USER: 'env-user', SN_PASS: 'env-password' },
  }, deps({
    platform: 'linux',
    readConfigFile: () => assert.fail('must not read config'),
    readKeychainPassword: () => assert.fail('must not read Keychain'),
  }))
  assert.deepEqual(conn, {
    ok: true,
    source: 'env',
    loginmethod: 'basic',
    target: 'https://override.example.com',
    user: 'env-user',
    pass: 'env-password',
  })
})

test('defaults the options and env to process.env', (t) => {
  const saved = { ...process.env }
  t.after(() => { process.env = saved })
  process.env = {
    SN_INSTANCE: 'https://env.example.com/',
    SN_USER: 'env-user',
    SN_PASS: 'env-password',
  }
  assert.equal(resolveSncConnection().source, 'env')
  assert.equal(resolveSncConnection().target, 'https://env.example.com')
})

test('partial environment credentials fail explicitly without selecting a different instance', () => {
  for (const env of [{ SN_INSTANCE: 'dev.example.com' }, { SN_USER: 'user' }, { SN_PASS: 'test-password' }]) {
    const conn = resolveSncConnection({ env }, deps({
      readConfigFile: () => assert.fail('must not fall back'),
    }))
    assert.equal(conn.ok, false)
    assert.equal(conn.source, 'env')
    assert.match(conn.reason, /Set SN_INSTANCE, SN_USER and SN_PASS together/)
    assert.ok(!JSON.stringify(conn).includes('test-password'))
  }
})

test('rejects malformed, non-HTTP and credential-bearing instance URLs without exposing them', () => {
  for (const host of ['not a host', 'ftp://dev.example.com', 'https://user:test-password@dev.example.com', 'https://dev.example.com/path']) {
    const conn = resolveSncConnection({
      env: { SN_INSTANCE: host, SN_USER: 'user', SN_PASS: 'test-password' },
    }, deps())
    assert.equal(conn.ok, false)
    assert.match(conn.reason, /valid HTTP\(S\)/)
    assert.ok(!JSON.stringify(conn).includes('test-password'))
  }
})

test('missing, malformed or invalid snc configuration produces actionable failures', () => {
  for (const readConfigFile of [
    () => { throw new Error('missing file') },
    () => 'not-json-test-password',
    () => 'null',
    () => '{"profiles":[]}',
  ]) {
    const conn = resolveSncConnection({ env: {} }, deps({ readConfigFile }))
    assert.equal(conn.ok, false)
    assert.equal(conn.source, 'snc')
    assert.match(conn.reason, /snc config/)
    assert.ok(!conn.reason.includes('test-password'))
  }
})

test('unknown profiles, OAuth, missing fields and non-macOS platforms fail before Keychain access', () => {
  const readers = deps({ readKeychainPassword: () => assert.fail('must not read Keychain') })
  assert.match(resolveSncConnection({ profile: 'missing', env: {} }, readers).reason, /not found/)
  assert.match(resolveSncConnection({ profile: 'sso', env: {} }, readers).reason, /only "basic"/)
  assert.match(resolveSncConnection({ env: {} }, { ...readers, platform: 'linux' }).reason, /only supported on macOS/)
  for (const entry of [{ host: 'dev.example.com' }, { username: 'admin' }, { host: 'not a host', username: 'admin' }]) {
    const conn = resolveSncConnection({ env: {} }, {
      ...readers,
      readConfigFile: () => JSON.stringify({ profiles: { default: entry } }),
    })
    assert.equal(conn.ok, false)
    assert.match(conn.reason, /missing a host or username|invalid instance URL/)
  }
})

test('Keychain failures and malformed secret records never expose secrets or command output', () => {
  const readers = [
    () => { throw new Error('command output test-password') },
    () => 'not-json-test-password',
    () => 'null',
    () => '{}',
    () => '{"password":""}',
    () => '{"password":42}',
  ]
  for (const readKeychainPassword of readers) {
    const conn = resolveSncConnection({ env: {} }, deps({ readKeychainPassword }))
    assert.equal(conn.ok, false)
    assert.match(conn.reason, /Keychain/)
    assert.ok(!JSON.stringify(conn).includes('test-password'))
  }
})

test('proxy preserves platform routes, configured prefixes, auth and session-timeout handling', (t) => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'sn-connect-test-'))
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }))
  writeFileSync(path.join(projectRoot, 'now.config.json'), JSON.stringify({
    development: { proxy: { proxies: ['/custom', '/api'] } },
  }))
  const conn = resolveSncConnection({ env: {} }, deps())
  const { proxy, status } = buildProxy({ conn, projectRoot })
  assert.deepEqual(Object.keys(proxy), ['/custom', '/api', '/uxasset', '/uxta', '/$uxappimmutables.do', '/amb'])
  for (const entry of Object.values(proxy)) {
    assert.equal(entry.target, conn.target)
    assert.equal(entry.headers.Authorization, `Basic ${Buffer.from('admin:test-password').toString('base64')}`)
    assert.equal(entry.headers.origin, conn.target)
    assert.equal(entry.changeOrigin, true)
    assert.equal(entry.secure, true)
  }
  assert.equal(proxy['/amb'].ws, true)
  assert.equal(status.proxyEnabled, true)
  assert.equal(status.source, 'snc')
  assert.ok(!JSON.stringify(status).includes('test-password'))
  assert.equal(status.pass, undefined)
  const emitter = new EventEmitter()
  proxy['/api'].configure(emitter)
  const redirect = { statusCode: 302, headers: { location: '/login.do' } }
  emitter.emit('proxyRes', redirect)
  assert.equal(redirect.statusCode, 401)
  assert.equal(redirect.headers.location, undefined)
  const unrelatedRedirect = { statusCode: 302, headers: { location: '/other' } }
  emitter.emit('proxyRes', unrelatedRedirect)
  assert.equal(unrelatedRedirect.statusCode, 302)
})

test('failed connections disable the proxy and log the reason', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const conn = resolveSncConnection({ profile: 'missing', env: {} }, deps())
  const { proxy, status } = buildProxy({ conn, projectRoot: '/unused' })
  assert.equal(proxy, undefined)
  assert.equal(status.proxyEnabled, false)
  assert.match(warn.mock.calls[0].arguments[0], /profile "missing".*not found/)
})
