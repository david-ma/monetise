/**
 * Unblocker client script + Monet image replacement.
 * Bundled to public/proxy/client/unblocker-client.js (bun run build:client).
 */
/// <reference lib="dom" />

export type UnblockerConfig = {
  prefix: string
  url: string | URL
}

/** Bun's Window typings omit some APIs the unblocker client patches. */
type UnblockerWindow = Window & {
  XMLHttpRequest: typeof XMLHttpRequest
  WebSocket: typeof WebSocket
}

declare global {
  interface Window {
    unblockerInit?: (config: UnblockerConfig, win: UnblockerWindow) => void
    monetiseAllImages?: () => void
  }

  interface HTMLBodyElement {
    unblockerIframeAppendListenerInstalled?: boolean
  }
}

const banlist = ['posthog']

function fixUrl(
  urlStr: string | undefined,
  config: UnblockerConfig,
  loc: Location,
): string | undefined {
  if (!urlStr) {
    console.error('No urlStr provided', urlStr)
    return
  }

  if (typeof urlStr !== 'string' || typeof urlStr.includes !== 'function') {
    console.error('urlStr is not a string', urlStr)
    return
  }

  if (banlist.some((banned) => urlStr.includes(banned))) {
    console.log('Banned URL:', urlStr)
    return
  }

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
  console.log('begin unblocker client scripts', config, win)
  initXMLHttpRequest(config, win)
  initFetch(config, win)
  initCreateElement(config, win)
  initAppendBodyIframe(config, win)
  initWebSockets(config, win)
  initPushState(config, win)
  if (typeof window !== 'undefined' && win === window) {
    delete window.unblockerInit
  }
  console.log('unblocker client scripts initialized')
}

if (typeof window !== 'undefined') {
  window.unblockerInit = initForWindow as (config: UnblockerConfig, win: Window) => void
}

// --- Monet image replacement (runs in the proxied page) ---

export function monetiseAllImages(): void {
  let count = 0
  const images = document.getElementsByTagName('img')
  for (let i = 0; i < images.length; i++) {
    replaceImage(images[i])
    count++
  }

  const backgroundImages = document.querySelectorAll<HTMLElement>('[style*="background-image"]')
  for (let i = 0; i < backgroundImages.length; i++) {
    replaceBackgroundImage(backgroundImages[i], i)
    count++
  }
  console.log(`replaced ${count} images`)
}

function replaceBackgroundImage(element: HTMLElement, index: number): void {
  if (element.getAttribute('monetised')) {
    return
  }

  element.setAttribute('monetised', 'true')
  const width = element.clientWidth || 300
  const height = element.clientHeight || 300
  const seed = Math.floor(Math.random() * 10000) + index
  const url = `/monet/${width}w${height}h${seed}`
  element.style.backgroundImage = `url(${url})`
}

function replaceImage(image: HTMLImageElement): void {
  if (image.getAttribute('monetised')) {
    return
  }

  const url = '/monet'
  const width = image.width || 300
  const height = image.height || 300
  const seed = Math.floor(Math.random() * 10000) + 1
  image.setAttribute('monetised', 'true')
  image.src = `${url}/${width}w${height}h${seed}`
  image.srcset = `${url}/${width}w${height}h${seed}`
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('Replace images with paintings by Claude Monet')
  monetiseAllImages()
  window.setInterval(monetiseAllImages, 500)
})

if (typeof window !== 'undefined') {
  window.monetiseAllImages = monetiseAllImages
}
