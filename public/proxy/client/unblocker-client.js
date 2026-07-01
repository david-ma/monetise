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
    monetiseAllImages: () => monetiseAllImages,
    initForWindow: () => initForWindow
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
  function monetiseAllImages() {
    let count = 0;
    const images = document.getElementsByTagName("img");
    for (let i = 0;i < images.length; i++) {
      replaceImage(images[i]);
      count++;
    }
    const backgroundImages = document.querySelectorAll('[style*="background-image"]');
    for (let i = 0;i < backgroundImages.length; i++) {
      replaceBackgroundImage(backgroundImages[i], i);
      count++;
    }
    console.log(`replaced ${count} images`);
  }
  function replaceBackgroundImage(element, index) {
    if (element.getAttribute("monetised")) {
      return;
    }
    element.setAttribute("monetised", "true");
    const width = element.clientWidth || 300;
    const height = element.clientHeight || 300;
    const seed = Math.floor(Math.random() * 1e4) + index;
    const url = `/monet/${width}w${height}h${seed}`;
    element.style.backgroundImage = `url(${url})`;
  }
  function replaceImage(image) {
    if (image.getAttribute("monetised")) {
      return;
    }
    const url = "/monet";
    const width = image.width || 300;
    const height = image.height || 300;
    const seed = Math.floor(Math.random() * 1e4) + 1;
    image.setAttribute("monetised", "true");
    image.src = `${url}/${width}w${height}h${seed}`;
    image.srcset = `${url}/${width}w${height}h${seed}`;
  }
  document.addEventListener("DOMContentLoaded", () => {
    console.log("Replace images with paintings by Claude Monet");
    monetiseAllImages();
    window.setInterval(monetiseAllImages, 500);
  });
  if (typeof window !== "undefined") {
    window.monetiseAllImages = monetiseAllImages;
  }
})();
