import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { viteFinal, previewHead } from '../preset.js'

function project(t, envFile) {
  const root = mkdtempSync(path.join(tmpdir(), 'sn-storybook-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const saved = { ...process.env }
  t.after(() => { process.env = saved })
  process.env = { ...process.env }
  for (const key of ['SN_INSTANCE', 'SN_USER', 'SN_PASS', 'SN_PROFILE', 'SN_NEXT_UI_ALLOW_REMOTE_PROXY']) {
    delete process.env[key]
  }
  writeFileSync(path.join(root, '.env'), envFile)
  writeFileSync(path.join(root, 'package.json'), '{}')
  return { configDir: path.join(root, '.storybook') }
}

test('Storybook shares project .env credentials across proxy, themes and password-free preview status', async (t) => {
  const options = project(t, 'SN_INSTANCE=https://storybook.example.com/\nSN_USER=test-user\nSN_PASS=test-password\n')
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, request) => {
    assert.equal(url.origin, 'https://storybook.example.com')
    assert.equal(request.headers.Authorization, `Basic ${Buffer.from('test-user:test-password').toString('base64')}`)
    return { ok: true, json: async () => ({ result: [{ sys_id: '1', name: 'Theme' }] }) }
  })
  const config = await viteFinal({}, options)
  assert.equal(config.server.host, '127.0.0.1')
  assert.equal(config.server.proxy['/uxasset'].target, 'https://storybook.example.com')
  const themePlugin = config.plugins.find(({ name }) => name === 'sn-theme-lookup')
  let handler
  themePlugin.configureServer({ middlewares: { use(_route, middleware) { handler = middleware } } })
  let body
  await handler({}, {
    setHeader() {},
    end(value) { body = JSON.parse(value) },
  })
  assert.deepEqual(body, { result: [{ sys_id: '1', name: 'Theme' }] })
  assert.equal(fetchMock.mock.calls.length, 1)
  const head = await previewHead('', options)
  assert.match(head, /"source":"env"/)
  assert.match(head, /"proxyEnabled":true/)
  assert.ok(!head.includes('test-password'))
  assert.ok(!head.includes(Buffer.from('test-user:test-password').toString('base64')))
  assert.ok(config.optimizeDeps.exclude.includes('@servicenow/ui-mega'))
  assert.equal(config.optimizeDeps.esbuildOptions.jsxFactory, '__snRenderer.createElement')
  assert.equal(config.optimizeDeps.esbuildOptions.jsxFragment, '__snRenderer.Fragment')
})

test('Storybook disables proxy and reports incomplete overrides without falling back to SDK credentials', async (t) => {
  const options = project(t, 'SN_INSTANCE=https://storybook.example.com\n')
  t.mock.method(console, 'warn', () => {})
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => assert.fail('must not fetch'))
  const config = await viteFinal({}, options)
  assert.equal(config.server?.proxy, undefined)
  let handler
  config.plugins.find(({ name }) => name === 'sn-theme-lookup')
    .configureServer({ middlewares: { use(_route, middleware) { handler = middleware } } })
  const response = {
    setHeader() {},
    end(value) { this.body = JSON.parse(value) },
  }
  await handler({}, response)
  assert.equal(response.statusCode, 502)
  assert.match(response.body.error, /Incomplete environment credentials/)
  assert.equal(fetchMock.mock.calls.length, 0)
  const head = await previewHead('', options)
  assert.match(head, /"proxyEnabled":false/)
  assert.match(head, /Incomplete environment credentials/)
})
