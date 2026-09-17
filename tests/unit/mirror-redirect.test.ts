import { afterEach, expect, spyOn, test } from 'bun:test'
import type { IncomingMessage, ServerResponse } from 'http'
import { streamMirrorTarget } from '../../config/mirror'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

function response() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(name: string, value: string) { this.headers[name] = value },
    end(body = '') { this.body = body },
  }
}

test('mirror rejects a blocked redirect without fetching its destination', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(null, { status: 302, headers: { Location: 'https://www.academia.edu/image.jpg' } }),
  )
  const res = response()
  await streamMirrorTarget(res as unknown as ServerResponse, { method: 'GET' } as IncomingMessage, 'https://example.com/image.jpg')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledWith('https://example.com/image.jpg', { redirect: 'manual' })
  expect(res.statusCode).toBe(403)
  expect(res.body).toBe('403 Not allowed')
})

test('mirror routes allowed relative redirects through validation again', async () => {
  spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(null, { status: 307, headers: { Location: '../next.jpg' } }),
  )
  const res = response()
  await streamMirrorTarget(res as unknown as ServerResponse, { method: 'GET' } as IncomingMessage, 'https://example.com/images/image.jpg')
  expect(res.statusCode).toBe(307)
  expect(res.headers.Location).toBe('/mirror/https://example.com/next.jpg')
})
