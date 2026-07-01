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
    expect(res.headers.get('set-cookie')).toMatch(/cookieName=/)
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

  test('GET /visitors responds when database is unavailable', async () => {
    const res = await fetchFromServer('/visitors', port)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text === 'Database unavailable' || text.includes('<table>')).toBe(true)
  })

  test('GET /robots.txt disallows the proxy path', async () => {
    const res = await fetchFromServer('/robots.txt', port)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Disallow: /proxy/')
  })

  test('GET /proxy/client/unblocker-client.js serves the injected script', async () => {
    const res = await fetchFromServer('/proxy/client/unblocker-client.js', port, {
      headers: { cookie: 'cookieName=127.0.0.1' },
    })
    expect(res.status).toBe(200)
    const js = await res.text()
    expect(js).toContain('monetiseAllImages')
  })
})
