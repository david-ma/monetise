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

const FALLBACK_WIDTH = 300
const FALLBACK_HEIGHT = 300

export type ImageDimensionInput = {
  domWidth: number
  domHeight: number
  naturalWidth: number
  naturalHeight: number
}

/** Prefer layout (DOM) size; derive missing axis from intrinsic aspect ratio when possible. */
export function resolveImageDimensions(input: ImageDimensionInput): { width: number; height: number } {
  let width = input.domWidth > 0 ? input.domWidth : 0
  let height = input.domHeight > 0 ? input.domHeight : 0
  const naturalWidth = input.naturalWidth > 0 ? input.naturalWidth : 0
  const naturalHeight = input.naturalHeight > 0 ? input.naturalHeight : 0
  const aspect = naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : 0

  if (width > 0 && height > 0) {
    return { width: Math.round(width), height: Math.round(height) }
  }

  if (width > 0 && aspect > 0) {
    return { width: Math.round(width), height: Math.round(width / aspect) }
  }

  if (height > 0 && aspect > 0) {
    return { width: Math.round(height * aspect), height: Math.round(height) }
  }

  if (width > 0) {
    return { width: Math.round(width), height: Math.round(height || FALLBACK_HEIGHT) }
  }

  if (height > 0) {
    return { width: Math.round(width || FALLBACK_WIDTH), height: Math.round(height) }
  }

  if (naturalWidth > 0 && naturalHeight > 0) {
    return { width: naturalWidth, height: naturalHeight }
  }

  return { width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT }
}

/** Parse a computed CSS length into CSS pixels (0 when auto/unknown). */
export function parseCssLength(value: string, element: HTMLElement): number {
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'auto' || trimmed === 'none' || trimmed.endsWith('%')) {
    return 0
  }

  const amount = parseFloat(trimmed)
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0
  }

  if (trimmed.endsWith('rem')) {
    const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    return Math.round(amount * root)
  }

  if (trimmed.endsWith('em')) {
    const fontSize = parseFloat(getComputedStyle(element).fontSize) || 16
    return Math.round(amount * fontSize)
  }

  return Math.round(amount)
}

function readHtmlDimensionAttr(image: HTMLImageElement, name: 'width' | 'height'): number {
  const attr = image.getAttribute(name)
  if (!attr) return 0
  const parsed = parseInt(attr, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/** Layout box for monet sizing — rendered size, then CSS, then HTML attributes. */
export function layoutDimensionsForImage(image: HTMLImageElement): { width: number; height: number } {
  const rect = image.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0) {
    return { width: Math.round(rect.width), height: Math.round(rect.height) }
  }

  if (image.clientWidth > 0 && image.clientHeight > 0) {
    return { width: image.clientWidth, height: image.clientHeight }
  }

  const style = window.getComputedStyle(image)
  const width = parseCssLength(style.width, image)
  const height = parseCssLength(style.height, image)
  if (width > 0 || height > 0) {
    return { width, height }
  }

  const attrWidth = readHtmlDimensionAttr(image, 'width')
  const attrHeight = readHtmlDimensionAttr(image, 'height')
  if (attrWidth > 0 || attrHeight > 0) {
    return { width: attrWidth, height: attrHeight }
  }

  if (image.clientWidth > 0 || image.clientHeight > 0) {
    return { width: image.clientWidth, height: image.clientHeight }
  }

  return { width: 0, height: 0 }
}

async function probeSvgDimensions(src: string): Promise<{ naturalWidth: number; naturalHeight: number }> {
  try {
    const response = await fetch(src)
    if (!response.ok) {
      return { naturalWidth: 0, naturalHeight: 0 }
    }

    const text = await response.text()
    const viewBox = text.match(/viewBox=["']([^"']+)["']/i)
    if (viewBox) {
      const parts = viewBox[1].trim().split(/[\s,]+/).map(Number)
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        return { naturalWidth: Math.round(parts[2]), naturalHeight: Math.round(parts[3]) }
      }
    }

    const widthMatch = text.match(/\bwidth=["'](\d+(?:\.\d+)?)/i)
    const heightMatch = text.match(/\bheight=["'](\d+(?:\.\d+)?)/i)
    const width = widthMatch ? Math.round(Number(widthMatch[1])) : 0
    const height = heightMatch ? Math.round(Number(heightMatch[1])) : 0
    if (width > 0 && height > 0) {
      return { naturalWidth: width, naturalHeight: height }
    }
  } catch {
    /* ignore */
  }

  return { naturalWidth: 0, naturalHeight: 0 }
}

function probeNaturalSize(src: string): Promise<{ naturalWidth: number; naturalHeight: number }> {
  return new Promise((resolve) => {
    const probe = new Image()
    probe.onload = () => {
      resolve({ naturalWidth: probe.naturalWidth, naturalHeight: probe.naturalHeight })
    }
    probe.onerror = () => {
      resolve({ naturalWidth: 0, naturalHeight: 0 })
    }
    probe.src = src
  })
}

function waitForImageLoad(image: HTMLImageElement): Promise<void> {
  if (image.complete) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    image.addEventListener('load', () => resolve(), { once: true })
    image.addEventListener('error', () => resolve(), { once: true })
  })
}

async function naturalDimensionsForImage(image: HTMLImageElement): Promise<{
  naturalWidth: number
  naturalHeight: number
}> {
  let naturalWidth = image.naturalWidth
  let naturalHeight = image.naturalHeight
  if (naturalWidth > 0 && naturalHeight > 0) {
    return { naturalWidth, naturalHeight }
  }

  const src = image.currentSrc || image.src
  if (!src || src.startsWith('/monet')) {
    return { naturalWidth: 0, naturalHeight: 0 }
  }

  await waitForImageLoad(image)
  naturalWidth = image.naturalWidth
  naturalHeight = image.naturalHeight
  if (naturalWidth > 0 && naturalHeight > 0) {
    return { naturalWidth, naturalHeight }
  }

  const probed = await probeNaturalSize(src)
  if (probed.naturalWidth > 0 && probed.naturalHeight > 0) {
    return probed
  }

  if (/\.svg(?:$|[?#])/i.test(src)) {
    return probeSvgDimensions(src)
  }

  return probed
}

export async function dimensionsForImageElement(
  image: HTMLImageElement,
): Promise<{ width: number; height: number }> {
  const natural = await naturalDimensionsForImage(image)
  const layout = layoutDimensionsForImage(image)
  return resolveImageDimensions({
    domWidth: layout.width,
    domHeight: layout.height,
    naturalWidth: natural.naturalWidth,
    naturalHeight: natural.naturalHeight,
  })
}

function parseBackgroundImageUrl(element: HTMLElement): string | null {
  const inline = element.style.backgroundImage
  if (inline && inline !== 'none') {
    const match = inline.match(/url\(["']?([^"')]+)["']?\)/i)
    if (match?.[1]) {
      return match[1]
    }
  }

  const computed = window.getComputedStyle(element).backgroundImage
  if (!computed || computed === 'none') {
    return null
  }
  const match = computed.match(/url\(["']?([^"')]+)["']?\)/i)
  return match?.[1] ?? null
}

export async function dimensionsForBackgroundElement(
  element: HTMLElement,
): Promise<{ width: number; height: number }> {
  const natural = { naturalWidth: 0, naturalHeight: 0 }
  const bgUrl = parseBackgroundImageUrl(element)
  if (bgUrl && !bgUrl.startsWith('/monet')) {
    Object.assign(natural, await probeNaturalSize(bgUrl))
  }

  return resolveImageDimensions({
    domWidth: element.clientWidth,
    domHeight: element.clientHeight,
    naturalWidth: natural.naturalWidth,
    naturalHeight: natural.naturalHeight,
  })
}

function monetUrl(width: number, height: number, seed: number): string {
  return `/monet/${width}w${height}h${seed}`
}

export function monetiseAllImages(): void {
  let count = 0
  const images = document.getElementsByTagName('img')
  for (let i = 0; i < images.length; i++) {
    replaceImage(images[i], i)
    count++
  }

  const backgroundImages = document.querySelectorAll<HTMLElement>('[style*="background-image"]')
  for (let i = 0; i < backgroundImages.length; i++) {
    replaceBackgroundImage(backgroundImages[i], i)
    count++
  }

  const canvases = document.getElementsByTagName('canvas')
  for (let i = 0; i < canvases.length; i++) {
    replaceCanvas(canvases[i])
    count++
  }
  console.log(`queued ${count} images for monetisation`)
}

function replaceCanvas(canvas: HTMLCanvasElement): void {
  if (canvas.getAttribute('monetised') || canvas.getAttribute('monetising')) {
    return
  }

  canvas.setAttribute('monetising', 'true')
  canvas.style.backgroundImage = 'url(/monet)'
  canvas.setAttribute('monetised', 'true')
  canvas.removeAttribute('monetising')
}

function replaceBackgroundImage(element: HTMLElement, index: number): void {
  if (element.getAttribute('monetised') || element.getAttribute('monetising')) {
    return
  }

  element.setAttribute('monetising', 'true')
  const seed = Math.floor(Math.random() * 10000) + index

  void dimensionsForBackgroundElement(element)
    .then(({ width, height }) => {
      element.style.backgroundImage = `url(${monetUrl(width, height, seed)})`
      element.setAttribute('monetised', 'true')
    })
    .catch(() => {
      element.style.backgroundImage = `url(${monetUrl(FALLBACK_WIDTH, FALLBACK_HEIGHT, seed)})`
      element.setAttribute('monetised', 'true')
    })
    .finally(() => {
      element.removeAttribute('monetising')
    })
}

function applyMonetImageLayout(
  image: HTMLImageElement,
  width: number,
  height: number,
  url: string,
): void {
  const style = window.getComputedStyle(image)
  const cssWidth = parseCssLength(style.width, image)
  const cssHeight = parseCssLength(style.height, image)
  const attrWidth = readHtmlDimensionAttr(image, 'width')
  const attrHeight = readHtmlDimensionAttr(image, 'height')

  image.src = url
  image.srcset = url
  image.setAttribute('monetised', 'true')

  // Respect one-sided CSS constraints (e.g. Tailwind h-6) instead of forcing both axes.
  if ((cssWidth > 0 || attrWidth > 0) && (cssHeight > 0 || attrHeight > 0)) {
    image.style.width = `${width}px`
    image.style.height = `${height}px`
  } else if (cssHeight > 0 || attrHeight > 0) {
    image.style.width = 'auto'
    image.style.height = `${height}px`
  } else if (cssWidth > 0 || attrWidth > 0) {
    image.style.width = `${width}px`
    image.style.height = 'auto'
  } else {
    image.style.width = `${width}px`
    image.style.height = `${height}px`
  }

  image.style.objectFit = 'contain'
}

function replaceImage(image: HTMLImageElement, index: number): void {
  if (image.getAttribute('monetised') || image.getAttribute('monetising')) {
    return
  }

  image.setAttribute('monetising', 'true')
  const seed = Math.floor(Math.random() * 10000) + index + 1

  void dimensionsForImageElement(image)
    .then(({ width, height }) => {
      applyMonetImageLayout(image, width, height, monetUrl(width, height, seed))
    })
    .catch(() => {
      applyMonetImageLayout(
        image,
        FALLBACK_WIDTH,
        FALLBACK_HEIGHT,
        monetUrl(FALLBACK_WIDTH, FALLBACK_HEIGHT, seed),
      )
    })
    .finally(() => {
      image.removeAttribute('monetising')
    })
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('Replace images with paintings by Claude Monet')
    monetiseAllImages()
    window.setInterval(monetiseAllImages, 500)
  })
}

if (typeof window !== 'undefined') {
  window.monetiseAllImages = monetiseAllImages
}
