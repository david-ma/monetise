import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  fetchFromServer,
  startTestServer,
  stopTestServer,
  waitForServerHttp,
} from 'thalia/testing'
import { describeDatabaseOnline } from '../helpers'

const PROJECT = 'monetise'

describeDatabaseOnline('monetise HTTP routes', () => {
  let port = 0

  beforeAll(async () => {
    const server = await startTestServer(PROJECT, { fresh: true, node_env: 'test' })
    port = server.port
    await waitForServerHttp(port)
  })

  afterAll(async () => {
    await stopTestServer(PROJECT, { node_env: 'test' })
  })

  test('GET /version returns Thalia version JSON', async () => {
    const res = await fetchFromServer('/version', port)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.websiteName).toBe('monetise')
    expect(body.thaliaVersion).toBeTruthy()
  })

  test('GET / serves the homepage', async () => {
    const res = await fetchFromServer('/', port)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('html')
    expect(res.headers.get('set-cookie')).toMatch(/monetiseVisitor=/)
  })

  test('GET / still serves homepage after many uncookied proxy hits', async () => {
    for (let i = 0; i < 15; i++) {
      await fetchFromServer('/proxy/https://example.com', port, { redirect: 'manual' })
    }
    const res = await fetchFromServer('/', port, { redirect: 'manual' })
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).not.toBe('/robots.txt')
  })

  test('GET /?goto= redirects into the proxy', async () => {
    const res = await fetchFromServer('/?goto=https://example.com', port, {
      redirect: 'manual',
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/proxy/https://example.com')
  })

  test('GET /monet redirects to a SmugMug CDN painting', async () => {
    const res = await fetchFromServer('/monet', port, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toMatch(/^https:\/\/photos\.smugmug\.com\/photos\/i-/)
  })

  test('GET /monet/300w200h42 picks size from dimensions', async () => {
    const res = await fetchFromServer('/monet/300w200h42', port, { redirect: 'manual' })
    expect(res.status).toBe(302)
    const location = res.headers.get('location') ?? ''
    expect(location).toMatch(/^https:\/\/photos\.smugmug\.com\/photos\/i-/)
    expect(location).toMatch(/\/S\/i-[A-Za-z0-9]+-S\.jpg$/)
  })

  test('OPTIONS /mirror/ returns permissive CORS', async () => {
    const res = await fetchFromServer('/mirror/https://example.com/test.jpg', port, {
      method: 'OPTIONS',
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  test('GET /mirror/client/unblocker-client.js serves the mirror script', async () => {
    const res = await fetchFromServer('/mirror/client/unblocker-client.js', port)
    expect(res.status).toBe(200)
    const js = await res.text()
    expect(js).toContain('unblockerInit')
    expect(js).not.toContain('monetiseAllImages')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  test('GET /mirror/https://127.0.0.1/ blocks loopback SSRF', async () => {
    const res = await fetchFromServer('/mirror/https://127.0.0.1/secret', port)
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  test('GET /visitors is password protected', async () => {
    const res = await fetchFromServer('/visitors', port)
    expect(res.status).toBe(401)
  })

  test('GET /robots.txt disallows the proxy path', async () => {
    const res = await fetchFromServer('/robots.txt', port)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Disallow: /proxy/')
  })

  test('GET /proxy/client/unblocker-client.js serves the injected script', async () => {
    const res = await fetchFromServer('/proxy/client/unblocker-client.js', port, {
      headers: { cookie: 'monetiseVisitor=1' },
    })
    expect(res.status).toBe(200)
    const js = await res.text()
    expect(js).toContain('monetiseAllImages')
  })

  test('GET /proxy/https:/// blocks empty-host SSRF', async () => {
    const res = await fetchFromServer(
      '/proxy/https:///?rest_route=/gravitysmtp/v1/tests/mock-data&page=gravitysmtp-settings',
      port,
      { headers: { cookie: 'monetiseVisitor=1' }, redirect: 'manual' },
    )
    expect(res.status).toBe(403)
    expect(await res.text()).toBe('403 Not allowed')
  })

  test('GET /proxy/https://localhost/ blocks localhost', async () => {
    const res = await fetchFromServer('/proxy/https://localhost/', port, {
      headers: { cookie: 'monetiseVisitor=1' },
      redirect: 'manual',
    })
    expect(res.status).toBe(403)
  })

  test('GET /proxy/https://127.0.0.1/ blocks loopback IP', async () => {
    const res = await fetchFromServer('/proxy/https://127.0.0.1/', port, {
      headers: { cookie: 'monetiseVisitor=1' },
      redirect: 'manual',
    })
    expect(res.status).toBe(403)
  })
})
