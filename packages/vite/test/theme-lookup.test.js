import assert from 'node:assert/strict'
import test from 'node:test'
import { snThemeLookup } from '../src/plugins.js'
import { snNextUiPlugins } from '../src/index.js'

const connection = {
  ok: true,
  source: 'snc',
  profile: 'default',
  target: 'https://dev.example.com',
  user: 'admin',
  pass: 'test-password',
}

async function readThemes(plugin) {
  let middleware
  plugin.configureServer({
    middlewares: {
      use(route, handler) {
        assert.equal(route, '/__sn-next-ui/themes')
        middleware = handler
      },
    },
  })
  const response = {
    statusCode: undefined,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(body) { this.body = JSON.parse(body) },
  }
  await middleware({}, response)
  return response
}

test('theme lookup uses the shared connection, returns sorted records, and caches one request', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.origin, connection.target)
    assert.equal(url.pathname, '/api/now/table/sys_ux_theme')
    assert.equal(url.searchParams.get('sysparm_fields'), 'sys_id,name')
    assert.equal(options.headers.Authorization, `Basic ${Buffer.from('admin:test-password').toString('base64')}`)
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal instanceof AbortSignal)
    return {
      ok: true,
      json: async () => ({ result: [{ sys_id: '2', name: 'Zulu' }, { sys_id: '1', name: 'alpha' }] }),
    }
  })
  const plugin = snNextUiPlugins({
    componentSrcDir: '/components',
    projectRoot: '/project',
    connection,
  }).find(({ name }) => name === 'sn-theme-lookup')
  const result = await readThemes(plugin)
  assert.equal(result.statusCode, 200)
  assert.deepEqual(result.body, { result: [{ sys_id: '1', name: 'alpha' }, { sys_id: '2', name: 'Zulu' }] })
  assert.equal((await readThemes(plugin)).statusCode, 200)
  assert.equal(fetchMock.mock.calls.length, 1)
  assert.ok(!JSON.stringify(result.body).includes(connection.pass))
})

test('failed connections return their error without requests or an SDK fallback', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  t.mock.method(globalThis, 'fetch', async () => assert.fail('must not fetch'))
  const response = await readThemes(snThemeLookup({
    connection: { ok: false, reason: 'snc profile "missing" was not found.' },
  }))
  assert.equal(response.statusCode, 502)
  assert.match(response.body.error, /snc profile "missing"/)
  assert.equal(warn.mock.calls.length, 1)
})

for (const [label, fetchResult, pattern] of [
  ['HTTP auth failures', { ok: false, status: 401 }, /HTTP 401/],
  ['malformed API results', { ok: true, json: async () => ({ error: 'failure' }) }, /invalid theme list/],
  ['null API results', { ok: true, json: async () => null }, /invalid theme list/],
]) {
  test(`theme lookup reports ${label} instead of an empty success`, async (t) => {
    t.mock.method(console, 'warn', () => {})
    t.mock.method(globalThis, 'fetch', async () => fetchResult)
    const response = await readThemes(snThemeLookup({ connection }))
    assert.equal(response.statusCode, 502)
    assert.match(response.body.error, pattern)
    assert.ok(!JSON.stringify(response.body).includes(connection.pass))
  })
}

test('theme lookup surfaces network failures', async (t) => {
  t.mock.method(console, 'warn', () => {})
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('fetch failed') })
  const response = await readThemes(snThemeLookup({ connection }))
  assert.equal(response.statusCode, 502)
  assert.equal(response.body.error, 'fetch failed')
})
