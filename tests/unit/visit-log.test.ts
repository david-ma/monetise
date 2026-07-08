import { describe, expect, test } from 'bun:test'
import {
  classifyVisit,
  isProbeQuery,
  normaliseLocalPath,
  normaliseUpstreamUrl,
} from '../../config/visit-log'

describe('normaliseUpstreamUrl', () => {
  test('decodes percent-encoded URLs', () => {
    const result = normaliseUpstreamUrl('https%3A//woocommerce.com/blog/business-ideas/')
    expect(result?.targetUrl).toBe('https://woocommerce.com/blog/business-ideas/')
    expect(result?.host).toBe('woocommerce.com')
  })

  test('preserves query strings', () => {
    const result = normaliseUpstreamUrl('https://example.com/path?foo=bar&baz=1')
    expect(result?.targetUrl).toBe('https://example.com/path?foo=bar&baz=1')
  })
})

describe('isProbeQuery', () => {
  test('detects common scanner params', () => {
    expect(isProbeQuery({ file: '../../../../var/www/html/.env' })).toBe(true)
    expect(isProbeQuery({ phpinfo: '1' })).toBe(true)
    expect(isProbeQuery({ rest_route: '/gravitysmtp/v1/tests/mock-data' })).toBe(true)
    expect(isProbeQuery({ goto: 'https://example.com' })).toBe(false)
  })
})

describe('classifyVisit', () => {
  test('flags homepage probes', () => {
    const decision = classifyVisit(
      { method: 'GET', headers: { accept: 'text/html' } } as import('http').IncomingMessage,
      {
        pathname: '/',
        query: { file: '../../../../var/www/html/.env' },
      } as unknown as import('thalia/server').RequestInfo,
    )
    expect(decision.log).toBe(true)
    expect(decision.kind).toBe('homepage_probe')
    expect(decision.target?.targetUrl).toContain('/?file=')
    expect(decision.target?.targetUrl).toContain('.env')
  })

  test('skips monet asset paths', () => {
    const decision = classifyVisit(
      { method: 'GET', headers: {} } as import('http').IncomingMessage,
      { pathname: '/monet/300w200h1', query: {} } as unknown as import('thalia/server').RequestInfo,
    )
    expect(decision.log).toBe(false)
  })

  test('records proxy_document with full request path', () => {
    const decision = classifyVisit(
      {
        method: 'GET',
        url: '/proxy/https://xkcd.com/',
        headers: { 'sec-fetch-dest': 'document' },
      } as unknown as import('http').IncomingMessage,
      {
        pathname: '/proxy/https://xkcd.com',
        query: {},
      } as unknown as import('thalia/server').RequestInfo,
    )
    expect(decision.log).toBe(true)
    expect(decision.kind).toBe('proxy_document')
    expect(decision.requestPath).toBe('/proxy/https://xkcd.com/')
    expect(decision.target?.targetUrl).toBe('https://xkcd.com/')
  })

  test('resolves goto redirect target back to the real upstream', () => {
    const decision = classifyVisit(
      {
        method: 'GET',
        url: '/?goto=%2Fproxy%2Fhttps%3A%2F%2Fxkcd.com%2F',
        headers: { 'sec-fetch-dest': 'document' },
      } as unknown as import('http').IncomingMessage,
      {
        pathname: '/',
        query: { goto: '/proxy/https://xkcd.com/' },
      } as unknown as import('thalia/server').RequestInfo,
    )
    expect(decision.log).toBe(true)
    expect(decision.kind).toBe('homepage_goto')
    // The `/proxy/` prefix must be stripped so we log the destination, not http:///proxy/…
    expect(decision.target?.targetUrl).toBe('https://xkcd.com/')
    expect(decision.target?.host).toBe('xkcd.com')
  })

  test('logs proxy_blocked overrides', () => {
    const decision = classifyVisit(
      { method: 'GET', headers: {} } as import('http').IncomingMessage,
      {
        pathname: '/proxy/https:///',
        query: {},
      } as unknown as import('thalia/server').RequestInfo,
      {
        kind: 'proxy_blocked',
        blockReason: 'missing hostname',
        forceTargetUrl: '/proxy/https:///?rest_route=foo',
      },
    )
    expect(decision.log).toBe(true)
    expect(decision.kind).toBe('proxy_blocked')
    expect(decision.blockReason).toBe('missing hostname')
  })
})

describe('normaliseLocalPath', () => {
  test('builds local target urls', () => {
    expect(normaliseLocalPath('/', '?foo=bar').targetUrl).toBe('/?foo=bar')
    expect(normaliseLocalPath('/', '?foo=bar').host).toBe('(local)')
  })
})
