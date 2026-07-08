/**
 * Server-side visit classification and URL normalisation for visitor logging.
 */
import { parse as parseUrl, format as formatUrl } from 'url'
import type { IncomingMessage } from 'http'
import type { RequestInfo } from 'thalia/server'
import { proxyTargetRawFromRequest } from './proxy-target'

export type VisitKind =
  | 'proxy_document'
  | 'homepage'
  | 'homepage_goto'
  | 'homepage_probe'
  | 'proxy_blocked'

export type NormalisedVisitTarget = {
  targetUrl: string
  origin: string
  host: string
}

export type VisitLogDecision = {
  log: boolean
  kind: VisitKind
  target: NormalisedVisitTarget | null
  requestPath: string
  blockReason?: string
}

const LOG_SKIP_PATH_PREFIXES = [
  '/monet',
  '/assets',
  '/css',
  '/js',
  '/fonts',
  '/images',
  '/favicon.ico',
  '/apple-touch-icon',
  '/robots.txt',
  '/sitemap.xml',
  '/version',
  '/geoip',
  '/visit-report',
]

const PROBE_QUERY_KEYS = new Set([
  'file',
  'phpinfo',
  'rest_route',
  'cmd',
  'exec',
  'shell',
  'passwd',
])

const PROBE_QUERY_PATTERN =
  /(?:\.\.\/|phpinfo|\/etc\/|\/var\/www|eval\(|base64_decode|union\s+select)/i

function safeDecode(value: string): string {
  let decoded = value
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      break
    }
  }
  return decoded
}

function stripDefaultPort(protocol: string, host: string, port: string | null | undefined): string {
  if (!port) return host
  if (protocol === 'https:' && port === '443') return host
  if (protocol === 'http:' && port === '80') return host
  return `${host}:${port}`
}

/** Build canonical upstream URL (scheme + host + path + query, no fragment). */
export function normaliseUpstreamUrl(raw: string): NormalisedVisitTarget | null {
  let decoded = safeDecode(raw.trim())
  if (!decoded) return null

  if (!/^https?:\/\//i.test(decoded)) {
    decoded = `http://${decoded}`
  }

  const parsed = parseUrl(decoded)
  if (!parsed.protocol || !/^https?:$/i.test(parsed.protocol)) {
    return null
  }

  const hostname = (parsed.hostname ?? '').toLowerCase()
  const pathname = parsed.pathname && parsed.pathname !== '' ? parsed.pathname : '/'
  const search = parsed.search ?? ''

  if (!hostname) {
    const targetUrl = `${parsed.protocol}//${pathname}${search}`
    return {
      targetUrl,
      origin: '',
      host: '(invalid)',
    }
  }

  const hostWithPort = stripDefaultPort(parsed.protocol, hostname, parsed.port)
  const targetUrl = formatUrl({
    protocol: parsed.protocol,
    hostname,
    port: parsed.port,
    pathname,
    search: search || undefined,
  })

  const origin = formatUrl({
    protocol: parsed.protocol,
    hostname,
    port: parsed.port,
  })

  return {
    targetUrl,
    origin,
    host: hostWithPort,
  }
}

/** Normalise Monetise-local paths (homepage probes, etc.). */
export function normaliseLocalPath(pathname: string, search: string): NormalisedVisitTarget {
  const targetUrl = `${pathname}${search}`
  return {
    targetUrl,
    origin: '',
    host: '(local)',
  }
}

export function isProbeQuery(query: Record<string, string>): boolean {
  for (const [key, value] of Object.entries(query)) {
    const keyLower = key.toLowerCase()
    if (PROBE_QUERY_KEYS.has(keyLower)) return true
    if (keyLower === 'page' && /phpinfo|gravitysmtp/i.test(value)) return true
    if (PROBE_QUERY_PATTERN.test(key) || PROBE_QUERY_PATTERN.test(value)) return true
  }
  return false
}

function headerValue(req: IncomingMessage, name: string): string {
  const raw = req.headers[name.toLowerCase()]
  if (Array.isArray(raw)) return raw[0] ?? ''
  return raw ?? ''
}

function isDocumentNavigation(req: IncomingMessage): boolean {
  const fetchDest = headerValue(req, 'sec-fetch-dest').toLowerCase()
  if (fetchDest) {
    return fetchDest === 'document'
  }
  const accept = headerValue(req, 'accept').toLowerCase()
  return accept.includes('text/html')
}

function isAssetSubresource(req: IncomingMessage): boolean {
  const fetchDest = headerValue(req, 'sec-fetch-dest').toLowerCase()
  if (!fetchDest) return false
  return ['image', 'script', 'style', 'font', 'audio', 'video', 'empty'].includes(fetchDest)
}

function querySearch(query: Record<string, string>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, value)
  }
  const serialized = params.toString()
  return serialized ? `?${serialized}` : ''
}

function searchFromRequest(requestPath: string, query: Record<string, string>): string {
  if (requestPath.includes('?')) {
    return requestPath.slice(requestPath.indexOf('?'))
  }
  return querySearch(query)
}

function shouldSkipPath(pathname: string): boolean {
  return LOG_SKIP_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export function classifyVisit(
  req: IncomingMessage,
  requestInfo: RequestInfo,
  overrides?: { kind?: VisitKind; blockReason?: string; forceTargetUrl?: string },
): VisitLogDecision {
  const pathname = requestInfo.pathname || '/'
  const requestPath = req.url ?? pathname
  const query = requestInfo.query ?? {}

  if (overrides?.kind === 'proxy_blocked') {
    const raw = overrides.forceTargetUrl ?? requestPath
    const proxyRaw = proxyTargetRawFromRequest(
      raw.includes('/proxy/') ? raw : `/proxy/${raw.replace(/^https?:\/\//, 'https://')}`,
    )
    const target =
      (proxyRaw ? normaliseUpstreamUrl(proxyRaw) : null) ??
      normaliseLocalPath(
        pathname,
        requestPath.includes('?') ? requestPath.slice(requestPath.indexOf('?')) : '',
      )
    return {
      log: true,
      kind: 'proxy_blocked',
      target,
      requestPath,
      blockReason: overrides.blockReason,
    }
  }

  if (shouldSkipPath(pathname)) {
    return { log: false, kind: 'homepage', target: null, requestPath }
  }

  if (isProbeQuery(query)) {
    const search = searchFromRequest(requestPath, query)
    return {
      log: true,
      kind: 'homepage_probe',
      target: normaliseLocalPath(pathname, search),
      requestPath: `${pathname}${search}`,
    }
  }

  if (query.goto) {
    const decodedGoto = safeDecode(query.goto)
    // `goto` from our own 303 redirect carries the `/proxy/<upstream>` prefix; strip it so we
    // record the real destination (e.g. https://xkcd.com/) rather than http:///proxy/https://…
    const afterProxy = decodedGoto.includes('/proxy/')
      ? (decodedGoto.split('/proxy/').pop() ?? decodedGoto)
      : decodedGoto
    const candidate = /^https?:\/\//i.test(afterProxy) ? afterProxy : `https://${afterProxy}`
    return {
      log: true,
      kind: 'homepage_goto',
      target: normaliseUpstreamUrl(candidate),
      requestPath,
    }
  }

  if (pathname.startsWith('/proxy/')) {
    if (pathname.includes('/proxy/client/')) {
      return { log: false, kind: 'proxy_document', target: null, requestPath }
    }
    if (isAssetSubresource(req)) {
      return { log: false, kind: 'proxy_document', target: null, requestPath }
    }
    if (!isDocumentNavigation(req)) {
      return { log: false, kind: 'proxy_document', target: null, requestPath }
    }
    const proxyRaw = proxyTargetRawFromRequest(requestPath)
    const target = proxyRaw ? normaliseUpstreamUrl(proxyRaw) : null
    return {
      log: Boolean(target),
      kind: 'proxy_document',
      target,
      requestPath,
    }
  }

  if (pathname === '/' || pathname === '') {
    if (!isDocumentNavigation(req) && (req.method ?? 'GET').toUpperCase() !== 'GET') {
      return { log: false, kind: 'homepage', target: null, requestPath }
    }
    const search = searchFromRequest(requestPath, query)
    return {
      log: true,
      kind: 'homepage',
      target: normaliseLocalPath('/', search),
      requestPath: `${pathname}${search}`,
    }
  }

  return { log: false, kind: 'homepage', target: null, requestPath }
}
