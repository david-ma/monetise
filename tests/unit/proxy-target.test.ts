import { describe, expect, test } from 'bun:test'
import {
  proxyHostnameFromRequest,
  rejectProxyRequest,
  validateProxyHostname,
} from '../../config/proxy-target'

describe('proxyHostnameFromRequest', () => {
  test('parses a normal HTTPS target', () => {
    expect(proxyHostnameFromRequest('/proxy/https://example.com/path?q=1')).toBe('example.com')
  })

  test('parses empty-host SSRF payload', () => {
    expect(
      proxyHostnameFromRequest(
        '/proxy/https:///?rest_route=/gravitysmtp/v1/tests/mock-data&page=gravitysmtp-settings',
      ),
    ).toBe('')
  })

  test('ignores local client script path', () => {
    expect(proxyHostnameFromRequest('/proxy/client/unblocker-client.js')).toBeNull()
  })
})

describe('validateProxyHostname', () => {
  test('allows public domains', () => {
    expect(validateProxyHostname('example.com')).toBeNull()
    expect(validateProxyHostname('www.reddit.com')).toBeNull()
  })

  test('rejects empty hostname', () => {
    expect(validateProxyHostname('')).toBe('missing hostname')
  })

  test('rejects localhost and docker-style single-label hosts', () => {
    expect(validateProxyHostname('localhost')).toBe('blocked hostname')
    expect(validateProxyHostname('db')).toBe('hostname must include a public domain')
  })

  test('rejects private and loopback IPv4', () => {
    expect(validateProxyHostname('127.0.0.1')).toBe('blocked IP address')
    expect(validateProxyHostname('10.0.0.5')).toBe('blocked IP address')
    expect(validateProxyHostname('192.168.1.1')).toBe('blocked IP address')
    expect(validateProxyHostname('169.254.169.254')).toBe('blocked IP address')
  })

  test('rejects loopback IPv6', () => {
    expect(validateProxyHostname('::1')).toBe('blocked IP address')
  })

  test('rejects metadata and internal suffixes', () => {
    expect(validateProxyHostname('metadata.google.internal')).toBe('blocked hostname')
    expect(validateProxyHostname('app.internal')).toBe('blocked hostname')
  })
})

describe('rejectProxyRequest', () => {
  test('rejects CamoLeak-style localhost SSRF URL', () => {
    expect(
      rejectProxyRequest(
        '/proxy/https:///?rest_route=/gravitysmtp/v1/tests/mock-data&page=gravitysmtp-settings',
      ),
    ).toBe('missing hostname')
  })
})
