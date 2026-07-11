(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  function __accessProp(key) {
    return this[key];
  }
  var __toCommonJS = (from) => {
    var entry = (__moduleCache ??= new WeakMap).get(from), desc;
    if (entry)
      return entry;
    entry = __defProp({}, "__esModule", { value: true });
    if (from && typeof from === "object" || typeof from === "function") {
      for (var key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(entry, key))
          __defProp(entry, key, {
            get: __accessProp.bind(from, key),
            enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
          });
    }
    __moduleCache.set(from, entry);
    return entry;
  };
  var __moduleCache;
  var __returnValue = (v) => v;
  function __exportSetter(name, newValue) {
    this[name] = __returnValue.bind(null, newValue);
  }
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, {
        get: all[name],
        enumerable: true,
        configurable: true,
        set: __exportSetter.bind(all, name)
      });
  };

  // src/proxy/client/unblocker-client.ts
  var exports_unblocker_client = {};
  __export(exports_unblocker_client, {
    scheduleMonetisationReport: () => scheduleMonetisationReport,
    resolveImageDimensions: () => resolveImageDimensions,
    resetMonetisationStats: () => resetMonetisationStats,
    reportMonetisationOnce: () => reportMonetisationOnce,
    parseCssLength: () => parseCssLength,
    originalAssetUrl: () => originalAssetUrl,
    monetiseAllImages: () => monetiseAllImages,
    layoutDimensionsForImage: () => layoutDimensionsForImage,
    initForWindow: () => initForWindow,
    getMonetisationStats: () => getMonetisationStats,
    fixUrl: () => fixUrl,
    explicitLayoutSize: () => explicitLayoutSize,
    dimensionsForImageElement: () => dimensionsForImageElement,
    dimensionsForBackgroundElement: () => dimensionsForBackgroundElement,
    MONET_CLIENT_VERSION: () => MONET_CLIENT_VERSION
  });
  var banlist = ["posthog"];
  var MONETISE_LOCAL_PATHS = [
    "/visit-report",
    "/monet/",
    "/mirror/",
    "/proxy/client/",
    "/version",
    "/geoip"
  ];
  function fixUrl(urlStr, config, loc) {
    if (urlStr == null) {
      console.error("No urlStr provided", urlStr);
      return urlStr;
    }
    if (typeof urlStr !== "string") {
      urlStr = String(urlStr);
    }
    if (typeof urlStr.includes !== "function") {
      console.error("urlStr is not a string", urlStr);
      return urlStr;
    }
    if (urlStr.startsWith("/") && MONETISE_LOCAL_PATHS.some((p) => urlStr.startsWith(p))) {
      return urlStr;
    }
    if (banlist.some((banned) => urlStr.includes(banned))) {
      console.log("Banned URL:", urlStr);
      return;
    }
    let currentRemoteHref;
    if (loc.pathname.substr(0, config.prefix.length) === config.prefix) {
      currentRemoteHref = loc.pathname.substr(config.prefix.length) + loc.search + loc.hash;
    } else {
      currentRemoteHref = String(config.url);
    }
    if (urlStr.substr(0, config.prefix.length) === config.prefix) {
      return urlStr;
    }
    const url = new URL(urlStr, currentRemoteHref);
    if (url.origin === loc.origin && url.pathname.substr(0, config.prefix.length) === config.prefix) {
      return urlStr;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return urlStr;
    }
    if (url.hostname === loc.hostname) {
      const currentRemoteUrl = new URL(currentRemoteHref);
      url.host = currentRemoteUrl.host;
      url.protocol = currentRemoteUrl.protocol;
    }
    return config.prefix + url.href;
  }
  function initXMLHttpRequest(config, win) {
    if (!win.XMLHttpRequest)
      return;
    const XMLHttpRequestCtor = win.XMLHttpRequest;
    win.XMLHttpRequest = function() {
      const xhr = new XMLHttpRequestCtor;
      const open = xhr.open.bind(xhr);
      xhr.open = function(method, url, async, username, password) {
        const fixed = fixUrl(String(url), config, win.location);
        return open(method, fixed ?? String(url), async ?? true, username, password);
      };
      return xhr;
    };
  }
  function initFetch(config, win) {
    if (!win.fetch)
      return;
    const fetchImpl = win.fetch.bind(win);
    win.fetch = function(resource, init) {
      if (resource instanceof Request) {
        const fixed = fixUrl(resource.url, config, win.location);
        if (fixed && fixed !== resource.url) {
          resource = new Request(fixed, resource);
        }
      } else {
        resource = fixUrl(String(resource), config, win.location) ?? String(resource);
      }
      return fetchImpl(resource, init);
    };
  }
  function initCreateElement(config, win) {
    if (!win.document?.createElement)
      return;
    const createElement = win.document.createElement.bind(win.document);
    win.document.createElement = function(tagName, options) {
      if (tagName.toLowerCase() === "iframe") {
        initAppendBodyIframe(config, win);
      }
      const element = createElement(tagName, options);
      Object.defineProperty(element, "src", {
        set(src) {
          delete element.src;
          element.src = fixUrl(src, config, win.location) ?? src;
        },
        configurable: true
      });
      Object.defineProperty(element, "href", {
        set(href) {
          delete element.href;
          element.href = fixUrl(href, config, win.location) ?? href;
        },
        configurable: true
      });
      return element;
    };
  }
  function initAppendBodyIframe(config, win) {
    const body = win.document?.body;
    if (!body?.appendChild || body.unblockerIframeAppendListenerInstalled) {
      return;
    }
    const appendChild = body.appendChild.bind(body);
    body.appendChild = function(element) {
      const ret = appendChild(element);
      if (element instanceof HTMLIFrameElement && element.src === "about:blank" && element.contentWindow) {
        initForWindow(config, element.contentWindow);
      }
      return ret;
    };
    body.unblockerIframeAppendListenerInstalled = true;
  }
  function initWebSockets(config, win) {
    if (!win.WebSocket)
      return;
    const WebSocketCtor = win.WebSocket;
    const prefix = config.prefix;
    const proxyHost = win.location.host;
    const isSecure = win.location.protocol === "https:";
    const target = win.location.pathname.substr(prefix.length);
    const targetURL = new URL(target, win.location.origin);
    const reWsUrl = /^ws(s?):\/\/([^/]+)($|\/.*)/;
    win.WebSocket = function(url, protocols) {
      const urlStr = String(url);
      const parsedUrl = urlStr.match(reWsUrl);
      if (parsedUrl) {
        const wsSecure = parsedUrl[1];
        const wsProto = isSecure ? `ws${wsSecure}://` : "ws://";
        let wsHost = parsedUrl[2];
        if (wsHost === win.location.host || wsHost === win.location.hostname) {
          wsHost = targetURL.host;
        }
        const wsPath = parsedUrl[3];
        try {
          return new WebSocketCtor(`${wsProto}${proxyHost}${prefix}http${wsSecure}://${wsHost}${wsPath}`, protocols);
        } catch (e) {
          console.error("Failed to create WebSocket", e);
        }
      }
      return new WebSocketCtor(url, protocols);
    };
  }
  function initLocation(config, win) {
    const loc = win.location;
    if (!loc)
      return;
    for (const method of ["assign", "replace"]) {
      const original = loc[method];
      if (typeof original !== "function")
        continue;
      const call = original.bind(loc);
      try {
        loc[method] = function(url) {
          return call(fixUrl(String(url), config, win.location) ?? String(url));
        };
      } catch {}
    }
  }
  function initPushState(config, win) {
    if (!win.history?.pushState)
      return;
    const pushState = win.history.pushState.bind(win.history);
    win.history.pushState = function(state, title, url) {
      if (url) {
        const fixed = fixUrl(String(url), config, win.location) ?? String(url);
        config.url = new URL(fixed, String(config.url));
        return pushState(state, title, fixed);
      }
      return pushState(state, title, url);
    };
    if (!win.history.replaceState)
      return;
    const replaceState = win.history.replaceState.bind(win.history);
    win.history.replaceState = function(state, title, url) {
      if (url) {
        const fixed = fixUrl(String(url), config, win.location) ?? String(url);
        config.url = new URL(fixed, String(config.url));
        return replaceState(state, title, fixed);
      }
      return replaceState(state, title, url);
    };
  }
  function initForWindow(config, win) {
    console.log("begin unblocker client scripts", config, win);
    initXMLHttpRequest(config, win);
    initFetch(config, win);
    initCreateElement(config, win);
    initAppendBodyIframe(config, win);
    initWebSockets(config, win);
    initPushState(config, win);
    initLocation(config, win);
    if (typeof window !== "undefined" && win === window) {
      delete window.unblockerInit;
    }
    console.log("unblocker client scripts initialized");
  }
  if (typeof window !== "undefined") {
    window.unblockerInit = initForWindow;
  }
  var FALLBACK_WIDTH = 300;
  var FALLBACK_HEIGHT = 300;
  var PROXY_PREFIX = "/proxy/";
  function originalAssetUrl(src) {
    const trimmed = src.trim();
    if (!trimmed || trimmed.startsWith("/monet")) {
      return trimmed;
    }
    const payload = extractProxiedPayload(trimmed);
    if (!payload) {
      return trimmed;
    }
    return stripProxyQueryParams(payload);
  }
  function extractProxiedPayload(src) {
    if (src.startsWith(PROXY_PREFIX)) {
      const payload = src.slice(PROXY_PREFIX.length);
      return /^https?:\/\//i.test(payload) ? payload : null;
    }
    try {
      const parsed = new URL(src);
      const marker = PROXY_PREFIX;
      const idx = parsed.pathname.indexOf(marker);
      if (idx === -1) {
        return null;
      }
      const payload = parsed.pathname.slice(idx + marker.length) + parsed.search + parsed.hash;
      return /^https?:\/\//i.test(payload) ? payload : null;
    } catch {
      return null;
    }
  }
  function stripProxyQueryParams(url) {
    try {
      const parsed = new URL(url);
      parsed.searchParams.delete("__proxy_cookies_to");
      return parsed.toString();
    } catch {
      return url.replace(/([?&])__proxy_cookies_to=[^&]*/g, "$1").replace(/[?&]$/, "");
    }
  }
  function isSvgUrl(src) {
    return /\.svg(?:$|[?#])/i.test(src);
  }
  function resolveImageDimensions(input) {
    let width = input.domWidth > 0 ? input.domWidth : 0;
    let height = input.domHeight > 0 ? input.domHeight : 0;
    const naturalWidth = input.naturalWidth > 0 ? input.naturalWidth : 0;
    const naturalHeight = input.naturalHeight > 0 ? input.naturalHeight : 0;
    const aspect = naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : 0;
    if (width > 0 && height > 0) {
      return { width: Math.round(width), height: Math.round(height) };
    }
    if (width > 0 && aspect > 0) {
      return { width: Math.round(width), height: Math.round(width / aspect) };
    }
    if (height > 0 && aspect > 0) {
      return { width: Math.round(height * aspect), height: Math.round(height) };
    }
    if (width > 0) {
      return { width: Math.round(width), height: Math.round(height || FALLBACK_HEIGHT) };
    }
    if (height > 0) {
      return { width: Math.round(width || FALLBACK_WIDTH), height: Math.round(height) };
    }
    if (naturalWidth > 0 && naturalHeight > 0) {
      return { width: naturalWidth, height: naturalHeight };
    }
    return { width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT };
  }
  function parseCssLength(value, element) {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "auto" || trimmed === "none" || trimmed.endsWith("%")) {
      return 0;
    }
    const amount = parseFloat(trimmed);
    if (!Number.isFinite(amount) || amount <= 0) {
      return 0;
    }
    if (trimmed.endsWith("rem")) {
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      return Math.round(amount * root);
    }
    if (trimmed.endsWith("em")) {
      const fontSize = parseFloat(getComputedStyle(element).fontSize) || 16;
      return Math.round(amount * fontSize);
    }
    return Math.round(amount);
  }
  function readHtmlDimensionAttr(image, name) {
    const attr = image.getAttribute(name);
    if (!attr)
      return 0;
    const parsed = parseInt(attr, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  function isIntrinsicDriven(computed, intrinsic) {
    return intrinsic > 0 && computed > 0 && Math.abs(computed - intrinsic) <= 1;
  }
  function explicitLayoutSize(input) {
    let width = isIntrinsicDriven(input.computedWidth, input.intrinsicWidth) ? 0 : input.computedWidth;
    let height = isIntrinsicDriven(input.computedHeight, input.intrinsicHeight) ? 0 : input.computedHeight;
    if (width <= 0 && input.attrWidth > 0) {
      width = input.attrWidth;
    }
    if (height <= 0 && input.attrHeight > 0) {
      height = input.attrHeight;
    }
    return { width: width > 0 ? width : 0, height: height > 0 ? height : 0 };
  }
  function layoutDimensionsForImage(image) {
    const style = window.getComputedStyle(image);
    return explicitLayoutSize({
      computedWidth: parseCssLength(style.width, image),
      computedHeight: parseCssLength(style.height, image),
      attrWidth: readHtmlDimensionAttr(image, "width"),
      attrHeight: readHtmlDimensionAttr(image, "height"),
      intrinsicWidth: image.naturalWidth,
      intrinsicHeight: image.naturalHeight
    });
  }
  async function probeSvgDimensions(src) {
    try {
      const response = await fetch(src);
      if (!response.ok) {
        return { naturalWidth: 0, naturalHeight: 0 };
      }
      const text = await response.text();
      const viewBox = text.match(/viewBox=["']([^"']+)["']/i);
      if (viewBox) {
        const parts = viewBox[1].trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
          return { naturalWidth: Math.round(parts[2]), naturalHeight: Math.round(parts[3]) };
        }
      }
      const widthMatch = text.match(/\bwidth=["'](\d+(?:\.\d+)?)/i);
      const heightMatch = text.match(/\bheight=["'](\d+(?:\.\d+)?)/i);
      const width = widthMatch ? Math.round(Number(widthMatch[1])) : 0;
      const height = heightMatch ? Math.round(Number(heightMatch[1])) : 0;
      if (width > 0 && height > 0) {
        return { naturalWidth: width, naturalHeight: height };
      }
    } catch {}
    return { naturalWidth: 0, naturalHeight: 0 };
  }
  function probeNaturalSize(src) {
    return new Promise((resolve) => {
      const probe = new Image;
      probe.onload = () => {
        resolve({ naturalWidth: probe.naturalWidth, naturalHeight: probe.naturalHeight });
      };
      probe.onerror = () => {
        resolve({ naturalWidth: 0, naturalHeight: 0 });
      };
      probe.src = src;
    });
  }
  function waitForImageLoad(image) {
    if (image.complete) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    });
  }
  var ORIGINAL_SRC_ATTR = "originalSrc";
  function rememberOriginalSrc(image) {
    if (image.getAttribute(ORIGINAL_SRC_ATTR)) {
      return;
    }
    const src = image.currentSrc || image.src;
    if (!src || src.startsWith("/monet")) {
      return;
    }
    image.setAttribute(ORIGINAL_SRC_ATTR, originalAssetUrl(src));
  }
  async function naturalDimensionsForImage(image) {
    const elementSrc = image.currentSrc || image.src;
    const stored = image.getAttribute(ORIGINAL_SRC_ATTR);
    const probeSrc = stored || (elementSrc ? originalAssetUrl(elementSrc) : "");
    if (!probeSrc || probeSrc.startsWith("/monet")) {
      return { naturalWidth: 0, naturalHeight: 0 };
    }
    const isProxied = probeSrc !== elementSrc;
    if (isSvgUrl(probeSrc)) {
      const svg = await probeSvgDimensions(probeSrc);
      if (svg.naturalWidth > 0 && svg.naturalHeight > 0) {
        return svg;
      }
    }
    const probed = await probeNaturalSize(probeSrc);
    if (probed.naturalWidth > 0 && probed.naturalHeight > 0) {
      return probed;
    }
    if (!isProxied) {
      let naturalWidth = image.naturalWidth;
      let naturalHeight = image.naturalHeight;
      if (naturalWidth > 0 && naturalHeight > 0) {
        return { naturalWidth, naturalHeight };
      }
      await waitForImageLoad(image);
      naturalWidth = image.naturalWidth;
      naturalHeight = image.naturalHeight;
      if (naturalWidth > 0 && naturalHeight > 0) {
        return { naturalWidth, naturalHeight };
      }
    }
    return probed;
  }
  async function dimensionsForImageElement(image) {
    const natural = await naturalDimensionsForImage(image);
    const layout = layoutDimensionsForImage(image);
    return resolveImageDimensions({
      domWidth: layout.width,
      domHeight: layout.height,
      naturalWidth: natural.naturalWidth,
      naturalHeight: natural.naturalHeight
    });
  }
  function parseBackgroundImageUrl(element) {
    const inline = element.style.backgroundImage;
    if (inline && inline !== "none") {
      const match2 = inline.match(/url\(["']?([^"')]+)["']?\)/i);
      if (match2?.[1]) {
        return match2[1];
      }
    }
    const computed = window.getComputedStyle(element).backgroundImage;
    if (!computed || computed === "none") {
      return null;
    }
    const match = computed.match(/url\(["']?([^"')]+)["']?\)/i);
    return match?.[1] ?? null;
  }
  async function dimensionsForBackgroundElement(element) {
    const natural = { naturalWidth: 0, naturalHeight: 0 };
    const bgUrl = parseBackgroundImageUrl(element);
    if (bgUrl && !bgUrl.startsWith("/monet")) {
      Object.assign(natural, await probeNaturalSize(originalAssetUrl(bgUrl)));
    }
    return resolveImageDimensions({
      domWidth: element.clientWidth,
      domHeight: element.clientHeight,
      naturalWidth: natural.naturalWidth,
      naturalHeight: natural.naturalHeight
    });
  }
  var MONET_CLIENT_VERSION = "1.0.0";
  var monetisationStats = {
    imagesScanned: 0,
    imagesReplaced: 0,
    backgroundsReplaced: 0,
    canvasesReplaced: 0,
    skippedAlreadyMonetised: 0
  };
  var reportScheduled = false;
  var reportSent = false;
  function getMonetisationStats() {
    return { ...monetisationStats };
  }
  function resetMonetisationStats() {
    monetisationStats.imagesScanned = 0;
    monetisationStats.imagesReplaced = 0;
    monetisationStats.backgroundsReplaced = 0;
    monetisationStats.canvasesReplaced = 0;
    monetisationStats.skippedAlreadyMonetised = 0;
    reportScheduled = false;
    reportSent = false;
  }
  function navigationTimingMs() {
    const entry = performance.getEntriesByType("navigation")[0];
    if (!entry)
      return {};
    return {
      pageLoadMs: Math.round(entry.loadEventEnd - entry.startTime),
      domContentLoadedMs: Math.round(entry.domContentLoadedEventEnd - entry.startTime)
    };
  }
  function reportMonetisationOnce() {
    if (reportSent || typeof window === "undefined")
      return;
    const visit = window.__MONETISE_VISIT__;
    if (!visit?.token)
      return;
    reportSent = true;
    const timing = navigationTimingMs();
    fetch("/visit-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitToken: visit.token,
        pageUrl: window.location.href,
        documentTitle: document.title,
        timing,
        monetisation: getMonetisationStats(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        signals: { webdriver: Boolean(navigator.webdriver) },
        clientScriptVersion: MONET_CLIENT_VERSION
      }),
      keepalive: true
    }).catch((error) => {
      console.warn("Monetise visit report failed", error);
      reportSent = false;
    });
  }
  function scheduleMonetisationReport() {
    if (reportScheduled || reportSent)
      return;
    reportScheduled = true;
    window.setTimeout(() => {
      reportMonetisationOnce();
    }, 2000);
  }
  function monetiseAllImages() {
    const images = document.getElementsByTagName("img");
    for (let i = 0;i < images.length; i++) {
      replaceImage(images[i], i);
    }
    const backgroundImages = document.querySelectorAll('[style*="background-image"]');
    for (let i = 0;i < backgroundImages.length; i++) {
      replaceBackgroundImage(backgroundImages[i], i);
    }
    const canvases = document.getElementsByTagName("canvas");
    for (let i = 0;i < canvases.length; i++) {
      replaceCanvas(canvases[i]);
    }
    scheduleMonetisationReport();
  }
  function monetUrl(width, height, seed) {
    return `/monet/${width}w${height}h${seed}`;
  }
  function replaceCanvas(canvas) {
    monetisationStats.imagesScanned++;
    if (canvas.getAttribute("monetised") || canvas.getAttribute("monetising")) {
      monetisationStats.skippedAlreadyMonetised++;
      return;
    }
    canvas.setAttribute("monetising", "true");
    canvas.style.backgroundImage = "url(/monet)";
    canvas.setAttribute("monetised", "true");
    canvas.removeAttribute("monetising");
    monetisationStats.canvasesReplaced++;
  }
  function replaceBackgroundImage(element, index) {
    monetisationStats.imagesScanned++;
    if (element.getAttribute("monetised") || element.getAttribute("monetising")) {
      monetisationStats.skippedAlreadyMonetised++;
      return;
    }
    element.setAttribute("monetising", "true");
    const seed = Math.floor(Math.random() * 1e4) + index;
    dimensionsForBackgroundElement(element).then(({ width, height }) => {
      element.style.backgroundImage = `url(${monetUrl(width, height, seed)})`;
      element.setAttribute("monetised", "true");
      monetisationStats.backgroundsReplaced++;
    }).catch(() => {
      element.style.backgroundImage = `url(${monetUrl(FALLBACK_WIDTH, FALLBACK_HEIGHT, seed)})`;
      element.setAttribute("monetised", "true");
      monetisationStats.backgroundsReplaced++;
    }).finally(() => {
      element.removeAttribute("monetising");
    });
  }
  function applyMonetImageLayout(image, width, height, url) {
    const constraint = layoutDimensionsForImage(image);
    const hasWidth = constraint.width > 0;
    const hasHeight = constraint.height > 0;
    image.src = url;
    image.srcset = url;
    image.setAttribute("monetised", "true");
    if (hasWidth && hasHeight) {
      image.style.width = `${width}px`;
      image.style.height = `${height}px`;
      image.style.objectFit = "contain";
    } else if (hasHeight) {
      image.style.width = "auto";
      image.style.height = `${height}px`;
      image.style.objectFit = "contain";
    } else if (hasWidth) {
      image.style.width = `${width}px`;
      image.style.height = "auto";
      image.style.objectFit = "contain";
    }
  }
  function replaceImage(image, index) {
    monetisationStats.imagesScanned++;
    if (image.getAttribute("monetised") || image.getAttribute("monetising")) {
      monetisationStats.skippedAlreadyMonetised++;
      return;
    }
    rememberOriginalSrc(image);
    image.setAttribute("monetising", "true");
    const seed = Math.floor(Math.random() * 1e4) + index + 1;
    dimensionsForImageElement(image).then(({ width, height }) => {
      applyMonetImageLayout(image, width, height, monetUrl(width, height, seed));
      monetisationStats.imagesReplaced++;
    }).catch(() => {
      applyMonetImageLayout(image, FALLBACK_WIDTH, FALLBACK_HEIGHT, monetUrl(FALLBACK_WIDTH, FALLBACK_HEIGHT, seed));
      monetisationStats.imagesReplaced++;
    }).finally(() => {
      image.removeAttribute("monetising");
    });
  }
  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", () => {
      console.log("Replace images with paintings by Claude Monet");
      monetiseAllImages();
      window.setInterval(monetiseAllImages, 500);
    });
  }
  if (typeof window !== "undefined") {
    window.monetiseAllImages = monetiseAllImages;
  }
})();
