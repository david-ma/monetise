import { describe, expect, test } from 'bun:test'
import { fixUrl } from '../../src/proxy/client/unblocker-client'
import {
  HEAD_OPEN_RE,
  injectClientScriptsIntoHtml,
} from '../../config/client-scripts'

describe('clientScriptsInjector', () => {
  test('HEAD_OPEN_RE matches head but not header', () => {
    expect('<head>'.match(HEAD_OPEN_RE)?.[0]).toBe('<head>')
    expect('<head lang="en">'.match(HEAD_OPEN_RE)?.[0]).toBe('<head lang="en">')
    expect('<header class="x">'.match(HEAD_OPEN_RE)).toBeNull()
  })

  test('injects after head', () => {
    const { html, injected } = injectClientScriptsIntoHtml(
      '<html><head><title>x</title>',
      '/proxy/',
      'https://www.reddit.com/',
    )
    expect(injected).toBe(true)
    expect(html).toContain('/proxy/client/unblocker-client.js')
    expect(html).toContain('unblockerInit')
    expect(html.indexOf('<head>')).toBeLessThan(html.indexOf('unblocker-client.js'))
  })

  test('does not inject into header elements', () => {
    const input = '<header class="foo"><nav></nav>'
    const { html, injected } = injectClientScriptsIntoHtml(
      input,
      '/proxy/',
      'https://www.reddit.com/',
    )
    expect(injected).toBe(false)
    expect(html).toBe(input)
  })

  test('falls back to body when there is no head', () => {
    const { html, injected } = injectClientScriptsIntoHtml(
      '<body class="theme-beta"><main>',
      '/proxy/',
      'https://www.reddit.com/',
    )
    expect(injected).toBe(true)
    expect(html).toContain('<body class="theme-beta">')
    expect(html).toContain('unblocker-client.js')
  })
})

describe('fixUrl', () => {
  const config = { prefix: '/proxy/', url: 'https://www.reddit.com/' }
  const loc = {
    pathname: '/proxy/https://www.reddit.com/',
    search: '',
    hash: '',
    hostname: 'www.monetiseyourwebsite.com',
    host: 'www.monetiseyourwebsite.com',
    origin: 'https://www.monetiseyourwebsite.com',
    protocol: 'https:',
  } as Location

  test('leaves Monetise visit-report on the proxy host', () => {
    expect(fixUrl('/visit-report', config, loc)).toBe('/visit-report')
  })

  test('rewrites upstream root-relative paths', () => {
    expect(fixUrl('/r/news', config, loc)).toBe('/proxy/https://www.reddit.com/r/news')
  })

  test('coerces TrustedScriptURL-like values to strings', () => {
    const trusted = { toString: () => 'https://www.googletagmanager.com/gtag/js' } as unknown as string
    expect(fixUrl(trusted, config, loc)).toContain('/proxy/https://www.googletagmanager.com/')
  })
})
