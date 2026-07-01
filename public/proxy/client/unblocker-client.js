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
    resolveImageDimensions: () => resolveImageDimensions,
    parseCssLength: () => parseCssLength,
    monetiseAllImages: () => monetiseAllImages,
    layoutDimensionsForImage: () => layoutDimensionsForImage,
    initForWindow: () => initForWindow,
    dimensionsForImageElement: () => dimensionsForImageElement,
    dimensionsForBackgroundElement: () => dimensionsForBackgroundElement
  });
  var banlist = ["posthog"];
  function fixUrl(urlStr, config, loc) {
    if (!urlStr) {
      console.error("No urlStr provided", urlStr);
      return;
    }
    if (typeof urlStr !== "string" || typeof urlStr.includes !== "function") {
      console.error("urlStr is not a string", urlStr);
      return;
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
  function layoutDimensionsForImage(image) {
    const rect = image.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    }
    if (image.clientWidth > 0 && image.clientHeight > 0) {
      return { width: image.clientWidth, height: image.clientHeight };
    }
    const style = window.getComputedStyle(image);
    const width = parseCssLength(style.width, image);
    const height = parseCssLength(style.height, image);
    if (width > 0 || height > 0) {
      return { width, height };
    }
    const attrWidth = readHtmlDimensionAttr(image, "width");
    const attrHeight = readHtmlDimensionAttr(image, "height");
    if (attrWidth > 0 || attrHeight > 0) {
      return { width: attrWidth, height: attrHeight };
    }
    if (image.clientWidth > 0 || image.clientHeight > 0) {
      return { width: image.clientWidth, height: image.clientHeight };
    }
    return { width: 0, height: 0 };
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
  async function naturalDimensionsForImage(image) {
    let naturalWidth = image.naturalWidth;
    let naturalHeight = image.naturalHeight;
    if (naturalWidth > 0 && naturalHeight > 0) {
      return { naturalWidth, naturalHeight };
    }
    const src = image.currentSrc || image.src;
    if (!src || src.startsWith("/monet")) {
      return { naturalWidth: 0, naturalHeight: 0 };
    }
    await waitForImageLoad(image);
    naturalWidth = image.naturalWidth;
    naturalHeight = image.naturalHeight;
    if (naturalWidth > 0 && naturalHeight > 0) {
      return { naturalWidth, naturalHeight };
    }
    const probed = await probeNaturalSize(src);
    if (probed.naturalWidth > 0 && probed.naturalHeight > 0) {
      return probed;
    }
    if (/\.svg(?:$|[?#])/i.test(src)) {
      return probeSvgDimensions(src);
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
      Object.assign(natural, await probeNaturalSize(bgUrl));
    }
    return resolveImageDimensions({
      domWidth: element.clientWidth,
      domHeight: element.clientHeight,
      naturalWidth: natural.naturalWidth,
      naturalHeight: natural.naturalHeight
    });
  }
  function monetUrl(width, height, seed) {
    return `/monet/${width}w${height}h${seed}`;
  }
  function monetiseAllImages() {
    let count = 0;
    const images = document.getElementsByTagName("img");
    for (let i = 0;i < images.length; i++) {
      replaceImage(images[i], i);
      count++;
    }
    const backgroundImages = document.querySelectorAll('[style*="background-image"]');
    for (let i = 0;i < backgroundImages.length; i++) {
      replaceBackgroundImage(backgroundImages[i], i);
      count++;
    }
    const canvases = document.getElementsByTagName("canvas");
    for (let i = 0;i < canvases.length; i++) {
      replaceCanvas(canvases[i]);
      count++;
    }
    console.log(`queued ${count} images for monetisation`);
  }
  function replaceCanvas(canvas) {
    if (canvas.getAttribute("monetised") || canvas.getAttribute("monetising")) {
      return;
    }
    canvas.setAttribute("monetising", "true");
    canvas.style.backgroundImage = "url(/monet)";
    canvas.setAttribute("monetised", "true");
    canvas.removeAttribute("monetising");
  }
  function replaceBackgroundImage(element, index) {
    if (element.getAttribute("monetised") || element.getAttribute("monetising")) {
      return;
    }
    element.setAttribute("monetising", "true");
    const seed = Math.floor(Math.random() * 1e4) + index;
    dimensionsForBackgroundElement(element).then(({ width, height }) => {
      element.style.backgroundImage = `url(${monetUrl(width, height, seed)})`;
      element.setAttribute("monetised", "true");
    }).catch(() => {
      element.style.backgroundImage = `url(${monetUrl(FALLBACK_WIDTH, FALLBACK_HEIGHT, seed)})`;
      element.setAttribute("monetised", "true");
    }).finally(() => {
      element.removeAttribute("monetising");
    });
  }
  function applyMonetImageLayout(image, width, height, url) {
    const style = window.getComputedStyle(image);
    const cssWidth = parseCssLength(style.width, image);
    const cssHeight = parseCssLength(style.height, image);
    const attrWidth = readHtmlDimensionAttr(image, "width");
    const attrHeight = readHtmlDimensionAttr(image, "height");
    image.src = url;
    image.srcset = url;
    image.setAttribute("monetised", "true");
    if ((cssWidth > 0 || attrWidth > 0) && (cssHeight > 0 || attrHeight > 0)) {
      image.style.width = `${width}px`;
      image.style.height = `${height}px`;
    } else if (cssHeight > 0 || attrHeight > 0) {
      image.style.width = "auto";
      image.style.height = `${height}px`;
    } else if (cssWidth > 0 || attrWidth > 0) {
      image.style.width = `${width}px`;
      image.style.height = "auto";
    } else {
      image.style.width = `${width}px`;
      image.style.height = `${height}px`;
    }
    image.style.objectFit = "contain";
  }
  function replaceImage(image, index) {
    if (image.getAttribute("monetised") || image.getAttribute("monetising")) {
      return;
    }
    image.setAttribute("monetising", "true");
    const seed = Math.floor(Math.random() * 1e4) + index + 1;
    dimensionsForImageElement(image).then(({ width, height }) => {
      applyMonetImageLayout(image, width, height, monetUrl(width, height, seed));
    }).catch(() => {
      applyMonetImageLayout(image, FALLBACK_WIDTH, FALLBACK_HEIGHT, monetUrl(FALLBACK_WIDTH, FALLBACK_HEIGHT, seed));
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
