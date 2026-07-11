/**
 * Client script injected into mirrored third-party HTML pages.
 * Bundled to public/mirror/client/unblocker-client.js (bun run build:mirror-client).
 *
 * URL rewriting only — no Monet image replacement. Keeps navigations and fetches
 * under the /mirror/ prefix so pages work when browsed through the mirror route.
 */
/// <reference lib="dom" />

export type UnblockerConfig = {
  prefix: string
  url: string | URL
}

type UnblockerWindow = Window & {
  XMLHttpRequest: typeof XMLHttpRequest
  WebSocket: typeof WebSocket
}

declare global {
  interface Window {
    unblockerInit?: (config: UnblockerConfig, win: UnblockerWindow) => void
  }

  interface HTMLBodyElement {
    unblockerIframeAppendListenerInstalled?: boolean
  }
}

function fixUrl(
  urlStr: string | undefined,
  config: UnblockerConfig,
  loc: Location,
): string | undefined {
  if (!urlStr || typeof urlStr !== 'string') return urlStr

  let currentRemoteHref: string
  if (loc.pathname.substr(0, config.prefix.length) === config.prefix) {
    currentRemoteHref = loc.pathname.substr(config.prefix.length) + loc.search + loc.hash
  } else {
    currentRemoteHref = String(config.url)
  }

  if (urlStr.substr(0, config.prefix.length) === config.prefix) {
    return urlStr
  }

  const url = new URL(urlStr, currentRemoteHref)

  if (url.origin === loc.origin && url.pathname.substr(0, config.prefix.length) === config.prefix) {
    return urlStr
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return urlStr
  }

  if (url.hostname === loc.hostname) {
    const currentRemoteUrl = new URL(currentRemoteHref)
    url.host = currentRemoteUrl.host
    url.protocol = currentRemoteUrl.protocol
  }

  return config.prefix + url.href
}

function initXMLHttpRequest(config: UnblockerConfig, win: UnblockerWindow): void {
  if (!win.XMLHttpRequest) return
  const XMLHttpRequestCtor = win.XMLHttpRequest

  win.XMLHttpRequest = function (this: XMLHttpRequest) {
    const xhr = new XMLHttpRequestCtor()
    const open = xhr.open.bind(xhr)
    xhr.open = function (
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ) {
      const fixed = fixUrl(String(url), config, win.location)
      return open(method, fixed ?? String(url), async ?? true, username, password)
    }
    return xhr
  } as unknown as typeof XMLHttpRequest
}

function initFetch(config: UnblockerConfig, win: UnblockerWindow): void {
  if (!win.fetch) return
  const fetchImpl = win.fetch.bind(win)

  win.fetch = function (resource: RequestInfo | URL, init?: RequestInit) {
    if (resource instanceof Request) {
      const fixed = fixUrl(resource.url, config, win.location)
      if (fixed && fixed !== resource.url) {
        resource = new Request(fixed, resource)
      }
    } else {
      resource = fixUrl(String(resource), config, win.location) ?? String(resource)
    }
    return fetchImpl(resource, init)
  }
}

function initCreateElement(config: UnblockerConfig, win: UnblockerWindow): void {
  if (!win.document?.createElement) return
  const createElement = win.document.createElement.bind(win.document)

  win.document.createElement = function <K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    options?: ElementCreationOptions,
  ): HTMLElementTagNameMap[K] {
    if (tagName.toLowerCase() === 'iframe') {
      initAppendBodyIframe(config, win)
    }

    const element = createElement(tagName, options)
    Object.defineProperty(element, 'src', {
      set(src: string) {
        delete (element as { src?: string }).src
        ;(element as HTMLImageElement).src = fixUrl(src, config, win.location) ?? src
      },
      configurable: true,
    })
    Object.defineProperty(element, 'href', {
      set(href: string) {
        delete (element as { href?: string }).href
        ;(element as HTMLAnchorElement).href = fixUrl(href, config, win.location) ?? href
      },
      configurable: true,
    })
    return element
  }
}

function initAppendBodyIframe(config: UnblockerConfig, win: UnblockerWindow): void {
  const body = win.document?.body as HTMLBodyElement | null
  if (!body?.appendChild || body.unblockerIframeAppendListenerInstalled) {
    return
  }

  const appendChild = body.appendChild.bind(body)
  body.appendChild = function <T extends Node>(element: T): T {
    const ret = appendChild(element)
    if (
      element instanceof HTMLIFrameElement &&
      element.src === 'about:blank' &&
      element.contentWindow
    ) {
      initForWindow(config, element.contentWindow as UnblockerWindow)
    }
    return ret
  }
  body.unblockerIframeAppendListenerInstalled = true
}

function initWebSockets(config: UnblockerConfig, win: UnblockerWindow): void {
  if (!win.WebSocket) return
  const WebSocketCtor = win.WebSocket
  const prefix = config.prefix
  const proxyHost = win.location.host
  const isSecure = win.location.protocol === 'https:'
  const target = win.location.pathname.substr(prefix.length)
  const targetURL = new URL(target, win.location.origin)
  const reWsUrl = /^ws(s?):\/\/([^/]+)($|\/.*)/

  win.WebSocket = function (url: string | URL, protocols?: string | string[]) {
    const urlStr = String(url)
    const parsedUrl = urlStr.match(reWsUrl)
    if (parsedUrl) {
      const wsSecure = parsedUrl[1]
      const wsProto = isSecure ? `ws${wsSecure}://` : 'ws://'
      let wsHost = parsedUrl[2]
      if (wsHost === win.location.host || wsHost === win.location.hostname) {
        wsHost = targetURL.host
      }
      const wsPath = parsedUrl[3]
      try {
        return new WebSocketCtor(
          `${wsProto}${proxyHost}${prefix}http${wsSecure}://${wsHost}${wsPath}`,
          protocols,
        )
      } catch (e) {
        console.error('Failed to create WebSocket', e)
      }
    }
    return new WebSocketCtor(url, protocols)
  } as unknown as typeof WebSocket
}

function initLocation(config: UnblockerConfig, win: UnblockerWindow): void {
  const loc = win.location
  if (!loc) return

  for (const method of ['assign', 'replace'] as const) {
    const original = loc[method]
    if (typeof original !== 'function') continue
    const call = original.bind(loc)
    try {
      loc[method] = function (url: string | URL) {
        return call(fixUrl(String(url), config, win.location) ?? String(url))
      }
    } catch {
      // Location methods are read-only in this browser.
    }
  }
}

function initPushState(config: UnblockerConfig, win: UnblockerWindow): void {
  if (!win.history?.pushState) return

  const pushState = win.history.pushState.bind(win.history)
  win.history.pushState = function (state: unknown, title: string, url?: string | URL | null) {
    if (url) {
      const fixed = fixUrl(String(url), config, win.location) ?? String(url)
      config.url = new URL(fixed, String(config.url))
      return pushState(state, title, fixed)
    }
    return pushState(state, title, url)
  }

  if (!win.history.replaceState) return
  const replaceState = win.history.replaceState.bind(win.history)
  win.history.replaceState = function (state: unknown, title: string, url?: string | URL | null) {
    if (url) {
      const fixed = fixUrl(String(url), config, win.location) ?? String(url)
      config.url = new URL(fixed, String(config.url))
      return replaceState(state, title, fixed)
    }
    return replaceState(state, title, url)
  }
}

export function initForWindow(config: UnblockerConfig, win: UnblockerWindow): void {
  initXMLHttpRequest(config, win)
  initFetch(config, win)
  initCreateElement(config, win)
  initAppendBodyIframe(config, win)
  initWebSockets(config, win)
  initPushState(config, win)
  initLocation(config, win)
  if (typeof window !== 'undefined' && win === window) {
    delete window.unblockerInit
  }
}

if (typeof window !== 'undefined') {
  window.unblockerInit = initForWindow as (config: UnblockerConfig, win: Window) => void
}
