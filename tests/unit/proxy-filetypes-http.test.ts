import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import { blockFiletypeResponse, type FiletypeLoggedRequest } from '../../config/proxy-filetypes'

const unblocker = createRequire(import.meta.url)('unblocker')
const pdf = '%PDF-1.7\nfixture PDF bytes'
const blocks: string[] = []
let upstream: Server
let proxy: Server
let origin: string
let upstreamOrigin: string

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  return `http://127.0.0.1:${address.port}`
}

describe('filetype middleware with real unblocker and local-only upstream', () => {
  beforeAll(async () => {
    upstream = createServer((req, res) => {
      if (req.url === '/html') {
        res.setHeader('Content-Type', 'text/html')
        res.end('<html><body>Allowed page</body></html>')
        return
      }
      res.setHeader('Content-Type', req.url === '/attachment' ? 'application/octet-stream' : 'application/pdf')
      if (req.url === '/attachment') res.setHeader('Content-Disposition', 'attachment; filename="paper.pdf"')
      res.setHeader('Content-Length', Buffer.byteLength(pdf))
      res.statusCode = req.headers.range ? 206 : 200
      res.end(pdf)
    })
    upstreamOrigin = await listen(upstream)
    const publicHandler = unblocker({ prefix: '/proxy/', clientScripts: false, responseMiddleware: [blockFiletypeResponse] })
    const mirrorHandler = unblocker({ prefix: '/mirror/', clientScripts: false })
    // This fixture deliberately permits loopback; production hostname guards are tested separately.
    proxy = createServer((req, res) => {
      ;(req as FiletypeLoggedRequest).onBlockedFiletype = (reason) => blocks.push(reason)
      const handler = req.url?.startsWith('/mirror/') ? mirrorHandler : publicHandler
      handler(req, res, (error?: Error) => { res.statusCode = 502; res.end(error?.message) })
    })
    origin = await listen(proxy)
  })

  afterAll(async () => {
    for (const server of [proxy, upstream]) {
      if (!server) continue
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  test('blocks extensionless MIME and attachment downloads without forwarding PDF bytes or headers', async () => {
    for (const path of ['/download', '/attachment']) {
      const res = await fetch(`${origin}/proxy/${upstreamOrigin}${path}`)
      expect(res.status).toBe(403)
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
      expect(res.headers.get('content-disposition')).toBeNull()
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(await res.text()).toBe('403 Not allowed')
    }
    expect(blocks).toContain('blocked filetype: pdf')
  })

  test('blocks HEAD and range requests as well', async () => {
    const head = await fetch(`${origin}/proxy/${upstreamOrigin}/download`, { method: 'HEAD' })
    expect(head.status).toBe(403)
    expect(await head.text()).toBe('')
    const range = await fetch(`${origin}/proxy/${upstreamOrigin}/download`, { headers: { range: 'bytes=0-9' } })
    expect(range.status).toBe(403)
    expect(await range.text()).toBe('403 Not allowed')
  })

  test('mirror still returns the same PDF bytes', async () => {
    const res = await fetch(`${origin}/mirror/${upstreamOrigin}/paper.pdf`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(await res.text()).toBe(pdf)
  })

  test('ordinary proxy HTML still passes through', async () => {
    const res = await fetch(`${origin}/proxy/${upstreamOrigin}/html`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Allowed page')
  })
})
