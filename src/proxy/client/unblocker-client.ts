/**
 * Client script injected into proxied third-party pages.
 * Bundled to public/proxy/client/unblocker-client.js (bun run build:client).
 *
 * ## Part 1 — Unblocker (URL rewriting)
 *
 * When a site is loaded through the Monetise proxy, its origin is our server and
 * paths are prefixed (e.g. /proxy/https://example.com/...). Page scripts that
 * fetch assets, navigate, or open WebSockets using absolute URLs would otherwise
 * bypass the proxy. initForWindow() monkey-patches the browsing context so
 * outbound http(s) URLs are rewritten to stay under the proxy prefix:
 *
 *   - fixUrl() — core rewriter; resolves relative URLs against the current
 *     proxied page, skips already-proxied and non-http(s) URLs, and blocks
 *     entries on the banlist (e.g. posthog analytics).
 *   - XMLHttpRequest.open, fetch — rewrite request URLs.
 *   - document.createElement — intercept src/href setters on new elements.
 *   - history.pushState / replaceState — rewrite SPA navigation URLs.
 *   - location.assign / replace — rewrite hard navigations (best-effort; some
 *     SPA routers still escape, see docs/2026-07-08_spa_router.md).
 *   - WebSocket — tunnel through the proxy host.
 *   - body.appendChild — re-run initForWindow inside about:blank iframes.
 *
 * Exposed as window.unblockerInit(config, win) until the top window finishes init.
 *
 * ## Part 2 — Monet image replacement
 *
 * After DOMContentLoaded, monetiseAllImages() scans the page (and re-runs every
 * 500 ms for late-added content) and swaps visual media for Monet painting URLs
 * served at /monet/{width}w{height}h{seed}:
 *
 *   - <img> — replaceImage()
 *   - elements with background-image — replaceBackgroundImage()
 *   - <canvas> — replaceCanvas() (placeholder url(/monet))
 *
 * Elements are tagged monetising / monetised to avoid double-processing.
 *
 * ### Dimension resolution
 *
 * Painting size is chosen by resolveImageDimensions(), merging two inputs:
 *
 *   1. Layout constraints (layoutDimensionsForImage) — explicit CSS width/height
 *      or HTML width/height attributes only. We deliberately do NOT read
 *      getBoundingClientRect or clientWidth/Height; the rendered box is whatever
 *      the page stylesheet already produces, and we should not bake that into
 *      inline styles unnecessarily.
 *
 *      Note getComputedStyle().width/height returns the *used* value in px, which
 *      for a replaced element with an `auto` axis is the intrinsic size of the
 *      currently loaded resource. Since the proxied <img> already loaded a Monet
 *      painting, that leaks the painting's size (e.g. 674×600) as if it were a
 *      page constraint. explicitLayoutSize() discards any axis whose computed size
 *      matches the current resource's intrinsic size, so only genuine CSS/attribute
 *      constraints survive.
 *
 *   2. Intrinsic size (naturalDimensionsForImage) — probes use originalAssetUrl()
 *      to fetch from the upstream site directly, bypassing our proxy's monet redirect
 *      (which would return a full-size JPEG and corrupt dimensions). For .svg URLs,
 *      parse viewBox / width / height from markup first, then an off-screen Image().
 *
 *      Element naturalWidth/Height is only trusted when the src is not proxied.
 *
 * Merge rules (resolveImageDimensions):
 *   - Both layout axes set → use layout size.
 *   - One layout axis set → derive the other from intrinsic aspect ratio.
 *   - No layout constraints → use intrinsic size.
 *   - Neither available → fallback 300×300.
 *
 * Background elements use the element's clientWidth/Height as layout (there is no
 * separate img intrinsic box) plus probed background-image URL dimensions.
 *
 * ### Applying the swap (applyMonetImageLayout)
 *
 * The Monet URL always uses the resolved width×height. Inline style overrides are
 * applied only when the page already declares explicit constraints — both axes,
 * height-only (width: auto), or width-only (height: auto). With no explicit
 * constraints we replace src/srcset only and leave sizing to the page CSS.
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

/**
 * Route hard navigations via location.assign / location.replace through fixUrl so
 * they stay under the proxy prefix. Best-effort: these methods are not writable in
 * every browser, and the location.href setter cannot be redefined at all, so some
 * SPA routers will still escape (see docs/2026-07-08_spa_router.md).
 */
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
      // Location methods are read-only in this browser; nothing we can do.
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
  console.log('begin unblocker client scripts', config, win)
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
  console.log('unblocker client scripts initialized')
}

if (typeof window !== 'undefined') {
  window.unblockerInit = initForWindow as (config: UnblockerConfig, win: Window) => void
}

// --- Monet image replacement (runs in the proxied page) ---

const FALLBACK_WIDTH = 300
const FALLBACK_HEIGHT = 300

const PROXY_PREFIX = '/proxy/'

/**
 * Strip the Monetise proxy wrapper from an asset URL so dimension probes hit the
 * upstream origin (e.g. https://greens.org.au/...) instead of our server, which
 * would redirect image requests to Monet paintings.
 */
export function originalAssetUrl(src: string): string {
  const trimmed = src.trim()
  if (!trimmed || trimmed.startsWith('/monet')) {
    return trimmed
  }

  const payload = extractProxiedPayload(trimmed)
  if (!payload) {
    return trimmed
  }

  return stripProxyQueryParams(payload)
}

function extractProxiedPayload(src: string): string | null {
  if (src.startsWith(PROXY_PREFIX)) {
    const payload = src.slice(PROXY_PREFIX.length)
    return /^https?:\/\//i.test(payload) ? payload : null
  }

  try {
    const parsed = new URL(src)
    const marker = PROXY_PREFIX
    const idx = parsed.pathname.indexOf(marker)
    if (idx === -1) {
      return null
    }
    const payload = parsed.pathname.slice(idx + marker.length) + parsed.search + parsed.hash
    return /^https?:\/\//i.test(payload) ? payload : null
  } catch {
    return null
  }
}

function stripProxyQueryParams(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.searchParams.delete('__proxy_cookies_to')
    return parsed.toString()
  } catch {
    return url.replace(/([?&])__proxy_cookies_to=[^&]*/g, '$1').replace(/[?&]$/, '')
  }
}

function isSvgUrl(src: string): boolean {
  return /\.svg(?:$|[?#])/i.test(src)
}

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

/**
 * An axis is "intrinsic driven" when its computed used size matches the currently
 * loaded resource's natural size on that axis. That happens when the page leaves the
 * axis as `auto`, so the browser falls back to the resource's intrinsic size. Because
 * the proxied <img> has already loaded a Monet painting, that intrinsic size is the
 * painting's — not a page-authored constraint — and must not be baked into the layout.
 */
function isIntrinsicDriven(computed: number, intrinsic: number): boolean {
  return intrinsic > 0 && computed > 0 && Math.abs(computed - intrinsic) <= 1
}

export type LayoutSizeInput = {
  computedWidth: number
  computedHeight: number
  attrWidth: number
  attrHeight: number
  intrinsicWidth: number
  intrinsicHeight: number
}

/**
 * Resolve the page's explicit layout constraints, discarding computed values that are
 * merely the intrinsic size of the loaded resource (a proxied Monet painting) leaking
 * through an `auto` axis. HTML width/height attributes are always explicit.
 */
export function explicitLayoutSize(input: LayoutSizeInput): { width: number; height: number } {
  let width = isIntrinsicDriven(input.computedWidth, input.intrinsicWidth) ? 0 : input.computedWidth
  let height = isIntrinsicDriven(input.computedHeight, input.intrinsicHeight)
    ? 0
    : input.computedHeight

  if (width <= 0 && input.attrWidth > 0) {
    width = input.attrWidth
  }
  if (height <= 0 && input.attrHeight > 0) {
    height = input.attrHeight
  }

  return { width: width > 0 ? width : 0, height: height > 0 ? height : 0 }
}

/** Read the page's explicit width/height constraints for an image from the live DOM. */
export function layoutDimensionsForImage(image: HTMLImageElement): { width: number; height: number } {
  const style = window.getComputedStyle(image)
  return explicitLayoutSize({
    computedWidth: parseCssLength(style.width, image),
    computedHeight: parseCssLength(style.height, image),
    attrWidth: readHtmlDimensionAttr(image, 'width'),
    attrHeight: readHtmlDimensionAttr(image, 'height'),
    intrinsicWidth: image.naturalWidth,
    intrinsicHeight: image.naturalHeight,
  })
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

/** Attribute where we stash the upstream asset URL before overwriting src with a Monet painting. */
const ORIGINAL_SRC_ATTR = 'originalSrc'

/**
 * Record the un-proxied upstream asset URL so later passes (and dimension probes)
 * can read the real image URL instead of reverse-engineering it from a src that
 * has already been swapped for a /monet painting.
 */
function rememberOriginalSrc(image: HTMLImageElement): void {
  if (image.getAttribute(ORIGINAL_SRC_ATTR)) {
    return
  }
  const src = image.currentSrc || image.src
  if (!src || src.startsWith('/monet')) {
    return
  }
  image.setAttribute(ORIGINAL_SRC_ATTR, originalAssetUrl(src))
}

async function naturalDimensionsForImage(image: HTMLImageElement): Promise<{
  naturalWidth: number
  naturalHeight: number
}> {
  const elementSrc = image.currentSrc || image.src
  const stored = image.getAttribute(ORIGINAL_SRC_ATTR)
  const probeSrc = stored || (elementSrc ? originalAssetUrl(elementSrc) : '')
  if (!probeSrc || probeSrc.startsWith('/monet')) {
    return { naturalWidth: 0, naturalHeight: 0 }
  }

  const isProxied = probeSrc !== elementSrc

  if (isSvgUrl(probeSrc)) {
    const svg = await probeSvgDimensions(probeSrc)
    if (svg.naturalWidth > 0 && svg.naturalHeight > 0) {
      return svg
    }
  }

  const probed = await probeNaturalSize(probeSrc)
  if (probed.naturalWidth > 0 && probed.naturalHeight > 0) {
    return probed
  }

  // Proxied src may already be a Monet JPEG — do not trust element natural dimensions.
  if (!isProxied) {
    let naturalWidth = image.naturalWidth
    let naturalHeight = image.naturalHeight
    if (naturalWidth > 0 && naturalHeight > 0) {
      return { naturalWidth, naturalHeight }
    }

    await waitForImageLoad(image)
    naturalWidth = image.naturalWidth
    naturalHeight = image.naturalHeight
    if (naturalWidth > 0 && naturalHeight > 0) {
      return { naturalWidth, naturalHeight }
    }
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
    Object.assign(natural, await probeNaturalSize(originalAssetUrl(bgUrl)))
  }

  return resolveImageDimensions({
    domWidth: element.clientWidth,
    domHeight: element.clientHeight,
    naturalWidth: natural.naturalWidth,
    naturalHeight: natural.naturalHeight,
  })
}

export const MONET_CLIENT_VERSION = '1.0.0'

export type MonetisationStats = {
  imagesScanned: number
  imagesReplaced: number
  backgroundsReplaced: number
  canvasesReplaced: number
  skippedAlreadyMonetised: number
}

const monetisationStats: MonetisationStats = {
  imagesScanned: 0,
  imagesReplaced: 0,
  backgroundsReplaced: 0,
  canvasesReplaced: 0,
  skippedAlreadyMonetised: 0,
}

let reportScheduled = false
let reportSent = false

export function getMonetisationStats(): MonetisationStats {
  return { ...monetisationStats }
}

export function resetMonetisationStats(): void {
  monetisationStats.imagesScanned = 0
  monetisationStats.imagesReplaced = 0
  monetisationStats.backgroundsReplaced = 0
  monetisationStats.canvasesReplaced = 0
  monetisationStats.skippedAlreadyMonetised = 0
  reportScheduled = false
  reportSent = false
}

function navigationTimingMs(): { pageLoadMs?: number; domContentLoadedMs?: number } {
  const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  if (!entry) return {}
  return {
    pageLoadMs: Math.round(entry.loadEventEnd - entry.startTime),
    domContentLoadedMs: Math.round(entry.domContentLoadedEventEnd - entry.startTime),
  }
}

export function reportMonetisationOnce(): void {
  if (reportSent || typeof window === 'undefined') return

  const visit = (window as Window & { __MONETISE_VISIT__?: { token?: string } }).__MONETISE_VISIT__
  if (!visit?.token) return

  reportSent = true
  const timing = navigationTimingMs()

  void fetch('/visit-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      visitToken: visit.token,
      pageUrl: window.location.href,
      documentTitle: document.title,
      timing,
      monetisation: getMonetisationStats(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      signals: { webdriver: Boolean(navigator.webdriver) },
      clientScriptVersion: MONET_CLIENT_VERSION,
    }),
    keepalive: true,
  }).catch((error) => {
    console.warn('Monetise visit report failed', error)
    reportSent = false
  })
}

export function scheduleMonetisationReport(): void {
  if (reportScheduled || reportSent) return
  reportScheduled = true
  window.setTimeout(() => {
    reportMonetisationOnce()
  }, 2000)
}

export function monetiseAllImages(): void {
  const images = document.getElementsByTagName('img')
  for (let i = 0; i < images.length; i++) {
    replaceImage(images[i], i)
  }

  const backgroundImages = document.querySelectorAll<HTMLElement>('[style*="background-image"]')
  for (let i = 0; i < backgroundImages.length; i++) {
    replaceBackgroundImage(backgroundImages[i], i)
  }

  const canvases = document.getElementsByTagName('canvas')
  for (let i = 0; i < canvases.length; i++) {
    replaceCanvas(canvases[i])
  }

  scheduleMonetisationReport()
}

function monetUrl(width: number, height: number, seed: number): string {
  return `/monet/${width}w${height}h${seed}`
}

function replaceCanvas(canvas: HTMLCanvasElement): void {
  monetisationStats.imagesScanned++
  if (canvas.getAttribute('monetised') || canvas.getAttribute('monetising')) {
    monetisationStats.skippedAlreadyMonetised++
    return
  }

  canvas.setAttribute('monetising', 'true')
  canvas.style.backgroundImage = 'url(/monet)'
  canvas.setAttribute('monetised', 'true')
  canvas.removeAttribute('monetising')
  monetisationStats.canvasesReplaced++
}

function replaceBackgroundImage(element: HTMLElement, index: number): void {
  monetisationStats.imagesScanned++
  if (element.getAttribute('monetised') || element.getAttribute('monetising')) {
    monetisationStats.skippedAlreadyMonetised++
    return
  }

  element.setAttribute('monetising', 'true')
  const seed = Math.floor(Math.random() * 10000) + index

  void dimensionsForBackgroundElement(element)
    .then(({ width, height }) => {
      element.style.backgroundImage = `url(${monetUrl(width, height, seed)})`
      element.setAttribute('monetised', 'true')
      monetisationStats.backgroundsReplaced++
    })
    .catch(() => {
      element.style.backgroundImage = `url(${monetUrl(FALLBACK_WIDTH, FALLBACK_HEIGHT, seed)})`
      element.setAttribute('monetised', 'true')
      monetisationStats.backgroundsReplaced++
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
  // Read constraints before swapping src, while the element still reflects the
  // previously loaded resource (so intrinsic-size leakage can be filtered out).
  const constraint = layoutDimensionsForImage(image)
  const hasWidth = constraint.width > 0
  const hasHeight = constraint.height > 0

  image.src = url
  image.srcset = url
  image.setAttribute('monetised', 'true')

  // Respect one-sided CSS constraints (e.g. Tailwind h-6) instead of forcing both axes.
  if (hasWidth && hasHeight) {
    image.style.width = `${width}px`
    image.style.height = `${height}px`
    image.style.objectFit = 'contain'
  } else if (hasHeight) {
    image.style.width = 'auto'
    image.style.height = `${height}px`
    image.style.objectFit = 'contain'
  } else if (hasWidth) {
    image.style.width = `${width}px`
    image.style.height = 'auto'
    image.style.objectFit = 'contain'
  }
  // No explicit constraints — leave sizing to the page stylesheet.
}

function replaceImage(image: HTMLImageElement, index: number): void {
  monetisationStats.imagesScanned++
  if (image.getAttribute('monetised') || image.getAttribute('monetising')) {
    monetisationStats.skippedAlreadyMonetised++
    return
  }

  rememberOriginalSrc(image)
  image.setAttribute('monetising', 'true')
  const seed = Math.floor(Math.random() * 10000) + index + 1

  void dimensionsForImageElement(image)
    .then(({ width, height }) => {
      applyMonetImageLayout(image, width, height, monetUrl(width, height, seed))
      monetisationStats.imagesReplaced++
    })
    .catch(() => {
      applyMonetImageLayout(
        image,
        FALLBACK_WIDTH,
        FALLBACK_HEIGHT,
        monetUrl(FALLBACK_WIDTH, FALLBACK_HEIGHT, seed),
      )
      monetisationStats.imagesReplaced++
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
