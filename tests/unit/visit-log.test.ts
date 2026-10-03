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
  function mirrorDecision(path: string, method = 'GET', overrides?: Parameters<typeof classifyVisit>[2]) {
    return classifyVisit(
      { method, url: path, headers: { 'sec-fetch-dest': 'empty' } } as unknown as import('http').IncomingMessage,
      { pathname: path.split('?')[0], query: { file: 'paper.pdf' } } as unknown as import('thalia/server').RequestInfo,
      overrides,
    )
  }

  test('logs mirror downloads and subresources without document headers or probe misclassification', () => {
    for (const path of ['paper.pdf', 'photo.jpg', 'page?file=paper.pdf']) {
      const decision = mirrorDecision(`/mirror/https://example.com/${path}`)
      expect(decision.log).toBe(true)
      expect(decision.kind).toBe('mirror_request')
      expect(decision.target?.targetUrl).toBe(`https://example.com/${path}`)
      expect(decision.requestPath).toBe(`/mirror/https://example.com/${path}`)
    }
    expect(mirrorDecision('/mirror/https://example.com/paper.pdf', 'HEAD').log).toBe(true)
  })

  test('excludes mirror preflights and local client scripts', () => {
    expect(mirrorDecision('/mirror/https://example.com/', 'OPTIONS').log).toBe(false)
    expect(mirrorDecision('/mirror/client/unblocker-client.js').log).toBe(false)
  })

  test('logs blocked mirror targets with the reason and upstream URL', () => {
    const decision = mirrorDecision('/mirror/https://localhost/paper.pdf', 'GET', {
      kind: 'mirror_blocked', blockReason: 'blocked hostname',
    })
    expect(decision.log).toBe(true)
    expect(decision.kind).toBe('mirror_blocked')
    expect(decision.blockReason).toBe('blocked hostname')
    expect(decision.target?.targetUrl).toBe('https://localhost/paper.pdf')
  })

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

  test('proxy_blocked absolute upstream URLs keep paths that contain /proxy/', () => {
    const decision = classifyVisit(
      {
        method: 'GET',
        url: '/proxy/https://cdn.example.com/api/proxy/file.pdf',
        headers: { 'sec-fetch-dest': 'document' },
      } as unknown as import('http').IncomingMessage,
      {
        pathname: '/proxy/https://cdn.example.com/api/proxy/file.pdf',
        query: {},
      } as unknown as import('thalia/server').RequestInfo,
      {
        kind: 'proxy_blocked',
        blockReason: 'blocked filetype: pdf',
        forceTargetUrl: 'https://cdn.example.com/api/proxy/file.pdf',
      },
    )
    expect(decision.log).toBe(true)
    expect(decision.kind).toBe('proxy_blocked')
    expect(decision.target?.host).toBe('cdn.example.com')
    expect(decision.target?.targetUrl).toBe('https://cdn.example.com/api/proxy/file.pdf')
  })

  test('proxy_blocked Monetise request paths still strip the /proxy/ prefix', () => {
    const decision = classifyVisit(
      { method: 'GET', headers: {} } as import('http').IncomingMessage,
      {
        pathname: '/proxy/https://example.com/paper.pdf',
        query: {},
      } as unknown as import('thalia/server').RequestInfo,
      {
        kind: 'proxy_blocked',
        blockReason: 'blocked filetype: pdf',
        forceTargetUrl: '/proxy/https://example.com/paper.pdf',
      },
    )
    expect(decision.log).toBe(true)
    expect(decision.target?.targetUrl).toBe('https://example.com/paper.pdf')
    expect(decision.target?.host).toBe('example.com')
  })
})

describe('normaliseLocalPath', () => {
  test('builds local target urls', () => {
    expect(normaliseLocalPath('/', '?foo=bar').targetUrl).toBe('/?foo=bar')
    expect(normaliseLocalPath('/', '?foo=bar').host).toBe('(local)')
  })
})
