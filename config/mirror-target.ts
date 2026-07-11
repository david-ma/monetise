/**
 * Parse and validate targets for GET /mirror/https://… (passthrough image mirror).
 */
import { parse as parseUrl } from 'url'
import {
  validateProxyHostname,
} from './proxy-target'

const MIRROR_PREFIX = '/mirror/'

/** Extract upstream URL from a mirror request path, or null if not a mirror target. */
export function mirrorTargetRawFromRequest(reqUrl: string): string | null {
  const prefixIndex = reqUrl.indexOf(MIRROR_PREFIX)
  if (prefixIndex === -1) return null

  let raw = reqUrl.slice(prefixIndex + MIRROR_PREFIX.length)
  if (!raw || raw.startsWith('client/')) return null

  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`
  }

  return raw
}

/** Returns a rejection reason, or null when the mirror target is allowed. */
export function rejectMirrorRequest(reqUrl: string): string | null {
  const raw = mirrorTargetRawFromRequest(reqUrl)
  if (raw === null) return 'missing mirror URL'

  const parsed = parseUrl(raw)
  if (!parsed.protocol || !/^https?:$/i.test(parsed.protocol)) {
    return 'invalid protocol'
  }

  return validateProxyHostname(parsed.hostname ?? '')
}
