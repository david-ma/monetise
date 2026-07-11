/**
 * GET /mirror/https://… — fetch upstream bytes and return with permissive CORS for WebGL/textures.
 */
import type { IncomingMessage, ServerResponse } from 'http'
import { mirrorTargetRawFromRequest, rejectMirrorRequest } from './mirror-target'

function mimeFromUrl(url: string): string {
  const lower = url.split('?')[0]?.toLowerCase() ?? ''
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  return 'image/jpeg'
}

export function setMirrorCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
}

/** Unblocker response middleware — permissive CORS on all mirrored responses. */
export function mirrorCorsMiddleware(data: {
  headers?: Record<string, string | string[] | undefined>
}): void {
  if (!data.headers) return
  data.headers['access-control-allow-origin'] = '*'
  data.headers['access-control-allow-methods'] = 'GET, HEAD, OPTIONS'
  data.headers['cross-origin-resource-policy'] = 'cross-origin'
}

export async function streamMirrorTarget(
  res: ServerResponse,
  req: IncomingMessage,
  upstreamUrl: string
): Promise<void> {
  const method = req.method ?? 'GET'
  if (method === 'OPTIONS') {
    res.statusCode = 204
    setMirrorCors(res)
    res.end()
    return
  }

  if (method !== 'GET' && method !== 'HEAD') {
    res.statusCode = 405
    res.setHeader('Allow', 'GET, HEAD, OPTIONS')
    res.end('Method not allowed')
    return
  }

  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl, { redirect: 'follow' })
  } catch {
    res.statusCode = 502
    res.end('Upstream fetch failed')
    return
  }

  if (!upstream.ok) {
    res.statusCode = upstream.status === 404 ? 404 : 502
    res.end('Upstream unavailable')
    return
  }

  const contentType = upstream.headers.get('content-type')?.split(';')[0]?.trim()
  const bytes = method === 'HEAD' ? null : Buffer.from(await upstream.arrayBuffer())

  res.statusCode = 200
  setMirrorCors(res)
  res.setHeader('Content-Type', contentType || mimeFromUrl(upstreamUrl))
  res.setHeader('Cache-Control', 'public, max-age=86400')
  if (bytes) {
    res.setHeader('Content-Length', String(bytes.length))
    res.end(bytes)
    return
  }
  res.end()
}

export function rejectMirrorResponse(
  res: ServerResponse,
  reqUrl: string,
): boolean {
  const rejectReason = rejectMirrorRequest(reqUrl)
  if (!rejectReason) return false

  res.statusCode = rejectReason === 'missing mirror URL' ? 400 : 403
  setMirrorCors(res)
  res.end(rejectReason === 'missing mirror URL' ? 'Missing mirror URL' : '403 Not allowed')
  return true
}
