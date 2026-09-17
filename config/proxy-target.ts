/**
 * SSRF guards for the /proxy/ outbound fetch path.
 * Rejects localhost, private/link-local IPs, and other non-public targets.
 *
 * Uses legacy url.parse to match unblocker's parsing (WHATWG URL rejects e.g. https:///).
 * Hostnames are then canonicalised (percent-decode, lowercase, strip trailing dots) and
 * checked again with the WHATWG parser so /mirror/ fetch cannot see a host the legacy
 * parse left encoded.
 */
import { parse as parseUrl } from 'url'
import { BLOCKED_DOMAINS } from './blocked-domains'

const blockedDomainSuffixes = BLOCKED_DOMAINS.map((domain) => `.${domain}`)
const blockedDomains = new Set(BLOCKED_DOMAINS)
const MAX_HOSTNAME_DECODES = 4
const HARD_BLOCK_REASONS = new Set(['blocked domain', 'blocked hostname', 'blocked IP address'])

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

export function proxyTargetRawFromRequest(reqUrl: string): string | null {
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

/** Percent-decode, lowercase, and strip trailing dots so encoded hosts match the block list. */
function canonicalizeHostname(hostname: string): string {
  let host = hostname
  for (let i = 0; i < MAX_HOSTNAME_DECODES; i++) {
    try {
      const decoded = decodeURIComponent(host)
      if (decoded === host) break
      host = decoded
    } catch {
      break
    }
  }
  return host.toLowerCase().replace(/\.+$/, '')
}

/** Returns a rejection reason, or null when the hostname is allowed. */
export function validateProxyHostname(hostname: string): string | null {
  const host = canonicalizeHostname(hostname)
  if (!host) return 'missing hostname'

  if (blockedDomains.has(host) || blockedDomainSuffixes.some((suffix) => host.endsWith(suffix))) {
    return 'blocked domain'
  }

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

function whatwgHostname(raw: string): string | null {
  try {
    return new URL(raw).hostname || null
  } catch {
    return null
  }
}

function rejectHostCandidates(hosts: string[]): string | null {
  const reasons = hosts.map((host) => validateProxyHostname(host))
  const hardBlock = reasons.find((reason) => reason !== null && HARD_BLOCK_REASONS.has(reason))
  if (hardBlock) return hardBlock
  if (reasons.some((reason) => reason === null)) return null
  return reasons[0] ?? 'missing hostname'
}

/** Protocol + hostname guards shared by /proxy/ and /mirror/. */
export function rejectParsedHttpUrl(raw: string): string | null {
  const parsed = parseUrl(raw)
  if (!parsed.protocol || !/^https?:$/i.test(parsed.protocol)) {
    return 'invalid protocol'
  }

  // url.parse treats `%` as the end of the host (`arxiv%2eorg` → `arxiv`).
  // WHATWG fetch decodes `%2e` and would load the real host, so check both.
  const hosts = [parsed.hostname ?? '']
  const fetchHost = whatwgHostname(raw)
  if (fetchHost) hosts.push(fetchHost)
  return rejectHostCandidates(hosts)
}

export function rejectProxyRequest(reqUrl: string): string | null {
  const raw = proxyTargetRawFromRequest(reqUrl)
  if (raw === null) return null
  return rejectParsedHttpUrl(raw)
}
