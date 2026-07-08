/**
 * SSRF guards for the /proxy/ outbound fetch path.
 * Rejects localhost, private/link-local IPs, and other non-public targets.
 *
 * Uses legacy url.parse to match unblocker's parsing (WHATWG URL rejects e.g. https:///).
 */
import { parse as parseUrl } from 'url'

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata.goog',
])

const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localhost', '.localdomain', '.svc']

/** Extract hostname from a Monetise proxy request path, or null if not a remote target. */
export function proxyHostnameFromRequest(reqUrl: string): string | null {
  const raw = proxyTargetRawFromRequest(reqUrl)
  if (raw === null) return null
  return (parseUrl(raw).hostname ?? '').toLowerCase()
}

function proxyTargetRawFromRequest(reqUrl: string): string | null {
  const prefix = '/proxy/'
  const prefixIndex = reqUrl.indexOf(prefix)
  if (prefixIndex === -1) return null

  let raw = reqUrl.slice(prefixIndex + prefix.length)
  if (!raw || raw.startsWith('client/')) return null

  if (!/^https?:\/\//i.test(raw)) {
    raw = `http://${raw}`
  }

  return raw
}

/** Returns a rejection reason, or null when the hostname is allowed. */
export function validateProxyHostname(hostname: string): string | null {
  const host = hostname.toLowerCase()
  if (!host) return 'missing hostname'

  if (BLOCKED_HOSTNAMES.has(host)) return 'blocked hostname'
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return 'blocked hostname'

  if (isBlockedIpHost(host)) return 'blocked IP address'

  // Single-label names (e.g. docker service "db") are not public internet targets.
  if (!host.includes('.')) return 'hostname must include a public domain'

  return null
}

function isBlockedIpHost(host: string): boolean {
  const v4 = parseIPv4(host)
  if (v4) return isBlockedIPv4(v4[0], v4[1], v4[2], v4[3])
  if (host.includes(':')) return isBlockedIPv6(host)
  return false
}

function parseIPv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  const nums = parts.map((part) => Number.parseInt(part, 10))
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null
  return nums as [number, number, number, number]
}

function isBlockedIPv4(a: number, b: number, c: number, d: number): boolean {
  if (a === 0 || a === 127 || a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  void c
  void d
  return false
}

function isBlockedIPv6(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true
  if (normalized.startsWith('fe80:')) return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  return false
}

export function rejectProxyRequest(reqUrl: string): string | null {
  const raw = proxyTargetRawFromRequest(reqUrl)
  if (raw === null) return null

  const parsed = parseUrl(raw)
  if (!parsed.protocol || !/^https?:$/i.test(parsed.protocol)) {
    return 'invalid protocol'
  }

  return validateProxyHostname(parsed.hostname ?? '')
}
